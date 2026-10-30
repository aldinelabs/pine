<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Kbd } from "@/components/ui/kbd";
import {
  attachmentImageUrl,
  isImageAttachment,
  type PineAttachment,
} from "@/shared/attachments";

/**
 * What the floating composer took from the app the user was in: a
 * screenshot of its window and the text selected there. It goes with the
 * message like attachments, but reads as one piece the keys can drop.
 */
const props = defineProps<{ context: readonly PineAttachment[] }>();

const { t } = useI18n();
const screenshot = computed(() => props.context.find(isImageAttachment));
const selection = computed(
  () => props.context.find((attachment) => attachment.selection)?.selection,
);
const source = computed(
  () => props.context.find((attachment) => attachment.source)?.source,
);
const detail = computed(
  () =>
    selection.value?.text.replace(/\s+/g, " ").trim() ??
    source.value?.url ??
    source.value?.documentPath,
);
</script>

<template>
  <div
    data-slot="composer-context"
    class="flex min-w-0 items-center gap-2.5 rounded-[var(--session-composer-attachment-radius)] bg-muted/60 p-1.5 pr-3"
  >
    <img
      v-if="screenshot"
      data-slot="composer-context-screenshot"
      :alt="screenshot.name"
      :src="attachmentImageUrl(screenshot.path)"
      class="h-9 w-14 shrink-0 rounded-[calc(var(--session-composer-attachment-radius)-0.375rem)] object-cover object-top"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
      <span class="truncate font-medium">
        {{ source?.app }}
        <span
          v-if="source?.windowTitle"
          class="font-normal text-muted-foreground"
        >
          · {{ source.windowTitle }}
        </span>
      </span>
      <span v-if="detail" class="truncate text-muted-foreground">
        {{
          selection
            ? t("project.composer.contextSelection", { text: detail })
            : detail
        }}
      </span>
    </div>
    <span
      class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
    >
      <Kbd>\</Kbd>
      <Kbd>⌫</Kbd>
      {{ t("project.composer.contextRemove") }}
    </span>
  </div>
</template>
