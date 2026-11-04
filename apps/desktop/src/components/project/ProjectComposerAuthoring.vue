<script setup lang="ts">
import {
  CalendarClockIcon,
  ServerCogIcon,
  WandSparklesIcon,
  XIcon,
} from "@lucide/vue";
import type { Component } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import type { PineAuthoringTarget } from "@/shared/sessionMutators";

/**
 * What a "Create with Pine" draft sets up: the authoring tools its first
 * message turns on. Removing one turns the draft into an ordinary one.
 */
defineProps<{ targets: readonly PineAuthoringTarget[] }>();
const emit = defineEmits<{ remove: [target: PineAuthoringTarget] }>();

const { t } = useI18n();
const ICONS: Record<PineAuthoringTarget, Component> = {
  skill: WandSparklesIcon,
  automation: CalendarClockIcon,
  mcp: ServerCogIcon,
};
</script>

<template>
  <div data-slot="composer-authoring" class="flex flex-wrap gap-1.5">
    <div
      v-for="target in targets"
      :key="target"
      :data-target="target"
      class="flex min-w-0 items-center gap-2 rounded-[var(--session-composer-attachment-radius)] bg-muted/60 py-1 pr-1 pl-2.5 text-xs"
    >
      <component
        :is="ICONS[target]"
        class="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span class="truncate">
        {{ t(`project.composer.authoring.${target}`) }}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        class="size-5 shrink-0"
        :aria-label="t('project.composer.authoring.remove')"
        @click="emit('remove', target)"
      >
        <XIcon />
      </Button>
    </div>
  </div>
</template>
