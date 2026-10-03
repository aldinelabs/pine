<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Kbd } from "@/components/ui/kbd";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { projectIconComponent } from "@/lib/projectIcons";
import type { PineProject } from "@/shared/projects";

/**
 * Suggestions while a new session's composer asks for a project name. Focus
 * stays in the composer, which drives the highlight with the arrow keys.
 */
const props = defineProps<{
  listId: string;
  matches: readonly PineProject[];
  highlighted: number;
}>();
const emit = defineEmits<{
  highlight: [index: number];
  select: [project: PineProject];
}>();
const { t } = useI18n();
const displayName = useProjectDisplayName();

function optionId(index: number): string {
  return `${props.listId}-${index}`;
}

defineExpose({ optionId });
</script>

<template>
  <div class="flex flex-col gap-1">
    <div
      :id="props.listId"
      role="listbox"
      class="no-scrollbar flex max-h-64 flex-col overflow-y-auto"
      :aria-label="t('project.composer.chooseProjectLabel')"
    >
      <div
        v-for="(project, index) in props.matches"
        :id="optionId(index)"
        :key="project.id"
        role="option"
        data-slot="project-name-option"
        :aria-selected="index === props.highlighted"
        :data-highlighted="index === props.highlighted ? '' : undefined"
        class="relative flex min-h-7 cursor-default items-center gap-2 rounded-xl px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-muted data-highlighted:text-foreground [&_svg:not([class*=size-])]:size-4 [&_svg]:shrink-0"
        @mousedown.prevent
        @mousemove="emit('highlight', index)"
        @click="emit('select', project)"
      >
        <component :is="projectIconComponent(project)" />
        <span class="truncate">{{ displayName(project) }}</span>
      </div>
      <p
        v-if="props.matches.length === 0"
        class="py-2 text-center text-sm text-muted-foreground"
      >
        {{ t("project.composer.noProjectMatches") }}
      </p>
    </div>
    <p
      class="flex items-center gap-3 border-t px-2 pt-1.5 text-xs text-muted-foreground"
    >
      <span class="flex items-center gap-1">
        <Kbd>↵</Kbd>{{ t("project.composer.chooseProjectHint") }}
      </span>
      <span class="flex items-center gap-1">
        <Kbd>Esc</Kbd>{{ t("project.composer.skipProjectHint") }}
      </span>
    </p>
  </div>
</template>
