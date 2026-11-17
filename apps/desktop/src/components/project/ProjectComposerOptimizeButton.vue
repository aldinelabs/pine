<script setup lang="ts">
import { SparklesIcon, Undo2Icon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { InputGroupButton } from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import ModifierShortcut from "@/components/window/ModifierShortcut.vue";
import { useModifierHold } from "@/composables/useModifierHold";
import { cn } from "@/lib/utils";

/**
 * The composer's Optimize prompt button, or Undo optimization after a
 * rewrite. Below a draft's input (`footer`) it has a sparkles icon and a
 * gradient label, and holding Cmd/Ctrl shows its Option/Alt+Enter shortcut
 * beside it. Beside Send in a session (`inline`) it is muted like the
 * draft's project picker, and holding Cmd/Ctrl swaps its icon for the
 * shortcut.
 */
const props = withDefaults(
  defineProps<{
    canRewrite: boolean;
    isRewriting: boolean;
    canUndo: boolean;
    placement?: "footer" | "inline";
  }>(),
  { placement: "footer" },
);
const emit = defineEmits<{ optimize: []; undo: [] }>();

const { t } = useI18n();
const isInline = computed(() => props.placement === "inline");
const ButtonComponent = computed(() =>
  isInline.value ? InputGroupButton : Button,
);
const buttonClass = computed(() =>
  isInline.value ? "min-w-0 text-muted-foreground" : "min-w-0",
);
const modifierHeld = useModifierHold();
const altLabel = (window.pine?.platform ?? "darwin") === "darwin" ? "⌥" : "Alt";
const showsUndo = computed(() => props.canUndo && !props.isRewriting);
const labelClass = computed(() =>
  cn(
    "composer-optimize-label truncate",
    isInline.value
      ? props.isRewriting && "shimmer"
      : props.isRewriting
        ? "text-spectrum-flow"
        : "text-spectrum",
  ),
);
</script>

<template>
  <div class="relative flex min-w-0 shrink items-center">
    <component
      :is="ButtonComponent"
      v-if="showsUndo"
      data-slot="undo-prompt-optimization"
      :class="buttonClass"
      type="button"
      variant="ghost"
      size="sm"
      :aria-label="t('project.composer.undoPromptOptimization')"
      @click="emit('undo')"
    >
      <Undo2Icon data-icon="inline-start" />
      <span class="composer-optimize-label truncate">
        {{ t("project.composer.undoPromptOptimization") }}
      </span>
    </component>
    <component
      :is="ButtonComponent"
      v-else
      data-slot="optimize-prompt-trigger"
      :class="buttonClass"
      type="button"
      variant="ghost"
      size="sm"
      :disabled="!props.canRewrite"
      :aria-busy="props.isRewriting || undefined"
      :aria-label="t('project.composer.optimizePrompt')"
      aria-keyshortcuts="Alt+Enter"
      @click="emit('optimize')"
    >
      <KbdGroup v-if="isInline && modifierHeld" aria-hidden="true">
        <Kbd>{{ altLabel }}</Kbd>
        <Kbd>↵</Kbd>
      </KbdGroup>
      <SparklesIcon
        v-else
        data-icon="inline-start"
        :class="!isInline && 'text-[var(--spectrum-1)]'"
      />
      <span :class="labelClass">
        {{
          props.isRewriting
            ? t("project.composer.optimizingPrompt")
            : t("project.composer.optimizePrompt")
        }}
      </span>
    </component>
    <ModifierShortcut
      v-if="!isInline && !showsUndo"
      class="pointer-events-none absolute left-full ml-1"
      modifier="alt"
      key-label="↵"
    />
  </div>
</template>
