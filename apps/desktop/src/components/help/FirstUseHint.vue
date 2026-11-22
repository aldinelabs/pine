<script setup lang="ts">
import { LightbulbIcon } from "@lucide/vue";
import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  type HTMLAttributes,
} from "vue";
import { useI18n } from "vue-i18n";
import type { HelpTopicId } from "@/app/help";
import { Button } from "@/components/ui/button";
import { prefersReducedMotion } from "@/lib/animateScroll";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  useFirstUseHintsStore,
  type FirstUseHintId,
} from "@/stores/firstUseHints";
import { useHelpStore } from "@/stores/help";

/**
 * A one-time hint: one line of text with Show me and Got it, set into the
 * interface right where a feature first appears. Either button dismisses it
 * for good. Where its moment appears several times, only the first place
 * shows it (see the store).
 *
 * It folds in and out like the session list's rows (`useListFold`): height,
 * spacing and opacity, so what is around it follows. A hint that mounts with
 * its surroundings (a new card, a transcript page, a row scrolled back in)
 * just shows, the surroundings bringing their own motion.
 */
const props = defineProps<{
  id: FirstUseHintId;
  text: string;
  guide: { topic: HelpTopicId; step?: number };
  class?: HTMLAttributes["class"];
}>();

const { t } = useI18n();
const hints = useFirstUseHintsStore();
const help = useHelpStore();
const holder = Symbol(props.id);

hints.claim(props.id, holder);
onBeforeUnmount(() => hints.release(holder));

const isShown = computed(() => hints.shows(props.id, holder));

/** Added to interface already on screen, so it folds in. */
const appear = getCurrentInstance()?.parent?.isMounted ?? false;
const running = new Map<Element, Animation>();

/**
 * Spacing the hint folds to: its own margins go, and so does the parent's
 * gap on one side, so it takes no room at all.
 */
function foldedMargins(element: HTMLElement): {
  marginTop: string;
  marginBottom: string;
} {
  const none = { marginTop: "0px", marginBottom: "0px" };
  const parent = element.parentElement;
  if (!parent) return none;
  const style = getComputedStyle(parent);
  const stacked =
    style.display.includes("grid") ||
    (style.display.includes("flex") &&
      style.flexDirection.startsWith("column"));
  const gap = Number.parseFloat(style.rowGap);
  if (!stacked || !(gap > 0)) return none;
  if (element.previousElementSibling)
    return { ...none, marginTop: `-${gap}px` };
  if (element.nextElementSibling) return { ...none, marginBottom: `-${gap}px` };
  return none;
}

function fold(element: Element, motion: "in" | "out", done: () => void) {
  if (
    !(element instanceof HTMLElement) ||
    prefersReducedMotion() ||
    typeof element.animate !== "function"
  ) {
    done();
    return;
  }
  // One still folding is measured unfolded.
  running.get(element)?.cancel();
  // Every value is read before the animation starts: one layout.
  const style = getComputedStyle(element);
  const unfolded = {
    height: `${element.offsetHeight}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
    opacity: 1,
    transform: "translateY(0)",
  };
  const folded = {
    height: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    ...foldedMargins(element),
    opacity: 0,
    transform: "translateY(-0.25rem)",
  };
  element.style.overflow = "hidden";
  // A leaving hint cannot be clicked again.
  if (motion === "out") element.inert = true;
  const animation = element.animate(
    motion === "in" ? [folded, unfolded] : [unfolded, folded],
    {
      duration: DURATION_MS,
      easing: EASE_OUT_EXPO,
      fill: motion === "out" ? "forwards" : "none",
    },
  );
  running.set(element, animation);
  const settle = () => {
    if (running.get(element) === animation) running.delete(element);
    element.style.overflow = "";
    done();
  };
  animation.onfinish = settle;
  // A newer fold or unmounting cancels it; Vue ignores a repeated `done`.
  animation.oncancel = settle;
}

function cancelFold(element: Element): void {
  running.get(element)?.cancel();
  if (element instanceof HTMLElement) element.inert = false;
}

// Unmounted mid-fold, a leaving hint is removed now rather than left behind.
onBeforeUnmount(() => {
  for (const animation of [...running.values()]) animation.cancel();
});

function showGuide(): void {
  hints.dismiss(props.id);
  help.openTopic(props.guide.topic, props.guide.step);
}
</script>

<template>
  <Transition
    :css="false"
    :appear="appear"
    @enter="(element, done) => fold(element, 'in', done)"
    @enter-cancelled="cancelFold"
    @leave="(element, done) => fold(element, 'out', done)"
    @leave-cancelled="cancelFold"
  >
    <div
      v-if="isShown"
      data-slot="first-use-hint"
      :data-hint="id"
      role="note"
      :class="
        cn(
          'bg-muted text-foreground flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl py-2 ps-3 pe-2 text-sm text-pretty [line-break:strict]',
          props.class,
        )
      "
    >
      <span class="flex min-w-0 flex-[1_1_12rem] items-start gap-2">
        <LightbulbIcon
          class="text-muted-foreground mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <span>{{ text }}</span>
      </span>
      <span class="ms-auto flex shrink-0 items-center gap-1">
        <Button
          data-testid="first-use-hint-guide"
          type="button"
          variant="outline"
          size="xs"
          aria-haspopup="dialog"
          @click="showGuide"
        >
          {{ t("help.hintShowGuide") }}
        </Button>
        <Button
          data-testid="first-use-hint-dismiss"
          type="button"
          variant="ghost"
          size="xs"
          @click="hints.dismiss(id)"
        >
          {{ t("help.hintDismiss") }}
        </Button>
      </span>
    </div>
  </Transition>
</template>
