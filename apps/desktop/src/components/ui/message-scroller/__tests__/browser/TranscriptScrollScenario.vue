<script setup lang="ts">
import { defineComponent, nextTick, onMounted, ref } from "vue";
import ProjectTranscriptMessage from "@/components/project/ProjectTranscriptMessage.vue";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  useMessageScrollerContext,
  type MessageScrollerContext,
} from "../../useMessageScroller";
import { useToolActivityExpansion } from "@/composables/useToolActivityExpansion";
import type { PineTranscriptMessage } from "@/stores/session";

const running = ref(true);
const width = ref(760);
const messages = ref<PineTranscriptMessage[]>([
  {
    id: "history",
    createdAt: "2000-01-01T00:00:00Z",
    role: "assistant",
    status: "complete",
    blocks: [{ type: "text", text: "Earlier conversation.\n".repeat(25) }],
  },
]);
const expanded = useToolActivityExpansion({ messages, isRunning: running });
let scroller: MessageScrollerContext;
const ScrollerProbe = defineComponent({
  setup() {
    scroller = useMessageScrollerContext();
    return () => null;
  },
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function elements() {
  return {
    viewport: document.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    )!,
    content: document.querySelector<HTMLElement>(
      '[data-slot="message-scroller-content"]',
    )!,
    spacer: document.querySelector<HTMLElement>(
      "[data-message-scroller-spacer]",
    )!,
  };
}

function snapshot() {
  const { viewport, content, spacer } = elements();
  const rows = content.querySelectorAll<HTMLElement>(
    ":scope > [data-message-id]",
  );
  const bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
  const viewportBottom = viewport.getBoundingClientRect().bottom;
  const tail = content.querySelector<HTMLElement>(
    "[data-message-scroller-tail]",
  );
  return {
    at: performance.now(),
    top: viewport.scrollTop,
    distanceToEnd:
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
    blank: Math.max(0, viewportBottom - bottom),
    normalTailSpace:
      Number.parseFloat(getComputedStyle(content).paddingBottom) +
      (tail?.getBoundingClientRect().height ?? 0),
    spacerHeight: Number.parseFloat(spacer.style.height) || 0,
    spacerHidden: spacer.hidden,
    minHeight: content.style.minHeight,
    following: scroller.followingBottom.value,
  };
}

async function run(options: {
  width: number;
  follow: boolean;
  interrupt: boolean;
  separateMessages?: boolean;
}) {
  width.value = options.width;
  await nextTick();
  await sleep(650);
  messages.value.push({
    id: "user",
    createdAt: "2000-01-01T00:00:00Z",
    role: "user",
    status: "complete",
    blocks: [
      { type: "text", text: "Inspect the files and report what you find." },
    ],
  });
  await nextTick();
  await sleep(650);
  if (options.follow) scroller.scrollToEnd();
  const samples: ReturnType<typeof snapshot>[] = [];
  let recording = true;
  let frame: number;
  const sample = () => {
    if (!recording) return;
    samples.push(snapshot());
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  const appendReply = (id: string) =>
    messages.value.push({
      id,
      createdAt: "2000-01-01T00:00:00Z",
      role: "assistant",
      status: "streaming",
      blocks: [],
      thinkingBlocks: {},
    });
  let replyId = "reply";
  if (!options.separateMessages) appendReply(replyId);
  let interruptedTop: number | undefined;
  for (let round = 0; round < 10; round++) {
    if (options.separateMessages) {
      replyId = `reply-${round}`;
      appendReply(replyId);
    }
    messages.value = messages.value.map((message) =>
      message.id === replyId
        ? {
            ...message,
            blocks: [
              ...message.blocks,
              { type: "thinking", thinking: "Checking one more detail." },
            ],
            thinkingBlocks: {
              ...message.thinkingBlocks,
              [message.blocks.length]: {
                status: "streaming",
                startedAt: Date.now(),
              },
            },
          }
        : message,
    );
    await nextTick();
    await sleep(round % 3 === 0 ? 550 : 140);
    messages.value = messages.value.map((message) =>
      message.id === replyId
        ? {
            ...message,
            thinkingBlocks: Object.fromEntries(
              Object.entries(message.thinkingBlocks ?? {}).map(
                ([key, value]) => [
                  key,
                  { ...value, status: "complete" as const, durationMs: 140 },
                ],
              ),
            ),
            blocks: [
              ...message.blocks,
              ...[0, 1].map((index) => ({
                type: "toolCall" as const,
                toolCall: {
                  id: `read-${round}-${index}`,
                  name: "read",
                  input: { path: `/tmp/file-${round}-${index}.ts` },
                  status: "complete" as const,
                },
              })),
            ],
          }
        : message,
    );
    await nextTick();
    await sleep(round % 3 === 1 ? 550 : 140);
    if (options.interrupt && round === 6) {
      const { viewport } = elements();
      viewport.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -80, bubbles: true }),
      );
      viewport.scrollTop -= 80;
      viewport.dispatchEvent(new Event("scroll"));
      await sleep(40);
      interruptedTop = viewport.scrollTop;
    }
  }
  running.value = false;
  messages.value = messages.value.map((message) =>
    message.id === replyId
      ? {
          ...message,
          status: "complete",
          blocks: [
            ...message.blocks,
            { type: "text", text: "Inspection complete." },
          ],
        }
      : message,
  );
  await nextTick();
  await sleep(1200);
  recording = false;
  cancelAnimationFrame(frame!);
  const following = samples.filter((value) => value.following);
  const jumps = samples.slice(1).flatMap((value, index) => {
    const previous = samples[index];
    const delta = Math.abs(value.top - previous.top);
    return delta > 48 && value.at - previous.at < 80
      ? [{ top: value.top, delta }]
      : [];
  });
  return {
    final: snapshot(),
    interruptedTop,
    maxExtraBlank: Math.max(
      0,
      ...following.map((value) => value.blank - value.normalTailSpace),
    ),
    hadFollowing: following.length > 0,
    jumps,
  };
}

onMounted(() => {
  (
    window as Window & { pineTranscriptScrollTest?: { run: typeof run } }
  ).pineTranscriptScrollTest = { run };
});
</script>

<template>
  <div
    :style="{ width: `${width}px`, height: '650px', margin: '20px auto' }"
    class="flex flex-col bg-background text-foreground"
  >
    <MessageScrollerProvider
      auto-scroll
      :follow-animated="running"
      default-scroll-position="last-anchor"
    >
      <ScrollerProbe />
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent class="p-8" spacer-class="h-16">
            <MessageScrollerItem
              v-for="message in messages"
              :key="message.id"
              :message-id="message.id"
              :scroll-anchor="message.role === 'user'"
            >
              <ProjectTranscriptMessage
                :message="message"
                :expanded-tool-runs="expanded"
              />
            </MessageScrollerItem>
            <template #tail><div class="h-6">Working…</div></template>
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
    <div class="h-16 shrink-0 border">Composer</div>
  </div>
</template>
