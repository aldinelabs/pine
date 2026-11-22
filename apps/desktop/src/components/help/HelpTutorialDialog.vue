<script setup lang="ts">
import { LightbulbIcon, TriangleAlertIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { resolveHelpTopic } from "@/app/help";
import type { AppLocale } from "@/app/i18n";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useHelpStore } from "@/stores/help";
import { HELP_ILLUSTRATIONS } from "./illustrations";

/**
 * The window's one guide dialog: a picture on top, plain-language text
 * below, a step at a time. Any help hint (or the store) opens it at a topic
 * and step.
 */
const { t, locale } = useI18n();
const help = useHelpStore();
const { topicId, step } = storeToRefs(help);

const topic = computed(() =>
  topicId.value
    ? resolveHelpTopic(topicId.value, locale.value as AppLocale)
    : null,
);

const stepCount = computed(() => topic.value?.steps.length ?? 0);
const current = computed(() => topic.value?.steps[step.value] ?? null);
const isLast = computed(() => step.value >= stepCount.value - 1);
const illustration = computed(() =>
  current.value ? HELP_ILLUSTRATIONS[current.value.illustration] : null,
);

// A deep link past the end lands on the last step.
watch([topicId, stepCount], () => {
  if (stepCount.value && step.value >= stepCount.value)
    step.value = stepCount.value - 1;
});

/**
 * Steps differ in length, so the dialog glides to the next step's height on
 * the app's curve instead of jumping. The step's text is already in place;
 * only the box's height moves (clipped by its overflow). A step changed
 * mid-glide carries on from the height on screen.
 */
const illustrationElement = useTemplateRef<HTMLElement>("illustrationElement");
let heightGlide: Animation | null = null;

watch(step, async () => {
  const box = illustrationElement.value?.closest<HTMLElement>(
    "[data-slot=dialog-content]",
  );
  if (!box || typeof box.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  // Runs before the DOM updates: the height on screen, mid-glide included.
  const from = box.offsetHeight;
  heightGlide?.cancel();
  heightGlide = null;
  await nextTick();
  const to = box.offsetHeight;
  if (from === to) return;
  const glide = box.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: DURATION_MS,
    easing: EASE_OUT_EXPO,
  });
  heightGlide = glide;
  glide.addEventListener(
    "finish",
    () => {
      if (heightGlide === glide) heightGlide = null;
    },
    { once: true },
  );
});

const open = computed({
  get: () => topic.value !== null,
  set: (value: boolean) => {
    if (!value) help.close();
  },
});

function goTo(index: number): void {
  step.value = Math.min(Math.max(index, 0), stepCount.value - 1);
}

function next(): void {
  if (isLast.value) help.close();
  else goTo(step.value + 1);
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable='true']")) return;
  // Arrow keys follow the reading direction.
  const rtl = getComputedStyle(event.currentTarget as Element).direction;
  const forward = rtl === "rtl" ? "ArrowLeft" : "ArrowRight";
  const backward = rtl === "rtl" ? "ArrowRight" : "ArrowLeft";
  if (event.key === forward && !isLast.value) {
    event.preventDefault();
    goTo(step.value + 1);
  } else if (event.key === backward && step.value > 0) {
    event.preventDefault();
    goTo(step.value - 1);
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-testid="help-tutorial"
      :lang="topic?.locale"
      :class="
        cn(
          'flex max-h-[min(90vh,42rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg',
          PHONE_FULLSCREEN_DIALOG,
        )
      "
      @keydown="onKeydown"
    >
      <template v-if="topic && current">
        <div
          ref="illustrationElement"
          data-slot="help-illustration"
          class="bg-muted/60 relative flex h-52 shrink-0 items-center justify-center overflow-hidden"
          aria-hidden="true"
        >
          <Transition
            mode="out-in"
            enter-active-class="transition-opacity duration-300 motion-reduce:transition-none"
            leave-active-class="transition-opacity duration-150 motion-reduce:transition-none"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <component :is="illustration" :key="`${topic.id}-${step}`" />
          </Transition>
        </div>

        <!-- The dialog has no padding of its own, so the scrollbar sits at
             its edge (no inset) and the text keeps the same 1.5rem on both
             sides. -->
        <DialogScrollArea
          class="flex-1"
          edge-inset="0rem"
          content-inset="1.5rem"
          viewport-class="scroll-fade-y"
          content-class="flex flex-col gap-3 ps-6 pt-5 pb-2"
        >
          <DialogDescription class="text-muted-foreground text-xs">
            {{ topic.title }} ·
            {{ t("help.stepOf", { current: step + 1, total: stepCount }) }}
          </DialogDescription>
          <DialogTitle class="text-lg font-semibold">
            {{ current.title }}
          </DialogTitle>
          <p
            v-for="(paragraph, index) in current.body"
            :key="index"
            class="leading-relaxed"
          >
            {{ paragraph }}
          </p>
          <ul
            v-if="current.points?.length"
            class="flex list-disc flex-col gap-1.5 ps-5 leading-relaxed"
          >
            <li v-for="(point, index) in current.points" :key="index">
              {{ point }}
            </li>
          </ul>
          <div
            v-if="current.note"
            data-slot="help-note"
            :data-tone="current.note.tone"
            :class="
              cn(
                'flex gap-2.5 rounded-2xl px-3.5 py-3 leading-relaxed',
                current.note.tone === 'caution' ? 'bg-warning/10' : 'bg-muted',
              )
            "
          >
            <TriangleAlertIcon
              v-if="current.note.tone === 'caution'"
              class="text-warning mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <LightbulbIcon
              v-else
              class="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p>
              <span class="sr-only">
                {{
                  current.note.tone === "caution"
                    ? t("help.caution")
                    : t("help.tip")
                }}:
              </span>
              {{ current.note.text }}
            </p>
          </div>
        </DialogScrollArea>

        <div
          class="flex shrink-0 items-center justify-between gap-3 px-6 pt-3 pb-6"
        >
          <!-- Each button hugs its dot, with padding as the hit area, so
               the gaps stay equal while the current dot stretches and the
               others slide aside. The negative margin lines the first dot
               up with the text. -->
          <div class="-ms-1 flex items-center" data-slot="help-steps">
            <button
              v-for="index in stepCount"
              :key="index"
              type="button"
              class="focus-visible:ring-ring/50 flex h-6 items-center rounded-full px-1 outline-none focus-visible:ring-3"
              :aria-label="t('help.goToStep', { step: index })"
              :aria-current="index - 1 === step ? 'step' : undefined"
              @click="goTo(index - 1)"
            >
              <span
                :class="
                  cn(
                    'ease-out-expo h-1.5 rounded-full transition-[width,background-color] duration-500 motion-reduce:transition-none',
                    index - 1 === step
                      ? 'bg-foreground w-4'
                      : 'bg-foreground/25 w-1.5',
                  )
                "
              />
            </button>
          </div>
          <div class="flex items-center gap-2">
            <Button
              v-if="step > 0"
              data-testid="help-previous"
              type="button"
              variant="ghost"
              @click="goTo(step - 1)"
            >
              {{ t("help.previous") }}
            </Button>
            <Button data-testid="help-next" type="button" @click="next">
              {{ isLast ? t("help.done") : t("help.next") }}
            </Button>
          </div>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>
