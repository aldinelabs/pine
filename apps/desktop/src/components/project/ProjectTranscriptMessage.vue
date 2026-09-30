<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import { cn } from "@/lib/utils";
import {
  contentBlocksToText,
  type PineContentBlock,
  type PineToolCall,
} from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectAttachmentList from "./ProjectAttachmentList.vue";
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
  openFile?: (path: string) => boolean;
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
        <Bubble v-if="text" variant="secondary">
          <BubbleContent class="whitespace-pre-wrap">
            {{ text }}
          </BubbleContent>
        </Bubble>
      </template>
    </MessageContent>
  </Message>
</template>
