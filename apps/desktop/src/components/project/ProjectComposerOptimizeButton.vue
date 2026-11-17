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
  // Inline, the spectrum shows only on hover, so the button stays quiet
  // beside Send until it is reached for. Its text stays muted on hover so
  // the spectrum can fade over it and back without a flash of foreground.
  isInline.value
    ? "composer-optimize-inline group/optimize min-w-0 text-muted-foreground hover:text-muted-foreground"
    : // Below the composer, a running optimization keeps its flowing label
      // at full strength; the button is still disabled.
      cn("min-w-0", props.isRewriting && "disabled:opacity-100"),
);
const modifierHeld = useModifierHold();
const altLabel = (window.pine?.platform ?? "darwin") === "darwin" ? "⌥" : "Alt";
const showsUndo = computed(() => props.canUndo && !props.isRewriting);
const label = computed(() =>
  props.isRewriting
    ? t("project.composer.optimizingPrompt")
    : t("project.composer.optimizePrompt"),
);
const labelClass = computed(() =>
  cn(
    "composer-optimize-label truncate",
    isInline.value
      ? props.isRewriting
        ? "shimmer"
        : "composer-optimize-hover-spectrum"
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
        :class="
          isInline
            ? 'transition-colors duration-200 group-enabled/optimize:group-hover/optimize:text-[var(--spectrum-1)]'
            : 'text-[var(--spectrum-1)]'
        "
      />
      <span :class="labelClass" :data-label="label">
        {{ label }}
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

<style scoped>
/* The spectrum copy of the inline label sits over the muted text and fades
   in on hover while the muted text fades out, both ways. */
.composer-optimize-hover-spectrum {
  position: relative;
  transition: color 200ms ease-out;
}

.composer-optimize-hover-spectrum::after {
  content: attr(data-label);
  position: absolute;
  inset: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background-image: linear-gradient(
    90deg,
    var(--spectrum-1),
    var(--spectrum-2),
    var(--spectrum-3),
    var(--spectrum-4),
    var(--spectrum-5)
  );
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease-out;
}

.composer-optimize-inline:enabled:hover .composer-optimize-hover-spectrum {
  color: transparent;
}

.composer-optimize-inline:enabled:hover
  .composer-optimize-hover-spectrum::after {
  opacity: 1;
}
</style>
