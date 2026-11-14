<script setup lang="ts">
/**
 * A live turn whose thinking panel streams inside the real transcript, for
 * apps/desktop/scripts/verify-thinking-follow.mjs. Query parameters: `vh` is
 * the transcript height in px. The page exposes `pineThinkingFollow`, which
 * streams one scenario and returns a per-frame log of the transcript's and
 * the thinking panel's scroll state.
 */
import { nextTick, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import ProjectAwaitingResponseMarker from "@/components/project/ProjectAwaitingResponseMarker.vue";
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

const UPDATE_INTERVAL_MS = 100;
const CHARACTERS_PER_UPDATE = 60;
const CREATED_AT = "2000-01-01T00:00:00Z";

const parameters = new URLSearchParams(window.location.search);
const viewportHeight = Number(parameters.get("vh") ?? 650) || 650;
const historyCount = Number(parameters.get("w") ?? 6);

export interface ThinkingFollowFrame {
  t: number;
  phase: string;
  scrollTop: number;
  maxScrollTop: number;
  following: boolean;
  spacer: number;
  /** Viewport bottom minus the open panel's bottom; negative is below the fold. */
  panelGap: number | null;
  /** Viewport bottom minus the last message's bottom. */
  lastGap: number;
  panelOpen: boolean;
  panelScrollTop: number | null;
  panelRange: number | null;
}

function userMessage(id: string, text: string): PineTranscriptMessage {
  return {
    id,
    createdAt: CREATED_AT,
    role: "user",
    status: "complete",
    blocks: [{ type: "text", text }],
  };
}

function history(count: number): PineTranscriptMessage[] {
  return Array.from({ length: count }, (_, index) =>
    index % 2 === 0
      ? userMessage(`h-${index}`, `Question ${index}?`)
      : {
          id: `h-${index}`,
          createdAt: CREATED_AT,
          role: "assistant",
          status: "complete",
          blocks: [
            {
              type: "text",
              text: `Answer ${index}. `.repeat(40),
            },
          ],
        },
  );
}

function prose(prefix: string, length: number): string {
  let source = "";
  for (let n = 1; source.length < length; n++)
    source += `${prefix} ${n}: the reply has to stay readable while it streams, so each update should land where the reader is already looking.\n\n`;
  return source.slice(0, length);
}

const running = ref(false);
const messages = shallowRef<PineTranscriptMessage[]>(history(historyCount));
const provider =
  useTemplateRef<InstanceType<typeof MessageScrollerProvider>>("provider");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let phase = "idle";
const frames: ThinkingFollowFrame[] = [];
let sampling = false;
const startedAt = performance.now();

function sample(): void {
  if (!sampling) return;
  const viewport = document.querySelector<HTMLElement>(
    '[data-slot="message-scroller-viewport"]',
  );
  const spacer = document.querySelector<HTMLElement>(
    "[data-message-scroller-spacer]",
  );
  const rows = document.querySelectorAll<HTMLElement>(
    '[data-slot="message-scroller-content"] > [data-message-id]',
  );
  const panels = document.querySelectorAll<HTMLElement>(
    "[data-thinking-content]",
  );
  const panel = panels[panels.length - 1];
  const toggles = document.querySelectorAll<HTMLElement>(
    "[aria-expanded]",
  );
  const toggle = toggles[toggles.length - 1];
  if (viewport) {
    const bottom = viewport.getBoundingClientRect().bottom;
    const last = rows[rows.length - 1];
    frames.push({
      t: Math.round(performance.now() - startedAt),
      phase,
      scrollTop: Math.round(viewport.scrollTop),
      maxScrollTop: viewport.scrollHeight - viewport.clientHeight,
      following: provider.value?.isFollowingBottom() ?? false,
      spacer: spacer && !spacer.hidden ? spacer.offsetHeight : 0,
      panelGap: panel
        ? Math.round(bottom - panel.getBoundingClientRect().bottom)
        : null,
      lastGap: last ? Math.round(bottom - last.getBoundingClientRect().bottom) : 0,
      panelOpen: toggle?.getAttribute("aria-expanded") === "true",
      panelScrollTop: panel ? Math.round(panel.scrollTop) : null,
      panelRange: panel ? panel.scrollHeight - panel.clientHeight : null,
    });
  }
  requestAnimationFrame(sample);
}

function replaceLast(message: PineTranscriptMessage): void {
  const next = messages.value.slice();
  next[next.length - 1] = message;
  messages.value = next;
}

async function stream(
  updates: number,
  apply: (index: number) => void,
): Promise<void> {
  const from = performance.now();
  for (let index = 0; index < updates; index++) {
    const wait = from + index * UPDATE_INTERVAL_MS - performance.now();
    if (wait > 0) await sleep(wait);
    apply(index);
  }
  await sleep(UPDATE_INTERVAL_MS);
}

interface RunOptions {
  /** The prompt's length in characters. */
  promptLength?: number;
  /** A text reply long enough to fill the view streams before the thinking. */
  textFirst?: boolean;
  thinkingMs?: number;
  textMs?: number;
  /** Resolves when the driver says the thinking phase may go on. */
}

let reply: PineTranscriptMessage;
let blocks: PineContentBlock[] = [];
let thinkingStates: Record<
  number,
  NonNullable<PineTranscriptMessage["thinkingBlocks"]>[number]
> = {};

function push(): void {
  reply = {
    ...reply,
    blocks: blocks.slice(),
    thinkingBlocks: { ...thinkingStates },
  };
  replaceLast(reply);
}

async function run(options: RunOptions = {}) {
  frames.length = 0;
  sampling = true;
  requestAnimationFrame(sample);
  await sleep(500);
  running.value = true;
  phase = "send";
  messages.value = [
    ...messages.value,
    userMessage("prompt", prose("Prompt", options.promptLength ?? 80)),
  ];
  await nextTick();
  await sleep(700);
  reply = {
    id: "reply",
    createdAt: CREATED_AT,
    role: "assistant",
    status: "streaming",
    blocks: [],
  };
  blocks = [];
  thinkingStates = {};
  messages.value = [...messages.value, reply];

  if (options.textFirst) {
    phase = "text-first";
    blocks.push({ type: "text", text: "" });
    const textIndex = blocks.length - 1;
    const source = prose("Early", 40 * CHARACTERS_PER_UPDATE);
    await stream(40, (index) => {
      blocks[textIndex] = {
        type: "text",
        text: source.slice(0, (index + 1) * CHARACTERS_PER_UPDATE),
      };
      push();
    });
    phase = "tool";
    blocks.push({
      type: "toolCall",
      toolCall: {
        id: "read-1",
        name: "read",
        input: { path: "/tmp/a.ts" },
        status: "complete",
      },
    });
    push();
    await sleep(600);
  }

  phase = "thinking";
  const thinkingIndex = blocks.length;
  const thinkingStartedAt = Date.now();
  thinkingStates[thinkingIndex] = {
    status: "streaming",
    startedAt: thinkingStartedAt,
  };
  blocks.push({ type: "thinking", thinking: "" });
  const thinkingUpdates = Math.ceil(
    (options.thinkingMs ?? 6_000) / UPDATE_INTERVAL_MS,
  );
  const thinking = prose("Step", thinkingUpdates * CHARACTERS_PER_UPDATE);
  await stream(thinkingUpdates, (index) => {
    blocks[thinkingIndex] = {
      type: "thinking",
      thinking: thinking.slice(0, (index + 1) * CHARACTERS_PER_UPDATE),
    };
    push();
  });

  phase = "text";
  thinkingStates[thinkingIndex] = {
    status: "complete",
    startedAt: thinkingStartedAt,
    durationMs: Date.now() - thinkingStartedAt,
  };
  blocks.push({ type: "text", text: "" });
  const textIndex = blocks.length - 1;
  const textUpdates = Math.ceil((options.textMs ?? 3_000) / UPDATE_INTERVAL_MS);
  const text = prose("Finding", textUpdates * CHARACTERS_PER_UPDATE);
  await stream(textUpdates, (index) => {
    blocks[textIndex] = {
      type: "text",
      text: text.slice(0, (index + 1) * CHARACTERS_PER_UPDATE),
    };
    push();
  });
  phase = "settle";
  running.value = false;
  replaceLast({ ...reply, status: "complete" });
  await sleep(1_000);
  sampling = false;
  return frames.slice();
}

onMounted(() => {
  (
    window as Window & {
      pineThinkingFollow?: {
        run: typeof run;
        phase: () => string;
      };
    }
  ).pineThinkingFollow = { run, phase: () => phase };
});
</script>

<template>
  <div
    :style="{ width: '760px', height: `${viewportHeight}px`, margin: '20px auto' }"
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
          <MessageScrollerContent class="py-8" spacer-class="h-16">
            <p v-if="!messages.length" class="py-40 text-center">
              Start a conversation
            </p>
            <MessageScrollerItem
              v-for="message in messages"
              :key="message.id"
              v-memo="[message]"
              :message-id="message.id"
              :scroll-anchor="message.role === 'user'"
            >
              <ProjectTranscriptMessage :message="message" />
            </MessageScrollerItem>
            <ProjectAwaitingResponseMarker
              :waiting="running && messages.at(-1)?.role === 'user'"
              :active="true"
            />
            <template #tail>
              <div class="h-6 text-sm text-muted-foreground">Working…</div>
            </template>
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
    <div class="h-16 shrink-0 border">Composer</div>
  </div>
</template>
