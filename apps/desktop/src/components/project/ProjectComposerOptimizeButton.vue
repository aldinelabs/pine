<script setup lang="ts">
import { SparklesIcon, Undo2Icon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { InputGroupButton } from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ModifierShortcut from "@/components/window/ModifierShortcut.vue";
import { useShortcutHints } from "@/composables/useShortcutHints";
import { cn } from "@/lib/utils";

/**
 * The composer's Optimize prompt button, or Undo optimization after a
 * rewrite. Below a draft's input (`footer`) it has a sparkles icon and a
 * gradient label, and holding Cmd/Ctrl shows its Cmd/Ctrl+Enter shortcut
 * beside it. Beside Send in a session (`inline`) it is muted like the
 * draft's project picker and rests as its icon and Cmd/Ctrl+Enter keys. On
 * hover or keyboard focus (and while optimizing) the keys fold away as the
 * label opens, growing leftwards over the text box rather than pushing it,
 * so nothing beside it moves.
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
const buttonClass = computed(() =>
  // Inline, the spectrum shows only on hover, so the button stays quiet
  // beside Send until it is reached for. Its text stays muted on hover so
  // the spectrum can fade over it and back without a flash of foreground.
  isInline.value
    ? "composer-optimize-inline group/optimize absolute inset-y-0 right-0 my-auto w-max gap-0 text-muted-foreground hover:text-muted-foreground"
    : // Below the composer, a running optimization keeps its flowing label
      // at full strength; the button is still disabled.
      cn("min-w-0", props.isRewriting && "disabled:opacity-100"),
);
const showShortcutHints = useShortcutHints();
const isMac = (window.pine?.platform ?? "darwin") === "darwin";
const modLabel = isMac ? "⌘" : "Ctrl";
const keyShortcut = isMac ? "Meta+Enter" : "Control+Enter";
const showsUndo = computed(() => props.canUndo && !props.isRewriting);
const label = computed(() =>
  props.isRewriting
    ? t("project.composer.optimizingPrompt")
    : t("project.composer.optimizePrompt"),
);
const labelClass = computed(() =>
  cn(
    "composer-optimize-label",
    // Inline, the label keeps its full width inside a clipping track, so
    // it is revealed rather than cut short with an ellipsis.
    isInline.value ? "whitespace-nowrap" : "truncate",
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
  <!-- Inline, the slot keeps the resting width (icon and keys) through an
       invisible copy; the button is anchored to its right edge and grows
       leftwards out of it. -->
  <div
    v-if="isInline"
    data-slot="composer-optimize-slot"
    class="composer-optimize-slot relative inline-grid shrink-0"
    :data-expanded="props.isRewriting || undefined"
  >
    <span
      class="composer-optimize-sizer invisible flex h-8 items-center border border-transparent pr-3 pl-2.5"
      aria-hidden="true"
    >
      <span class="size-4" />
      <span v-if="!showsUndo" class="composer-optimize-rest-kbd pl-1.5">
        <Kbd
          ><span>{{ modLabel }}</span
          ><span>↵</span></Kbd
        >
      </span>
    </span>
    <Tooltip>
      <TooltipTrigger as-child>
        <InputGroupButton
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
          <span class="composer-optimize-label-clip">
            <span class="composer-optimize-label whitespace-nowrap">
              {{ t("project.composer.undoPromptOptimization") }}
            </span>
          </span>
        </InputGroupButton>
        <InputGroupButton
          v-else
          data-slot="optimize-prompt-trigger"
          :class="buttonClass"
          type="button"
          variant="ghost"
          size="sm"
          :disabled="!props.canRewrite"
          :aria-busy="props.isRewriting || undefined"
          :aria-label="t('project.composer.optimizePrompt')"
          :aria-keyshortcuts="keyShortcut"
          @click="emit('optimize')"
        >
          <SparklesIcon
            data-icon="inline-start"
            class="transition-colors duration-200 group-enabled/optimize:group-hover/optimize:text-[var(--spectrum-1)]"
          />
          <span class="composer-optimize-label-clip">
            <span :class="labelClass" :data-label="label">
              {{ label }}
            </span>
          </span>
          <span
            data-slot="composer-optimize-kbd"
            class="composer-optimize-kbd-clip"
            aria-hidden="true"
          >
            <span class="composer-optimize-rest-kbd pl-1.5">
              <Kbd
                ><span>{{ modLabel }}</span
                ><span>↵</span></Kbd
              >
            </span>
          </span>
        </InputGroupButton>
      </TooltipTrigger>
      <TooltipContent side="top">
        <template v-if="showsUndo">
          {{ t("project.composer.undoPromptOptimization") }}
        </template>
        <template v-else>
          {{ label }}
          <KbdGroup v-if="showShortcutHints" aria-hidden="true">
            <Kbd>{{ modLabel }}</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
        </template>
      </TooltipContent>
    </Tooltip>
  </div>
  <div v-else class="relative flex min-w-0 shrink items-center">
    <Button
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
    </Button>
    <Button
      v-else
      data-slot="optimize-prompt-trigger"
      :class="buttonClass"
      type="button"
      variant="ghost"
      size="sm"
      :disabled="!props.canRewrite"
      :aria-busy="props.isRewriting || undefined"
      :aria-label="t('project.composer.optimizePrompt')"
      :aria-keyshortcuts="keyShortcut"
      @click="emit('optimize')"
    >
      <SparklesIcon data-icon="inline-start" class="text-[var(--spectrum-1)]" />
      <span :class="labelClass" :data-label="label">
        {{ label }}
      </span>
    </Button>
    <ModifierShortcut
      v-if="!showsUndo"
      class="pointer-events-none absolute left-full ml-1"
      key-label="↵"
    />
  </div>
</template>

<style scoped>
/* The sizer and the button share one grid cell; the sizer sets the
   slot's resting width, the button sits on top at its right edge. */
.composer-optimize-slot > * {
  grid-area: 1 / 1;
}

/* Opening swaps the keys for the label by width, each track clipping its
   content at full size (no ellipsis) on the app's expo curve; the text
   fades in, unblurs and settles a few pixels as its track opens. */
.composer-optimize-label-clip,
.composer-optimize-kbd-clip {
  display: block;
  overflow: hidden;
  interpolate-size: allow-keywords;
  transition-property: width;
  transition-duration: 500ms;
  transition-timing-function: var(--ease-out-expo);
}

.composer-optimize-label-clip {
  width: 0;
}

.composer-optimize-label-clip > .composer-optimize-label {
  display: block;
  width: max-content;
  padding-inline-start: 0.375rem;
  opacity: 0;
  filter: blur(2px);
  translate: 0.25rem 0;
  transition:
    color 200ms ease-out,
    opacity 150ms ease-out,
    filter 150ms ease-out,
    translate 150ms ease-out;
}

.composer-optimize-kbd-clip {
  width: auto;
}

.composer-optimize-kbd-clip > * {
  display: block;
  width: max-content;
  transition:
    opacity 300ms ease-out 120ms,
    filter 300ms ease-out 120ms;
}

.composer-optimize-slot:is(:hover, :has(:focus-visible), [data-expanded])
  .composer-optimize-label-clip {
  width: auto;
}

.composer-optimize-slot:is(:hover, :has(:focus-visible), [data-expanded])
  .composer-optimize-label-clip
  > .composer-optimize-label {
  opacity: 1;
  filter: none;
  translate: 0 0;
  transition:
    color 200ms ease-out,
    opacity 300ms ease-out 80ms,
    filter 300ms ease-out 80ms,
    translate 500ms var(--ease-out-expo) 80ms;
}

.composer-optimize-slot:is(:hover, :has(:focus-visible), [data-expanded])
  .composer-optimize-kbd-clip {
  width: 0;
}

.composer-optimize-slot:is(:hover, :has(:focus-visible), [data-expanded])
  .composer-optimize-kbd-clip
  > * {
  opacity: 0;
  filter: blur(2px);
  transition:
    opacity 150ms ease-out,
    filter 150ms ease-out;
}

/* Keys in the composer read as keycaps: white with a hairline ring on the
   light surface, the default fill in dark, like the reply suggestion's
   Tab key. */
.composer-optimize-rest-kbd :deep([data-slot="kbd"]) {
  background-color: var(--background);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 10%, transparent);
}

:global(.dark) .composer-optimize-rest-kbd :deep([data-slot="kbd"]) {
  background-color: var(--input);
  box-shadow: none;
}

/* Open, the button covers the end of the text box rather than pushing it,
   so it takes the composer's surface (the input tint over the page). */
.composer-optimize-inline {
  transition-property: background-color, color;
  transition-duration: 200ms;
}

.composer-optimize-slot:is(:hover, :has(:focus-visible), [data-expanded])
  .composer-optimize-inline {
  background:
    linear-gradient(
      color-mix(in oklab, var(--muted) 60%, transparent),
      color-mix(in oklab, var(--muted) 60%, transparent)
    ),
    linear-gradient(
      color-mix(in oklab, var(--input) 50%, transparent),
      color-mix(in oklab, var(--input) 50%, transparent)
    ),
    var(--background);
}

@media (prefers-reduced-motion: reduce) {
  .composer-optimize-inline,
  .composer-optimize-label-clip,
  .composer-optimize-kbd-clip,
  .composer-optimize-slot .composer-optimize-label,
  .composer-optimize-kbd-clip > * {
    transition: none !important;
  }
}

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
