<script setup lang="ts">
import { CheckIcon, CopyIcon, PencilIcon } from "@lucide/vue";
import { computed, nextTick, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { serializeAttachmentMessage } from "@/shared/attachments";
import {
  contentBlocksToText,
  type PineContentBlock,
  type PineToolCall,
} from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectAttachmentList from "./ProjectAttachmentList.vue";
import ProjectBackgroundTaskMarker from "./ProjectBackgroundTaskMarker.vue";
import ProjectCompactionMarker from "./ProjectCompactionMarker.vue";
import ProjectErrorMarker from "./ProjectErrorMarker.vue";
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
    await navigator.clipboard.writeText(text.value);
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
    (editDraft.value.trim().length > 0 || attachments.value.length > 0),
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
      serializeAttachmentMessage(attachments.value, editDraft.value),
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
const attachments = computed(() =>
  props.message.blocks.flatMap((block) =>
    block.type === "attachments" ? block.attachments : [],
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
 * thinking/text/tool-call blocks pass through unchanged.
 */
type RenderItem =
  | { kind: "block"; block: PineContentBlock }
  | { kind: "toolCall"; toolCall: PineToolCall }
  | { kind: "toolRun"; toolCalls: PineToolCall[] };

const renderItems = computed<RenderItem[]>(() => {
  const blocks = props.message.blocks;
  const items: RenderItem[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.type === "toolCall") {
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
        items.push({ kind: "toolCall", toolCall: toolCalls[0] });
      } else {
        items.push({ kind: "toolRun", toolCalls });
      }
    } else {
      items.push({ kind: "block", block });
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
        cn(!isUser && 'gap-3', isUser && attachments.length > 0 && 'gap-1.5')
      "
    >
      <!-- Non-user messages render blocks in their original order so a tool
           call that happens after body text appears after that text. -->
      <template v-if="!isUser">
        <template v-for="(item, index) in renderItems" :key="index">
          <ProjectThinkingMarker
            v-if="item.kind === 'block' && item.block.type === 'thinking'"
            :message="message"
          />
          <ProjectErrorMarker
            v-else-if="item.kind === 'block' && item.block.type === 'error'"
            :error="item.block.error"
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
            v-else-if="item.kind === 'block' && item.block.type === 'text'"
            class="w-full"
            :variant="'ghost'"
          >
            <BubbleContent class="w-full">
              <MarkdownContent
                :source="item.block.text"
                :final="message.status === 'complete'"
              />
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
                class="scroll-fade-y max-h-80 min-h-0 w-auto max-w-full min-w-16 overflow-y-auto overscroll-contain rounded-none border-0 bg-transparent p-0 text-sm leading-relaxed focus-visible:ring-0 md:text-sm dark:bg-transparent"
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
        <div
          v-else-if="text"
          data-slot="user-message-row"
          class="group/user-message flex w-full items-start justify-end gap-[calc(--spacing(5)_-_(--spacing(7)_-_--spacing(4))_/_2)]"
        >
          <!-- Ghost icon buttons (size-7, size-4 glyph) carry 6px of invisible
               inset on each side; subtract it so the pencil glyph sits a true
               --spacing(5) from the bubble edge, wider than the glyph-to-glyph
               spacing inside the group. The group is as tall as a one-line
               bubble (1px borders, py-2.5, text-sm leading-relaxed) so it
               stays centered on the first line of taller messages. -->
          <div
            data-slot="user-message-actions"
            class="flex h-[calc(2px_+_2_*_--spacing(2.5)_+_var(--text-sm)_*_var(--leading-relaxed))] shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/user-message:opacity-100 focus-within:opacity-100"
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
            class="*:data-[slot=bubble-content]:transition-colors group-hover/user-message:*:data-[slot=bubble-content]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"
          >
            <BubbleContent>
              <div
                data-slot="user-message-text"
                class="scroll-fade-y max-h-80 overflow-y-auto overscroll-contain whitespace-pre-wrap"
              >
                {{ text }}
              </div>
            </BubbleContent>
          </Bubble>
        </div>
      </template>
    </MessageContent>
  </Message>
</template>
