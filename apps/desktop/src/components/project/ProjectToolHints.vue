<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import FirstUseHint from "@/components/help/FirstUseHint.vue";
import { MEMORY_SAVE_TOOL_NAME } from "@/shared/memory";
import type { PineToolCall } from "@/shared/sessions";
import { skillOperationKey, toolKind } from "./toolKinds";

/**
 * One-time hints for the tools a user meets in the transcript: below a
 * finished tool call (or folded run of them) that saved a memory note,
 * used a Skill or called an MCP tool.
 */
const props = defineProps<{ toolCalls: readonly PineToolCall[] }>();

const { t } = useI18n();

const done = computed(() =>
  props.toolCalls.filter((toolCall) => toolCall.status === "complete"),
);
const savedMemory = computed(() =>
  done.value.some((toolCall) => toolCall.name === MEMORY_SAVE_TOOL_NAME),
);
const usedSkill = computed(() =>
  done.value.some((toolCall) => skillOperationKey(toolCall.name) === "invoke"),
);
const usedMcp = computed(() =>
  done.value.some((toolCall) => toolKind(toolCall.name) === "mcp"),
);
</script>

<template>
  <FirstUseHint
    v-if="savedMemory"
    id="memory-saved"
    :text="t('help.hints.memorySaved')"
    :guide="{ topic: 'memory' }"
  />
  <FirstUseHint
    v-if="usedSkill"
    id="skill-used"
    :text="t('help.hints.skillUsed')"
    :guide="{ topic: 'skills' }"
  />
  <FirstUseHint
    v-if="usedMcp"
    id="mcp-used"
    :text="t('help.hints.mcpUsed')"
    :guide="{ topic: 'mcp' }"
  />
</template>
