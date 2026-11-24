<script setup lang="ts">
import { MessageCircleIcon, MonitorIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import type { AssistantMessageSource } from "@/shared/assistant";

/** Where a message to the Assistant was written, shown above its bubble. */
defineProps<{ source: AssistantMessageSource }>();

const { t } = useI18n();
</script>

<template>
  <p
    data-testid="assistant-message-source"
    :data-source="source"
    class="flex items-center gap-1.5 self-end text-xs text-muted-foreground"
  >
    <MessageCircleIcon
      v-if="source === 'wechat'"
      class="size-3.5 shrink-0"
      aria-hidden="true"
    />
    <MonitorIcon v-else class="size-3.5 shrink-0" aria-hidden="true" />
    {{ t(`assistant.source.${source}`) }}
  </p>
</template>
