<script setup lang="ts">
import {
  AudioLinesIcon,
  CalendarClockIcon,
  ClapperboardIcon,
  FolderInputIcon,
  GlobeIcon,
  MessagesSquareIcon,
  MonitorCogIcon,
  PanelRightIcon,
  PlugIcon,
  SquareTerminal,
  WandSparklesIcon,
} from "@lucide/vue";
import type { Component } from "vue";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  defaultPineToolGroups,
  PINE_TOOL_GROUP_IDS,
  type PineToolGroupId,
} from "@/shared/toolGroups";

/**
 * Settings › Agent › Tools: one switch per family of Pine's tools. Off, the
 * agent gets none of that family's tools; open sessions pick the change up
 * when their next message starts, never in the middle of a reply.
 *
 * The icons match the ones tool calls show in the transcript. A row can add
 * a status sentence to its description (`<id>-status`) and a small control
 * before its switch (`<id>-action`), such as the web search key.
 */
const ICONS: Record<PineToolGroupId, Component> = {
  shell: SquareTerminal,
  web: GlobeIcon,
  computerUse: MonitorCogIcon,
  media: ClapperboardIcon,
  workbench: PanelRightIcon,
  liveContext: AudioLinesIcon,
  sessions: MessagesSquareIcon,
  projects: FolderInputIcon,
  skills: WandSparklesIcon,
  automations: CalendarClockIcon,
  mcp: PlugIcon,
};

const { t } = useI18n();
const groups = ref(defaultPineToolGroups());
const isLoading = ref(true);
const saving = ref(new Set<PineToolGroupId>());

onMounted(async () => {
  try {
    groups.value = await window.pine.getToolGroups();
  } catch (error) {
    handleError(error, {
      id: "preferences.tool-groups.load",
      title: t("preferences.toolGroups.loadFailed"),
    });
  } finally {
    isLoading.value = false;
  }
});

async function update(id: PineToolGroupId, next: boolean): Promise<void> {
  if (isLoading.value || saving.value.has(id) || groups.value[id] === next)
    return;
  const previous = groups.value[id];
  groups.value = { ...groups.value, [id]: next };
  saving.value = new Set([...saving.value, id]);
  try {
    const saved = await window.pine.setToolGroupEnabled({ id, enabled: next });
    groups.value = { ...groups.value, [id]: saved[id] };
  } catch (error) {
    groups.value = { ...groups.value, [id]: previous };
    handleError(error, {
      id: "preferences.tool-groups.save",
      title: t("preferences.toolGroups.saveFailed"),
    });
  } finally {
    const remaining = new Set(saving.value);
    remaining.delete(id);
    saving.value = remaining;
  }
}
</script>

<template>
  <template v-for="id in PINE_TOOL_GROUP_IDS" :key="id">
    <Field orientation="horizontal" :data-testid="`pine-tool-group-${id}`">
      <div
        class="flex size-8 shrink-0 items-center justify-center self-start rounded-lg bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <component :is="ICONS[id]" class="size-4" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle :id="`pine-tool-group-${id}-title`">
          {{ t(`preferences.toolGroups.${id}.title`) }}
        </FieldTitle>
        <FieldDescription :id="`pine-tool-group-${id}-description`">
          {{ t(`preferences.toolGroups.${id}.description`) }}
          <slot :name="`${id}-status`" />
        </FieldDescription>
      </div>
      <slot :name="`${id}-action`" />
      <Switch
        :data-testid="`pine-tool-group-${id}-toggle`"
        :model-value="groups[id]"
        :disabled="isLoading || saving.has(id)"
        :aria-labelledby="`pine-tool-group-${id}-title`"
        :aria-describedby="`pine-tool-group-${id}-description`"
        @update:model-value="(value: boolean) => void update(id, value)"
      />
    </Field>
  </template>
</template>
