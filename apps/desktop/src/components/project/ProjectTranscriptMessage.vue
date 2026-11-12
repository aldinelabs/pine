<script setup lang="ts">
import { CheckIcon, CopyIcon, PencilIcon } from "@lucide/vue";
import { computed, nextTick, onUnmounted, ref } from "vue";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
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

async function startEditing(): Promise<void> {
  editDraft.value = text.value;
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
const contextToolCalls = computed(() =>
  props.message.blocks.flatMap((block) =>
    block.type === "toolCall" ? [block.toolCall] : [],
  ),
);

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
  | { kind: "text"; segments: TranscriptTextSegment[] }
  | { kind: "toolCall"; toolCall: PineToolCall }
  | { kind: "toolRun"; toolCalls: PineToolCall[] }
  | {
      kind: "thinking";
      message: PineTranscriptMessage;
      hasResponseAfterThinking: boolean;
      hasTextAfterThinking: boolean;
    }
);

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
      const summary: Pick<
        PineTranscriptMessage,
        "thinkingStatus" | "thinkingStartedAt" | "thinkingDurationMs"
      > = states.length
        ? summarizeThinking(states)
        : thinkingRuns === 1
          ? props.message
          : { thinkingStatus: props.message.thinkingStatus };
      items.push({
        key,
        kind: "thinking",
        message: {
          ...props.message,
          blocks: run,
          thinkingStatus: summary.thinkingStatus,
          thinkingStartedAt: summary.thinkingStartedAt,
          thinkingDurationMs: summary.thinkingDurationMs,
        },
        hasResponseAfterThinking: blocks
          .slice(index)
          .some((part) => part.type !== "thinking"),
        hasTextAfterThinking: blocks
          .slice(index)
          .some((part) => part.type === "text"),
      });
    } else if (block.type === "toolCall") {
      const start = index;
      while (index < blocks.length && blocks[index].type === "toolCall") {
        index++;
      }
      const toolCalls = blocks
        .slice(start, index)
        .map((item): PineToolCall | undefined =>
          item.type === "toolCall" ? item.toolCall : undefined,
        )
        .filter((item): item is PineToolCall => item !== undefined);
      // A single tool call renders in full instead of being folded away.
      if (toolCalls.length === 1) {
        items.push({ key, kind: "toolCall", toolCall: toolCalls[0] });
      } else {
        items.push({ key, kind: "toolRun", toolCalls });
      }
    } else if (block.type === "text") {
      // Blank text (a progress report whose content has not arrived, or an
      // invalid one) shows nothing instead of an empty bubble.
      const segments = splitTranscriptText(block.text);
      if (segments.length > 0) items.push({ key, kind: "text", segments });
      index++;
    } else {
      items.push({ key, kind: "block", block });
      index++;
    }
  }
  return items;
});
</script>
<template>
  <Message :align="isUser ? 'end' : 'start'">
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
            :has-text-after-thinking="item.hasTextAfterThinking"
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
                <MarkdownContent
                  v-if="segment.kind === 'markdown'"
                  :source="segment.text"
                  :final="
                    message.status === 'complete' ||
                    segmentIndex < item.segments.length - 1
                  "
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
                class="-me-3.5 [&>[data-slot=scroll-area-viewport]]:max-h-80 [&>[data-slot=scroll-area-viewport]]:scroll-fade-y"
              >
                <div
                  data-slot="user-message-text"
                  class="pe-3.5 whitespace-pre-wrap"
                >
                  {{ relay.body }}
                </div>
              </ScrollArea>
            </BubbleContent>
          </Bubble>
        </div>
      </template>
    </MessageContent>
  </Message>
</template>
