<script setup lang="ts">
import { CheckIcon, CopyIcon, PencilIcon } from "@lucide/vue";
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  toRaw,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import IntelligentUiBlock from "@/components/intelligent-ui/IntelligentUiBlock.vue";
import {
  splitTranscriptText,
  type TranscriptTextSegment,
} from "@/components/intelligent-ui/segments";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import { useOptionalMessageScrollerContext } from "@/components/ui/message-scroller/useMessageScroller";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  createMarkdownBlockView,
  hasDocumentLevelDefinitions,
  markdownFlowJoin,
  type MarkdownBlockItem,
  type MarkdownBlockView,
} from "@/lib/markdownBlockView";
import { cn } from "@/lib/utils";
import { summarizeThinking } from "@/lib/transcriptThinking";
import { serializeAttachmentMessage } from "@/shared/attachments";
import { parseAutomationRunMessage } from "@/shared/automationRunMessage";
import {
  contentBlocksToText,
  parseRelayPrefix,
  type PineContentBlock,
  type PineToolCall,
} from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectAttachmentList from "./ProjectAttachmentList.vue";
import ProjectQuoteList from "./ProjectQuoteList.vue";
import { serializeQuoteMessage } from "@/shared/quotes";
import ProjectAutomationRunMessage from "./ProjectAutomationRunMessage.vue";
import ProjectBackgroundTaskMarker from "./ProjectBackgroundTaskMarker.vue";
import ProjectRelaySource from "./ProjectRelaySource.vue";
import ProjectSessionNoticeMarker from "./ProjectSessionNoticeMarker.vue";
import ProjectCompactionMarker from "./ProjectCompactionMarker.vue";
import ProjectErrorMarker from "./ProjectErrorMarker.vue";
import ProjectStoppedMarker from "./ProjectStoppedMarker.vue";
import ProjectThinkingMarker from "./ProjectThinkingMarker.vue";
import ProjectToolCallGroup from "./ProjectToolCallGroup.vue";
import ProjectToolCallMarker from "./ProjectToolCallMarker.vue";

const props = defineProps<{
  message: PineTranscriptMessage;
  /** Keys of the tool runs currently held open by the transcript-level
   * expansion policy; absent for static history reads. */
  expandedToolRuns?: ReadonlySet<string>;
  /** Tool calls held by the auto-reviewer (auto-approve mode). */
  reviewingToolCallIds?: ReadonlySet<string>;
  /** Tool calls waiting for the user's decision (Let Me Review mode). */
  awaitingApprovalToolCallIds?: ReadonlySet<string>;
  openFile?: (
    path: string,
    toolCall: PineToolCall,
  ) => boolean | Promise<boolean>;
  /** Whether an edited user message can be sent right now (session idle). */
  canRewrite?: boolean;
  /** Replaces this user message and continues the session from it. Resolves
   * false when the rewrite was not accepted. */
  rewriteMessage?: (messageId: string, message: string) => Promise<boolean>;
}>();

const isUser = computed(() => props.message.role === "user");
const { t } = useI18n();

async function openAttachment(path: string): Promise<void> {
  try {
    const result = await window.pine.openAttachment({ path });
    if (!result.opened) throw new Error(result.error);
  } catch {
    toast.error(t("project.composer.attachmentOpenFailed"));
  }
}

const copied = ref(false);
let copiedResetTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(copiedResetTimer));

async function copyMessage(): Promise<void> {
  try {
    await navigator.clipboard.writeText(relay.value.body);
    copied.value = true;
    clearTimeout(copiedResetTimer);
    copiedResetTimer = setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {
    toast.error(t("project.transcript.copyMessageFailed"));
  }
}

const isEditing = ref(false);
const isSendingEdit = ref(false);
const editDraft = ref("");
const editInput = ref<InstanceType<typeof Textarea> | null>(null);
const canSendEdit = computed(
  () =>
    (props.canRewrite ?? false) &&
    !isSendingEdit.value &&
    (editDraft.value.trim().length > 0 ||
      attachments.value.length > 0 ||
      quotes.value.length > 0),
);

const scroller = useOptionalMessageScrollerContext();
const messageRoot = useTemplateRef<{ $el: HTMLElement }>("messageRoot");

async function startEditing(): Promise<void> {
  editDraft.value = text.value;
  // The editor and its buttons grow the message downward; keep its top in
  // place rather than following the bottom and pushing it up.
  const root = messageRoot.value?.$el;
  if (root instanceof HTMLElement) scroller?.holdElementTop(root);
  isEditing.value = true;
  await nextTick();
  const input = editInput.value?.$el as HTMLTextAreaElement | undefined;
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function cancelEditing(): void {
  isEditing.value = false;
  editDraft.value = "";
}

async function sendEdit(): Promise<void> {
  if (!canSendEdit.value || !props.rewriteMessage) return;
  isSendingEdit.value = true;
  try {
    const accepted = await props.rewriteMessage(
      props.message.id,
      serializeAttachmentMessage(
        attachments.value,
        serializeQuoteMessage(quotes.value, editDraft.value),
      ),
    );
    if (accepted) cancelEditing();
  } finally {
    isSendingEdit.value = false;
  }
}

function handleEditKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    cancelEditing();
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendEdit();
  }
}

/** Stable key shared with useToolActivityExpansion's transcript-level scan. */
function runKey(toolCalls: PineToolCall[]): string {
  return `${props.message.id}:${toolCalls[0]?.id ?? ""}`;
}

/**
 * The message body text is the concatenation of every `text` block, so user
 * messages and markdown rendering keep working regardless of where thinking /
 * tool-call markers sit in the block order.
 */
const text = computed(() => contentBlocksToText(props.message.blocks));
/**
 * A message Pine routed in from another session: its routing line shows as
 * a link to that session above the bubble, which shows only the message.
 */
const relay = computed(() =>
  isUser.value ? parseRelayPrefix(text.value) : { body: text.value },
);
/** The message an automation run starts with, shown as a card. */
const automationRun = computed(() =>
  isUser.value ? parseAutomationRunMessage(text.value) : undefined,
);
const attachments = computed(() =>
  props.message.blocks.flatMap((block) =>
    block.type === "attachments" ? block.attachments : [],
  ),
);
const quotes = computed(() =>
  props.message.blocks.flatMap((block) =>
    block.type === "quotes" ? block.quotes : [],
  ),
);
/** The same array while the tool calls in it are the same objects, so
 * finished tool call markers are not updated by an unrelated flush. */
const contextToolCalls = computed<PineToolCall[]>((previous) => {
  const next = props.message.blocks.flatMap((block) =>
    block.type === "toolCall" ? [block.toolCall] : [],
  );
  return previous && sameItems(previous, next) ? previous : next;
});

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Collapse ordering for a message's blocks: consecutive `toolCall` blocks
 * merge into a single tool run whose expansion is driven by the transcript
 * level (the last two runs of an active response stay open). Single
 * thinking blocks merge into a run with its own content and timing. Empty
 * reasoning-only payloads have no visible marker. Source indices keep a run's
 * identity stable as streaming blocks are appended or grouped.
 */
type RenderItem = { key: string } & (
  | { kind: "block"; block: PineContentBlock }
  | {
      kind: "text";
      segments: TranscriptTextSegment[];
      /** Another block follows, so this text block has ended. */
      followed: boolean;
    }
  | { kind: "toolCall"; toolCall: PineToolCall }
  | { kind: "toolRun"; toolCalls: PineToolCall[] }
  | {
      kind: "thinking";
      message: PineTranscriptMessage;
      hasResponseAfterThinking: boolean;
    }
);

/**
 * The store replaces a block object whenever it changes and keeps the others,
 * so a block's segments are split only once per version of that block.
 */
const segmentsByBlock = new WeakMap<object, TranscriptTextSegment[]>();

function blockSegments(
  block: Extract<PineContentBlock, { type: "text" }>,
): TranscriptTextSegment[] {
  const raw = toRaw(block);
  let segments = segmentsByBlock.get(raw);
  if (!segments) {
    segments = splitTranscriptText(block.text);
    segmentsByBlock.set(raw, segments);
  }
  return segments;
}

type ThinkingSummary = Pick<
  PineTranscriptMessage,
  "thinkingStatus" | "thinkingStartedAt" | "thinkingDurationMs"
>;

/**
 * Last message handed to each thinking run's marker, by item key. It is
 * reused while the run's blocks and its timing are unchanged, so a finished
 * thinking marker is not updated while later blocks stream. The marker reads
 * only the id, the blocks and the timing fields.
 */
const thinkingMessages = new Map<
  string,
  { run: PineContentBlock[]; message: PineTranscriptMessage }
>();
/** Last tool call list per tool run, by item key, reused while unchanged. */
const toolRunCalls = new Map<string, PineToolCall[]>();

function thinkingMessage(
  key: string,
  run: PineContentBlock[],
  summary: ThinkingSummary,
): PineTranscriptMessage {
  const cached = thinkingMessages.get(key);
  if (
    cached &&
    cached.message.id === props.message.id &&
    cached.message.thinkingStatus === summary.thinkingStatus &&
    cached.message.thinkingStartedAt === summary.thinkingStartedAt &&
    cached.message.thinkingDurationMs === summary.thinkingDurationMs &&
    sameItems(cached.run, run)
  ) {
    return cached.message;
  }
  const message = {
    ...props.message,
    blocks: run,
    thinkingStatus: summary.thinkingStatus,
    thinkingStartedAt: summary.thinkingStartedAt,
    thinkingDurationMs: summary.thinkingDurationMs,
  };
  thinkingMessages.set(key, { run, message });
  return message;
}

function stableToolCalls(
  key: string,
  toolCalls: PineToolCall[],
): PineToolCall[] {
  const cached = toolRunCalls.get(key);
  if (cached && sameItems(cached, toolCalls)) return cached;
  toolRunCalls.set(key, toolCalls);
  return toolCalls;
}

const renderItems = computed<RenderItem[]>(() => {
  const blocks = props.message.blocks;
  const items: RenderItem[] = [];
  const thinkingRuns = blocks.filter(
    (block, index) =>
      block.type === "thinking" && blocks[index - 1]?.type !== "thinking",
  ).length;
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    const key = `${block.type}:${index}`;
    if (block.type === "thinking") {
      const start = index;
      while (index < blocks.length && blocks[index].type === "thinking") {
        index++;
      }
      const run = blocks.slice(start, index);
      if (
        !run.some((part) => part.type === "thinking" && part.thinking.trim())
      ) {
        continue;
      }
      const states = run.flatMap((_, offset) => {
        const state = props.message.thinkingBlocks?.[start + offset];
        return state ? [state] : [];
      });
      // Older history has only message-level timing. Do not repeat that total
      // on separate runs, which would falsely give each the whole duration.
      const summary: ThinkingSummary = states.length
        ? summarizeThinking(states)
        : thinkingRuns === 1
          ? props.message
          : { thinkingStatus: props.message.thinkingStatus };
      items.push({
        key,
        kind: "thinking",
        message: thinkingMessage(key, run, summary),
        hasResponseAfterThinking: blocks
          .slice(index)
          .some((part) => part.type !== "thinking"),
      });
    } else if (block.type === "toolCall") {
      const start = index;
      while (index < blocks.length && blocks[index].type === "toolCall") {
        index++;
      }
      const calls = blocks
        .slice(start, index)
        .map((item): PineToolCall | undefined =>
          item.type === "toolCall" ? item.toolCall : undefined,
        )
        .filter((item): item is PineToolCall => item !== undefined);
      const toolCalls = stableToolCalls(key, calls);
      // A single tool call renders in full instead of being folded away.
      if (toolCalls.length === 1) {
        items.push({ key, kind: "toolCall", toolCall: toolCalls[0] });
      } else {
        items.push({ key, kind: "toolRun", toolCalls });
      }
    } else if (block.type === "text") {
      // Blank text (a progress report whose content has not arrived, or an
      // invalid one) shows nothing instead of an empty bubble.
      const segments = blockSegments(block);
      if (segments.length > 0)
        items.push({
          key,
          kind: "text",
          segments,
          followed: index < blocks.length - 1,
        });
      index++;
    } else {
      items.push({ key, kind: "block", block });
      index++;
    }
  }
  return items;
});

/**
 * A text block that another block follows has ended and renders as final
 * (no fade, settled layout) while the message still streams. A block that
 * ends in front of the reader keeps streaming mode until its last fade has
 * played, so the switch shows nothing; one already ended when the row mounts
 * has no fade in flight and settles at once.
 */
const SETTLE_AFTER_END_MS = 1_000;
const endedTextKeys = computed(() =>
  isUser.value || props.message.status === "complete"
    ? ""
    : renderItems.value
        .flatMap((item) =>
          item.kind === "text" && item.followed ? [item.key] : [],
        )
        .join("\n"),
);
const settledTextKeys = shallowRef<ReadonlySet<string>>(
  new Set(endedTextKeys.value ? endedTextKeys.value.split("\n") : []),
);
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>();

watch(endedTextKeys, (keys) => {
  if (!keys) return;
  for (const key of keys.split("\n")) {
    if (settledTextKeys.value.has(key) || settleTimers.has(key)) continue;
    settleTimers.set(
      key,
      setTimeout(() => {
        settleTimers.delete(key);
        settledTextKeys.value = new Set([...settledTextKeys.value, key]);
      }, SETTLE_AFTER_END_MS),
    );
  }
});
onUnmounted(() => {
  for (const timer of settleTimers.values()) clearTimeout(timer);
  settleTimers.clear();
});

/** Whether a text item's markdown segment renders as final. */
function segmentFinal(
  item: Extract<RenderItem, { kind: "text" }>,
  segmentIndex: number,
): boolean {
  return (
    props.message.status === "complete" ||
    settledTextKeys.value.has(item.key) ||
    segmentIndex < item.segments.length - 1
  );
}

/**
 * Markdown segments seen streaming on this mount render block by block, so
 * a flush re-renders only the block being written instead of the whole
 * reply. A segment stays in blocks until the row unmounts, so finishing
 * re-lays nothing out; a reply already finished when the row mounts renders
 * in one piece. `flow-join` collapses the blocks' margins as one render does.
 * A segment with footnotes or link reference definitions resolves them
 * across blocks, so it renders in one piece from then on.
 */
const markdownBlockViews = new Map<string, MarkdownBlockView | null>();
const segmentBlocks = computed(() => {
  const blocks = new Map<string, readonly MarkdownBlockItem[]>();
  for (const item of renderItems.value) {
    if (item.kind !== "text") continue;
    item.segments.forEach((segment, segmentIndex) => {
      if (segment.kind !== "markdown") return;
      const key = `${item.key}:${segmentIndex}`;
      const final = segmentFinal(item, segmentIndex);
      let view = markdownBlockViews.get(key);
      if (view === null) return;
      if (hasDocumentLevelDefinitions(segment.text)) {
        markdownBlockViews.set(key, null);
        return;
      }
      if (!view) {
        if (final) return;
        view = createMarkdownBlockView();
        markdownBlockViews.set(key, view);
      }
      blocks.set(key, view(segment.text, final));
    });
  }
  return blocks;
});

/**
 * User bubbles taller than their max height scroll inside an overlay
 * scrollbar with edge fades. Shorter ones, nearly all of them, render the
 * same boxes without the scroll area; a bubble switches once its text
 * outgrows the max height, for example when the window narrows.
 */
const userTextViewport = ref<HTMLElement | null>(null);
const userTextOverflows = ref(false);
let userTextObserver: ResizeObserver | undefined;

function measureUserText(): void {
  const viewport = userTextViewport.value;
  if (!viewport || userTextOverflows.value) return;
  if (viewport.scrollHeight > viewport.clientHeight) {
    userTextOverflows.value = true;
    stopObservingUserText();
  }
}

function stopObservingUserText(): void {
  userTextObserver?.disconnect();
  userTextObserver = undefined;
}

watch(userTextViewport, (viewport) => {
  stopObservingUserText();
  if (!viewport || userTextOverflows.value) return;
  measureUserText();
  if (userTextOverflows.value || typeof ResizeObserver === "undefined") return;
  userTextObserver = new ResizeObserver(measureUserText);
  userTextObserver.observe(viewport);
  const text = viewport.firstElementChild;
  if (text) userTextObserver.observe(text);
});
// Assistant rows never show the bubble; tracking their body would join the
// whole streaming reply on every flush.
watch(() => (isUser.value ? relay.value.body : undefined), measureUserText, {
  flush: "post",
});
onMounted(measureUserText);
onUnmounted(stopObservingUserText);
</script>
<template>
  <Message ref="messageRoot" :align="isUser ? 'end' : 'start'">
    <MessageContent
      :class="
        cn(
          !isUser && 'gap-3',
          isUser && (attachments.length > 0 || quotes.length > 0) && 'gap-1.5',
        )
      "
    >
      <!-- Non-user messages render blocks in their original order so a tool
           call that happens after body text appears after that text. -->
      <template v-if="!isUser">
        <template v-for="item in renderItems" :key="item.key">
          <ProjectThinkingMarker
            v-if="item.kind === 'thinking'"
            :message="item.message"
            :has-response-after-thinking="item.hasResponseAfterThinking"
          />
          <ProjectErrorMarker
            v-else-if="item.kind === 'block' && item.block.type === 'error'"
            :error="item.block.error"
          />
          <ProjectStoppedMarker
            v-else-if="item.kind === 'block' && item.block.type === 'stopped'"
          />
          <ProjectCompactionMarker
            v-else-if="
              item.kind === 'block' && item.block.type === 'compaction'
            "
            :compaction="item.block.compaction"
          />
          <ProjectBackgroundTaskMarker
            v-else-if="
              item.kind === 'block' && item.block.type === 'backgroundTask'
            "
            :task="item.block.task"
          />
          <ProjectSessionNoticeMarker
            v-else-if="
              item.kind === 'block' && item.block.type === 'sessionNotice'
            "
            :notice="item.block.notice"
          />
          <ProjectToolCallMarker
            v-else-if="item.kind === 'toolCall'"
            :tool-call="item.toolCall"
            :context-tool-calls="contextToolCalls"
            :reviewing="reviewingToolCallIds?.has(item.toolCall.id) ?? false"
            :awaiting-approval="
              awaitingApprovalToolCallIds?.has(item.toolCall.id) ?? false
            "
            :open-file="openFile"
          />
          <ProjectToolCallGroup
            v-else-if="item.kind === 'toolRun'"
            :message="message"
            :tool-calls="item.toolCalls"
            :expanded="expandedToolRuns?.has(runKey(item.toolCalls))"
            :reviewing-tool-call-ids="reviewingToolCallIds"
            :awaiting-approval-tool-call-ids="awaitingApprovalToolCallIds"
            :open-file="openFile"
          />
          <Bubble
            v-else-if="item.kind === 'text'"
            class="w-full"
            :variant="'ghost'"
          >
            <!-- BubbleContent clips overflow, and a card's ring is drawn 1px
                 outside its box: pad 1px per side and cancel it with a
                 negative margin so the ring is not cut off. -->
            <BubbleContent
              class="transcript-prose -mx-px w-[calc(100%+2px)] max-w-none px-px!"
            >
              <!-- Interactive blocks render beside the markdown, not inside
                   it, so the markdown renderer's styles stay off them. -->
              <template
                v-for="(segment, segmentIndex) in item.segments"
                :key="segmentIndex"
              >
                <template
                  v-if="
                    segment.kind === 'markdown' &&
                    segmentBlocks.has(`${item.key}:${segmentIndex}`)
                  "
                >
                  <MarkdownContent
                    v-for="(block, blockIndex) in segmentBlocks.get(
                      `${item.key}:${segmentIndex}`,
                    )"
                    :key="block.key"
                    :source="block.source"
                    :final="block.final"
                    :flow-join="
                      markdownFlowJoin(
                        blockIndex,
                        segmentBlocks.get(`${item.key}:${segmentIndex}`)!
                          .length,
                      )
                    "
                  />
                </template>
                <MarkdownContent
                  v-else-if="segment.kind === 'markdown'"
                  :source="segment.text"
                  :final="segmentFinal(item, segmentIndex)"
                />
                <IntelligentUiBlock
                  v-else
                  :code="segment.code"
                  :streaming="!segment.closed && message.status !== 'complete'"
                  :message-id="message.id"
                />
              </template>
            </BubbleContent>
          </Bubble>
        </template>
      </template>

      <!-- User attachments sit above and align with the secondary bubble. -->
      <template v-else>
        <ProjectAttachmentList
          v-if="attachments.length > 0"
          class="max-w-[80%] self-end py-0"
          :attachments="attachments"
          surface="message"
          @open="openAttachment"
        />
        <ProjectQuoteList
          v-if="quotes.length > 0"
          class="max-w-[80%] self-end py-0"
          :quotes="quotes"
          surface="message"
        />
        <ProjectRelaySource
          v-if="!isEditing && !automationRun && relay.source"
          :source="relay.source"
        />
        <template v-if="isEditing">
          <!-- Auto width: the editor starts at the original bubble's width and
               grows with its longest line up to the bubble's max width. -->
          <Bubble variant="secondary">
            <BubbleContent
              class="border-ring ring-3 ring-ring/30 transition-shadow"
            >
              <Textarea
                ref="editInput"
                v-model="editDraft"
                data-slot="user-message-editor"
                class="scroll-fade-y max-h-80 min-h-0 w-auto max-w-full min-w-16 overflow-y-auto rounded-none border-0 bg-transparent p-0 text-sm leading-relaxed focus-visible:ring-0 md:text-sm dark:bg-transparent"
                :aria-label="t('project.transcript.editMessageLabel')"
                @keydown="handleEditKeydown"
              />
            </BubbleContent>
          </Bubble>
          <div
            data-slot="user-message-edit-actions"
            class="flex items-center justify-end gap-2"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              :disabled="isSendingEdit"
              @click="cancelEditing"
            >
              {{ t("common.cancel") }}
            </Button>
            <Button
              type="button"
              size="sm"
              :disabled="!canSendEdit"
              @click="sendEdit"
            >
              {{ t("project.transcript.sendEditedMessage") }}
            </Button>
          </div>
        </template>
        <ProjectAutomationRunMessage
          v-else-if="automationRun"
          :run="automationRun"
        />
        <div
          v-else-if="text"
          data-slot="user-message-row"
          class="group/user-message relative flex w-fit max-w-[80%] self-end items-start justify-end"
        >
          <!-- Ghost icon buttons (size-7, size-4 glyph) carry 6px of invisible
               inset on each side; subtract it so the pencil glyph sits a true
               --spacing(5) from the bubble edge, wider than the glyph-to-glyph
               spacing inside the group. The group is as tall as a one-line
               bubble (1px borders, py-2.5, text-sm leading-relaxed) so it
               stays centered on the first line of taller messages. -->
          <div
            data-slot="user-message-actions"
            class="absolute top-0 right-full mr-[calc(--spacing(5)_-_(--spacing(7)_-_--spacing(4))_/_2)] flex h-[calc(2px_+_2_*_--spacing(2.5)_+_var(--text-sm)_*_var(--leading-relaxed))] shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/user-message:opacity-100 focus-within:opacity-100"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :aria-label="t('project.transcript.copyMessage')"
              @click="copyMessage"
            >
              <CheckIcon v-if="copied" />
              <CopyIcon v-else />
            </Button>
            <Button
              v-if="rewriteMessage"
              type="button"
              variant="ghost"
              size="icon-sm"
              :disabled="!canRewrite"
              :aria-label="t('project.transcript.editMessage')"
              @click="startEditing"
            >
              <PencilIcon />
            </Button>
          </div>
          <!-- Same hover tint shadcn's secondary bubble applies to
               interactive content, scoped to hovering the whole row. -->
          <Bubble
            variant="secondary"
            class="max-w-full *:data-[slot=bubble-content]:transition-colors group-hover/user-message:*:data-[slot=bubble-content]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"
          >
            <BubbleContent>
              <!-- The overlay scrollbar takes no width and, reaching into the
                   bubble's end padding, sits on the bubble's edge. -->
              <ScrollArea
                v-if="userTextOverflows"
                class="-me-3.5 [&>[data-slot=scroll-area-viewport]]:max-h-80 [&>[data-slot=scroll-area-viewport]]:scroll-fade-y"
              >
                <div
                  data-slot="user-message-text"
                  class="pe-3.5 whitespace-pre-wrap"
                >
                  {{ relay.body }}
                </div>
              </ScrollArea>
              <!-- The scroll area's boxes, without the overlay scrollbar and
                   the edge fades a bubble that cannot scroll never shows. -->
              <div v-else class="relative -me-3.5">
                <div
                  ref="userTextViewport"
                  tabindex="0"
                  class="size-full max-h-80 overflow-hidden rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1"
                >
                  <div>
                    <div
                      data-slot="user-message-text"
                      class="pe-3.5 whitespace-pre-wrap"
                    >
                      {{ relay.body }}
                    </div>
                  </div>
                </div>
              </div>
            </BubbleContent>
          </Bubble>
        </div>
      </template>
    </MessageContent>
  </Message>
</template>
