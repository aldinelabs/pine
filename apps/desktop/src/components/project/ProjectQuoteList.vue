<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { TextQuoteIcon, XIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { cn } from "@/lib/utils";
import type { PineQuote } from "@/shared/quotes";

/**
 * Passages quoted from the conversation, as attachments beside the files: in
 * the composer each can be removed; in a sent message they sit above its
 * bubble. A surface with its own corner passes it through `itemClass`
 * and keeps the icon tile concentric through `mediaClass`.
 */
const props = withDefaults(
  defineProps<{
    quotes: readonly PineQuote[];
    class?: HTMLAttributes["class"];
    itemClass?: HTMLAttributes["class"];
    mediaClass?: HTMLAttributes["class"];
    removable?: boolean;
    surface: "composer" | "message";
  }>(),
  { removable: false },
);

const emit = defineEmits<{ remove: [index: number] }>();
const { t } = useI18n();
</script>

<template>
  <AttachmentGroup
    data-slot="quote-list"
    :aria-label="t('project.quote.listLabel')"
    :class="cn('items-end gap-1.5', props.class)"
    role="list"
  >
    <Attachment
      v-for="(quote, index) in quotes"
      :key="index"
      data-slot="quote"
      size="sm"
      role="listitem"
      :class="
        cn(
          'max-w-64',
          surface === 'composer' &&
            'rounded-[var(--session-composer-attachment-radius)]',
          props.itemClass,
        )
      "
      :title="quote.text"
    >
      <AttachmentMedia :class="props.mediaClass">
        <TextQuoteIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{{ quote.text }}</AttachmentTitle>
        <AttachmentDescription>
          {{ t("project.quote.label") }}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions v-if="removable">
        <AttachmentAction
          type="button"
          :aria-label="t('project.quote.remove')"
          @click="emit('remove', index)"
        >
          <XIcon />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  </AttachmentGroup>
</template>
