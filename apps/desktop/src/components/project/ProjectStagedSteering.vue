<script setup lang="ts">
import { SendHorizontalIcon, Undo2Icon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { parseAttachmentMessage } from "@/shared/attachments";
import { parseQuoteMessage } from "@/shared/quotes";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import ProjectAttachmentList from "./ProjectAttachmentList.vue";
import ProjectQuoteList from "./ProjectQuoteList.vue";

const props = defineProps<{
  steeringMessages: readonly string[];
}>();
const emit = defineEmits<{
  withdrawSteering: [message: string];
  sendSteeringNow: [message: string];
}>();
const { t } = useI18n();

const stagedSteeringMessages = computed(() =>
  props.steeringMessages.map((message) => {
    const parsed = parseAttachmentMessage(message);
    return {
      message,
      attachments: parsed.attachments,
      ...parseQuoteMessage(parsed.prompt),
    };
  }),
);

async function openAttachment(path: string): Promise<void> {
  try {
    const result = await window.pine.openAttachment({ path });
    if (!result.opened) throw new Error(result.error);
  } catch {
    toast.error(t("project.composer.attachmentOpenFailed"));
  }
}
</script>

<template>
  <!-- The transcript tail cancels the gap above it (-mt-8), so the staged
       messages restore it with their own top margin, as the status row does
       with its padding. -->
  <div
    v-if="props.steeringMessages.length > 0"
    data-slot="staged-steering-messages"
    class="scroll-fade-y no-scrollbar pointer-events-auto mt-8 flex max-h-64 flex-col items-end gap-2 overflow-y-auto overscroll-contain"
  >
    <div
      v-for="(steeringMessage, index) in stagedSteeringMessages"
      :key="`${steeringMessage.message}-${index}`"
      data-slot="staged-steering-message"
      class="flex w-full items-end justify-end gap-2"
    >
      <!-- Attachments and quotes stack above the bubble, so the actions sit
           on the row's bottom edge at the height of a one-line bubble
           (1px borders, py-2.5, text-sm leading-relaxed) and stay centered
           on the bubble instead of on the whole message. -->
      <div
        class="flex h-[calc(2px_+_2_*_--spacing(2.5)_+_var(--text-sm)_*_var(--leading-relaxed))] shrink-0 items-center gap-1"
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          :aria-label="t('project.composer.withdrawSteering')"
          @click="emit('withdrawSteering', steeringMessage.message)"
        >
          <Undo2Icon />
          {{ t("project.composer.withdrawSteeringLabel") }}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          :aria-label="t('project.composer.sendSteeringNow')"
          @click="emit('sendSteeringNow', steeringMessage.message)"
        >
          <SendHorizontalIcon />
          {{ t("project.composer.sendSteeringNowLabel") }}
        </Button>
      </div>
      <div
        data-steering-content
        class="flex max-w-[80%] min-w-0 flex-col items-end gap-1.5"
      >
        <ProjectAttachmentList
          v-if="steeringMessage.attachments.length > 0"
          class="py-0"
          :attachments="steeringMessage.attachments"
          surface="message"
          @open="openAttachment"
        />
        <ProjectQuoteList
          v-if="steeringMessage.quotes.length > 0"
          class="py-0"
          :quotes="steeringMessage.quotes"
          surface="message"
        />
        <!-- The wrapper already caps the width; Bubble's own 80% cap would
             compound with it and wrap text well before the edge. -->
        <Bubble
          v-if="steeringMessage.prompt"
          align="end"
          variant="outline"
          class="max-w-full"
        >
          <BubbleContent class="border-dashed">
            <div
              class="scroll-fade-y max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap"
            >
              {{ steeringMessage.prompt }}
            </div>
          </BubbleContent>
        </Bubble>
      </div>
    </div>
  </div>
</template>
