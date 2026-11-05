<script setup lang="ts">
import { PlusIcon, XIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  parseToolList,
  skillToolGroups,
  type SkillToolGroup,
} from "./skillForm";

interface Props {
  disabled?: boolean;
  inputId?: string;
}

const props = defineProps<Props>();
const tools = defineModel<string[]>({ required: true });
const { t } = useI18n();
const draft = ref("");

const groups = skillToolGroups(window.pine?.platform);
const commonTools = groups.flatMap((group) =>
  group.options.map((option) => option.tool),
);
const commonSelection = computed(() =>
  tools.value.filter((tool) => commonTools.includes(tool)),
);
const customTools = computed(() =>
  tools.value.filter((tool) => !commonTools.includes(tool)),
);

function groupSelection(group: SkillToolGroup): string[] {
  const groupTools = group.options.map((option) => option.tool);
  return commonSelection.value.filter((tool) => groupTools.includes(tool));
}

function updateGroup(group: SkillToolGroup, value: unknown): void {
  const groupTools = group.options.map((option) => option.tool);
  const picked = Array.isArray(value) ? value.map(String) : [];
  const selected = new Set([
    ...commonSelection.value.filter((tool) => !groupTools.includes(tool)),
    ...picked,
  ]);
  // Keep the display order stable instead of the click order.
  const common = commonTools.filter((tool) => selected.has(tool));
  tools.value = [...common, ...customTools.value];
}

function addCustom(): void {
  const added = parseToolList(draft.value);
  draft.value = "";
  if (added.length === 0) return;
  tools.value = [...new Set([...tools.value, ...added])];
}

function removeCustom(tool: string): void {
  tools.value = tools.value.filter((entry) => entry !== tool);
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-for="group in groups"
      :key="group.id"
      class="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-2 max-sm:grid-cols-1"
    >
      <span class="pt-1.5 text-xs text-muted-foreground">
        {{ t(`skills.toolGroups.${group.id}`) }}
      </span>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        :spacing="1"
        class="flex-wrap"
        :disabled="props.disabled"
        :model-value="groupSelection(group)"
        @update:model-value="updateGroup(group, $event)"
      >
        <ToggleGroupItem
          v-for="option in group.options"
          :key="option.tool"
          :value="option.tool"
          :data-testid="`skill-tool-${option.tool}`"
          class="gap-1.5 data-[state=on]:border-primary/40"
        >
          {{ t(`skills.tools.${option.label}`) }}
          <code class="font-mono text-[11px] text-muted-foreground">
            {{ option.tool }}
          </code>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>

    <div v-if="customTools.length > 0" class="flex flex-wrap gap-1.5">
      <Badge
        v-for="tool in customTools"
        :key="tool"
        variant="secondary"
        class="h-6 gap-1 pr-1 font-mono"
      >
        {{ tool }}
        <button
          type="button"
          class="rounded-full p-0.5 hover:bg-foreground/10 disabled:opacity-50"
          :disabled="props.disabled"
          :aria-label="t('skills.removeTool', { name: tool })"
          @click="removeCustom(tool)"
        >
          <XIcon class="size-3" />
        </button>
      </Badge>
    </div>

    <InputGroup v-if="!props.disabled">
      <InputGroupInput
        :id="props.inputId"
        v-model="draft"
        class="font-mono text-sm"
        :placeholder="t('skills.allowedToolsCustomPlaceholder')"
        @keydown.enter.prevent="addCustom"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="xs"
          :disabled="!draft.trim()"
          @click="addCustom"
        >
          <PlusIcon />
          {{ t("skills.allowedToolsAdd") }}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
</template>
