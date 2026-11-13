<script setup lang="ts">
/**
 * A synthetic reply streamed into the real transcript components, for
 * apps/desktop/scripts/verify-stream-perf.mjs. Query parameters: `w` is the
 * number of history messages mounted before the reply, `shimmer=1` adds one
 * shimmering label (a running tab title has one), `autorun=1` starts the
 * stream on load for profiling by hand in DevTools.
 */
import { nextTick, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import ProjectTranscriptMessage from "@/components/project/ProjectTranscriptMessage.vue";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { PineContentBlock } from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";
import type { StreamPerfCursor, StreamPerfWindow } from "./perfMain";

/** The agent forwards a streaming message to the renderer at this rate. */
const UPDATE_INTERVAL_MS = 120;
const PHASE_MS = 5_000;
const CHARACTERS_PER_UPDATE = 100;
const SETTLE_PHASE_MS = 2_000;
const CREATED_AT = "2000-01-01T00:00:00Z";

const parameters = new URLSearchParams(window.location.search);
const historyCount = Math.max(
  0,
  Math.floor(Number(parameters.get("w") ?? 10)) || 0,
);
const shimmer = parameters.get("shimmer") === "1";

function userMessage(id: string, text: string): PineTranscriptMessage {
  return {
    id,
    createdAt: CREATED_AT,
    role: "user",
    status: "complete",
    blocks: [{ type: "text", text }],
  };
}

function historyReply(index: number): PineTranscriptMessage {
  const lines = [
    `Reply ${index} looks at the same module from another angle and keeps the earlier conclusion.`,
    "",
    `- The first point about \`module-${index}.ts\` still holds.`,
    "- The second point needs **one more check** before it is safe to rely on.",
    "- The third point is unrelated and can wait.",
    "",
    "Nothing else changed since the previous turn, so the plan stays as it was written.",
  ];
  if (index % 8 === 3) {
    lines.push(
      "",
      "| File | Status | Note |",
      "| --- | --- | --- |",
      `| module-${index}.ts | checked | no change needed |`,
      `| module-${index}.test.ts | pending | covers the second point |`,
    );
  }
  const blocks: PineContentBlock[] = [];
  const hasToolTurn = index % 6 === 1;
  if (hasToolTurn) {
    blocks.push(
      {
        type: "thinking",
        thinking: `The module from turn ${index} has to be read before answering.`,
      },
      ...[0, 1].map((call): PineContentBlock => ({
        type: "toolCall",
        toolCall: {
          id: `read-${index}-${call}`,
          name: "read",
          input: { path: `/tmp/module-${index}-${call}.ts` },
          status: "complete",
        },
      })),
    );
  }
  blocks.push({ type: "text", text: lines.join("\n") });
  return {
    id: `history-${index}`,
    createdAt: CREATED_AT,
    role: "assistant",
    status: "complete",
    blocks,
    thinkingBlocks: hasToolTurn
      ? { 0: { status: "complete", startedAt: 0, durationMs: 4_200 } }
      : undefined,
  };
}

function historyMessages(count: number): PineTranscriptMessage[] {
  return Array.from({ length: count }, (_, index) =>
    index % 2 === 0
      ? userMessage(
          `history-${index}`,
          `Question ${index}: what about the next module?`,
        )
      : historyReply(index),
  );
}

function repeatSections(
  minLength: number,
  section: (number: number) => string[],
): string {
  let source = "";
  for (let number = 1; source.length < minLength; number++) {
    source += `${section(number).join("\n")}\n\n`;
  }
  return source;
}

function thinkingSource(minLength: number): string {
  return repeatSections(minLength, (number) => [
    `Step ${number}: the reply has to stay smooth while it streams, so I should look at what runs on each update and what keeps running between two updates.`,
    "",
    `- Update ${number}.1 changes one message and should leave the others untouched.`,
    `- Update ${number}.2 grows the open block, which is parsed again from its start.`,
    `- Update ${number}.3 moves the scroll position, which can restart an animation.`,
    `- Update ${number}.4 is only a timer tick and should cost nothing visible.`,
    "",
    `| Path ${number} | Runs on | Grows with |`,
    "| --- | --- | --- |",
    "| Store | every update | loaded messages |",
    "| Markdown | every update | block length |",
    "| Scroll | every frame | mounted rows |",
    "",
    `That narrows step ${number} down to the parts that repeat, so the next thing to check is whether any of them depends on how long the conversation already is.`,
  ]);
}

function textSource(minLength: number): string {
  return repeatSections(minLength, (number) => [
    `## Finding ${number}`,
    "",
    `The transcript keeps **every settled message** as it is while the last one grows, and \`update ${number}\` only replaces the message that is still streaming.`,
    "",
    "1. Measure the frames produced during the stream, not only the time per update.",
    "2. Compare a short conversation with a long one on the same machine.",
    "3. Keep the numbers next to the change that moved them.",
    "",
    `| Measure ${number} | Short | Long |`,
    "| --- | --- | --- |",
    "| Frames | steady | should match |",
    "| Layout | per update | should match |",
    "| Script | per update | should match |",
    "",
    `In short, finding ${number} holds as long as the cost of one update does not depend on what was rendered before it.`,
  ]);
}

const running = ref(false);
/** A shallow array of immutable records, replaced on every update, like the
 * session store's transcript. */
const messages = shallowRef<PineTranscriptMessage[]>(
  historyMessages(historyCount),
);
const provider =
  useTemplateRef<InstanceType<typeof MessageScrollerProvider>>("provider");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function replaceLast(message: PineTranscriptMessage): void {
  const next = messages.value.slice();
  next[next.length - 1] = message;
  messages.value = next;
}

/** Applies `count` updates on a fixed clock and returns when the phase is over. */
async function stream(
  count: number,
  apply: (index: number) => void,
): Promise<void> {
  const startedAt = performance.now();
  for (let index = 0; index <= count; index++) {
    const wait = startedAt + index * UPDATE_INTERVAL_MS - performance.now();
    if (wait > 0) await sleep(wait);
    if (index < count) apply(index);
  }
}

async function run(options: { phaseMs?: number } = {}) {
  const page = window as StreamPerfWindow;
  const probe = page.pineStreamPerfProbe;
  if (!probe) throw new Error("The stream perf probe is not installed.");
  const mark = async (name: string) => {
    await page.pineStreamPerfMark?.(name);
  };
  const updates = Math.max(
    1,
    Math.ceil((options.phaseMs ?? PHASE_MS) / UPDATE_INTERVAL_MS),
  );
  const thinking = thinkingSource(updates * CHARACTERS_PER_UPDATE);
  const text = textSource(updates * CHARACTERS_PER_UPDATE);
  const isFollowing = () => provider.value?.isFollowingBottom() ?? false;
  const phase = (from: StreamPerfCursor, to: StreamPerfCursor) => ({
    ...probe.summarize(from, to),
    followingBottom: isFollowing(),
  });

  // The history settles first, then the prompt takes its place, as a send does.
  await sleep(1_500);
  running.value = true;
  messages.value = [
    ...messages.value,
    userMessage(
      "prompt",
      "Explain why streaming gets slower in long conversations and what to measure first.",
    ),
  ];
  await nextTick();
  await sleep(1_000);
  const mounted = {
    rows: document.querySelectorAll(
      '[data-slot="message-scroller-content"] > [data-message-id]',
    ).length,
    elements: document.getElementsByTagName("*").length,
  };

  probe.startSampling();
  await sleep(100);
  await mark("stream-start");
  const thinkingFrom = probe.cursor();
  const live: PineTranscriptMessage = {
    id: "reply",
    createdAt: CREATED_AT,
    role: "assistant",
    status: "streaming",
    blocks: [],
    thinkingBlocks: {},
  };
  messages.value = [...messages.value, live];
  const thinkingStartedAt = Date.now();
  const streamingThinking = {
    0: { status: "streaming" as const, startedAt: thinkingStartedAt },
  };
  let thinkingBlock: PineContentBlock = { type: "thinking", thinking: "" };
  await stream(updates, (index) => {
    thinkingBlock = {
      type: "thinking",
      thinking: thinking.slice(0, (index + 1) * CHARACTERS_PER_UPDATE),
    };
    replaceLast({
      ...live,
      blocks: [thinkingBlock],
      thinkingBlocks: streamingThinking,
    });
  });
  const thinkingStats = phase(thinkingFrom, probe.cursor());
  await mark("thinking-end");

  const textFrom = probe.cursor();
  // The settled thinking block keeps its identity while the text grows.
  const completeThinking = {
    0: {
      status: "complete" as const,
      startedAt: thinkingStartedAt,
      durationMs: Date.now() - thinkingStartedAt,
    },
  };
  let reply = live;
  await stream(updates, (index) => {
    reply = {
      ...live,
      blocks: [
        thinkingBlock,
        {
          type: "text",
          text: text.slice(0, (index + 1) * CHARACTERS_PER_UPDATE),
        },
      ],
      thinkingBlocks: completeThinking,
    };
    replaceLast(reply);
  });
  const textStats = phase(textFrom, probe.cursor());
  await mark("text-end");

  const settleFrom = probe.cursor();
  running.value = false;
  replaceLast({ ...reply, status: "complete" });
  await sleep(SETTLE_PHASE_MS);
  const settleStats = phase(settleFrom, probe.cursor());
  await mark("settle-end");
  probe.stopSampling();

  return {
    w: historyCount,
    shimmer,
    updateIntervalMs: UPDATE_INTERVAL_MS,
    updatesPerPhase: updates,
    mounted,
    phases: { thinking: thinkingStats, text: textStats, settle: settleStats },
  };
}

onMounted(() => {
  (window as StreamPerfWindow).pineStreamPerfTest = { run };
  if (parameters.get("autorun") === "1") {
    void run().then((result) => console.log(JSON.stringify(result)));
  }
});
</script>

<template>
  <div
    style="width: 760px; height: 650px; margin: 20px auto"
    class="flex flex-col bg-background text-foreground"
  >
    <MessageScrollerProvider
      ref="provider"
      auto-scroll
      default-scroll-position="last-anchor"
      :scroll-previous-item-peek="64"
      :follow-animated="running"
    >
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent class="p-8" spacer-class="h-16">
            <!-- One row per message, skipped unless its record was replaced,
                 as in the session view. -->
            <MessageScrollerItem
              v-for="message in messages"
              :key="message.id"
              v-memo="[message]"
              :message-id="message.id"
              :scroll-anchor="message.role === 'user'"
            >
              <ProjectTranscriptMessage :message="message" />
            </MessageScrollerItem>
            <template #tail>
              <div class="h-6 text-sm text-muted-foreground">
                <span :class="shimmer && running ? 'shimmer' : undefined">
                  Working…
                </span>
              </div>
            </template>
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
    <div class="h-16 shrink-0 border">Composer</div>
  </div>
</template>
