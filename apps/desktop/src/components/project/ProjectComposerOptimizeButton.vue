<script setup lang="ts">
import { SparklesIcon, Undo2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { InputGroupButton } from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import ComposerKeycap from "@/components/project/ComposerKeycap.vue";
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
 * hover or keyboard focus (and while optimizing) the keys blur and shrink
 * away in place, then the label sharpens in as the button widens leftwards
 * over the text box rather than pushing it, so nothing beside it moves.
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
// The resting keycap: "⌘↵" on a Mac, "Ctrl ↵" elsewhere.
const keysLabel = isMac ? "⌘↵" : "Ctrl ↵";
const keyShortcut = isMac ? "Meta+Enter" : "Control+Enter";
const showsUndo = computed(() => props.canUndo && !props.isRewriting);
const label = computed(() =>
  props.isRewriting
    ? t("project.composer.optimizingPrompt")
    : t("project.composer.optimizePrompt"),
);
/**
 * The swap area eases between the keys' and the label's widths, which lie
 * over it without taking room; they are measured as they change (language,
 * "Optimizing…", the compact layout hiding them).
 */
const swap = ref<HTMLElement | null>(null);
const SWAP_TRACKS = [
  [".composer-optimize-label-track", "--composer-optimize-label-width"],
  [".composer-optimize-kbd-track", "--composer-optimize-keys-width"],
] as const;
/**
 * Only a width that changes while shown eases. The first measurement after
 * mounting, or after the composer was hidden (a background tab measures
 * nothing), takes effect at once, so a new tab's button does not grow in.
 */
function measureSwap(area: HTMLElement): void {
  let jumps = !area.hasAttribute("data-swap-ready");
  const widths = SWAP_TRACKS.map(([track, name]) => {
    const width = area.querySelector<HTMLElement>(track)?.offsetWidth ?? 0;
    const previous = Number.parseFloat(area.style.getPropertyValue(name)) || 0;
    if ((width === 0) !== (previous === 0)) jumps = true;
    return [name, width] as const;
  });
  if (jumps) area.removeAttribute("data-swap-ready");
  for (const [name, width] of widths)
    area.style.setProperty(name, `${width}px`);
  if (!jumps || widths.every(([, width]) => width === 0)) return;
  // Settle the new width before easing is allowed again.
  void getComputedStyle(area).width;
  area.setAttribute("data-swap-ready", "");
}
watch(
  swap,
  (area, _previous, onCleanup) => {
    if (!area) return;
    measureSwap(area);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureSwap(area));
    for (const track of area.children) observer.observe(track);
    onCleanup(() => observer.disconnect());
  },
  { flush: "post" },
);
const labelClass = computed(() =>
  cn(
    "composer-optimize-label",
    // Inline, the label keeps its full width inside its track, so it
    // is revealed rather than cut short with an ellipsis.
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
       leftwards out of it. The slot's -1px end margin puts the resting keys
       and the open pill as far from Send as Send is from the composer's
       edge. -->
  <div
    v-if="isInline"
    data-slot="composer-optimize-slot"
    class="composer-optimize-slot relative -me-px inline-grid shrink-0"
    :data-expanded="props.isRewriting || undefined"
  >
    <span
      :class="
        cn(
          'composer-optimize-sizer invisible flex h-8 items-center border border-transparent pl-2.5',
          showsUndo ? 'pr-2.5' : 'pr-1.5',
        )
      "
      aria-hidden="true"
    >
      <span class="size-4" />
      <span v-if="!showsUndo" class="composer-optimize-rest-kbd pl-1.5">
        <ComposerKeycap class="composer-optimize-keycap"
          ><kbd class="font-sans">{{ keysLabel }}</kbd></ComposerKeycap
        >
      </span>
    </span>
    <Tooltip>
      <TooltipTrigger as-child>
        <InputGroupButton
          v-if="showsUndo"
          data-slot="undo-prompt-optimization"
          :class="cn(buttonClass, 'composer-optimize-undo')"
          type="button"
          variant="outline"
          size="sm"
          :aria-label="t('project.composer.undoPromptOptimization')"
          @click="emit('undo')"
        >
          <Undo2Icon data-icon="inline-start" />
          <span ref="swap" class="composer-optimize-swap">
            <span class="composer-optimize-label-track">
              <span class="composer-optimize-label whitespace-nowrap">
                {{ t("project.composer.undoPromptOptimization") }}
              </span>
            </span>
          </span>
        </InputGroupButton>
        <InputGroupButton
          v-else
          data-slot="optimize-prompt-trigger"
          :class="buttonClass"
          type="button"
          variant="outline"
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
          <span ref="swap" class="composer-optimize-swap">
            <span class="composer-optimize-label-track">
              <span :class="labelClass" :data-label="label">
                {{ label }}
              </span>
            </span>
            <span
              data-slot="composer-optimize-kbd"
              class="composer-optimize-kbd-track"
              aria-hidden="true"
            >
              <span class="composer-optimize-rest-kbd pl-1.5">
                <ComposerKeycap class="composer-optimize-keycap"
                  ><kbd class="font-sans">{{ keysLabel }}</kbd></ComposerKeycap
                >
              </span>
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

/* Opening swaps the keys for the label. The outgoing one blurs, shrinks
   and fades in place; just before it is gone the incoming one fades in,
   sharpening and growing to full size, both about the same point (the
   button's inner end), so neither moves sideways. Both lie over the end of
   the swap area without taking room, so the text keeps its full width (no
   ellipsis) and is never clipped; the area itself eases between their
   measured widths on the app's expo curve, the whole way in both
   directions. Closing waits a moment for the label to fade, so it never
   spills over the icon. */
.composer-optimize-swap {
  position: relative;
  align-self: stretch;
  width: var(--composer-optimize-keys-width, 0px);
}

/* Eases only once measured, so a newly mounted button does not grow in. */
.composer-optimize-swap[data-swap-ready] {
  transition: width 500ms var(--ease-out-expo) 60ms;
}

/* Every rule below the `:has()` names its target by class, never `*`:
   Chromium shares one invalidation set for all `:has()` rules, and a
   universal target makes any DOM insertion under a `:has()` element (the
   whole window sits under the sidebar wrapper's) restyle its entire
   subtree, which stutters every animation while a reply streams. */
.composer-optimize-slot:is(:hover, :has(:focus-visible), [data-expanded])
  .composer-optimize-swap {
  width: var(--composer-optimize-label-width, 0px);
  transition-delay: 0ms;
}

.composer-optimize-label-track,
.composer-optimize-kbd-track {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  display: flex;
  align-items: center;
}

/* Outlined, the button keeps a small end padding that insets the resting
   keys from its border; the label adds the rest of the open pill's. */
.composer-optimize-label-track > .composer-optimize-label {
  display: block;
  width: max-content;
  margin-inline: 0.375rem;
  transform-origin: calc(100% + 0.375rem) 50%;
}

.composer-optimize-kbd-track > .composer-optimize-rest-kbd {
  display: block;
  width: max-content;
  transform-origin: 100% 50%;
}

/* Out: the label at rest, the keys while open. */
.composer-optimize-label-track > .composer-optimize-label,
.composer-optimize-slot:is(:hover, :has(:focus-visible), [data-expanded])
  .composer-optimize-kbd-track
  > .composer-optimize-rest-kbd {
  opacity: 0;
  filter: blur(3px);
  scale: 0.9;
  transition:
    color 200ms ease-out,
    opacity 100ms ease-out,
    filter 100ms ease-out,
    scale 100ms ease-out;
}

/* In: the keys at rest, the label while open. */
.composer-optimize-kbd-track > .composer-optimize-rest-kbd,
.composer-optimize-slot:is(:hover, :has(:focus-visible), [data-expanded])
  .composer-optimize-label-track
  > .composer-optimize-label {
  opacity: 1;
  filter: none;
  scale: 1;
  transition:
    color 200ms ease-out,
    opacity 220ms ease-out 100ms,
    filter 300ms ease-out 100ms,
    scale 500ms var(--ease-out-expo) 100ms;
}

/* Open, the button covers the end of the text box rather than pushing it,
   so it takes the composer's surface (the input tint over the page). */
.composer-optimize-inline {
  padding-inline-end: 0.375rem;
  transition:
    background-color 200ms ease,
    color 200ms ease;
}

/* Undo optimization rests as its icon alone, so it is an even icon button
   like the compact Optimize prompt; its label takes only what the open pill
   still needs at the end. */
.composer-optimize-undo {
  padding-inline-end: 0.625rem;
}

.composer-optimize-undo
  .composer-optimize-label-track
  > .composer-optimize-label {
  margin-inline-end: 0.125rem;
  transform-origin: calc(100% + 0.125rem) 50%;
}

/* Inside the outlined button the keycap drops its own ring, so the two
   edges do not double up; a muted fill keeps it reading as a key. */
.composer-optimize-keycap {
  box-shadow: none;
  background-color: var(--muted);
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

/* With reduced motion the two simply swap. */
@media (prefers-reduced-motion: reduce) {
  .composer-optimize-inline,
  .composer-optimize-swap,
  .composer-optimize-slot .composer-optimize-label,
  .composer-optimize-kbd-track > .composer-optimize-rest-kbd {
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
