<script setup lang="ts">
import { RotateCcwIcon } from "@lucide/vue";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { useSurface } from "./surface";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Flashcard">>>();
const { t } = useI18n();
const surface = useSurface();
const flipped = ref(false);

const face = (shown: boolean) =>
  cn(
    "col-start-1 row-start-1 flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl p-5 text-center text-sm leading-relaxed ring-1 ring-foreground/5 [backface-visibility:hidden] dark:ring-foreground/10",
    surface === "raised" ? "bg-muted/50" : "bg-background",
    !shown && "pointer-events-none",
  );
</script>

<template>
  <!-- Both faces share one grid cell, so the card is as tall as the taller
       face and does not jump when it turns. -->
  <button
    data-iui="flashcard"
    type="button"
    :aria-pressed="flipped"
    :aria-label="
      flipped
        ? t('intelligentUi.flashcard.showFront')
        : t('intelligentUi.flashcard.showBack')
    "
    class="group/flashcard min-w-0 cursor-pointer rounded-2xl text-left outline-none [perspective:1200px] focus-visible:ring-3 focus-visible:ring-ring/50"
    @click="flipped = !flipped"
  >
    <div
      class="relative grid transition-transform duration-500 ease-out [transform-style:preserve-3d] motion-reduce:transition-none"
      :class="flipped && '[transform:rotateY(180deg)]'"
    >
      <div :class="face(!flipped)" :aria-hidden="flipped">
        <IuiNodes :value="props.props.front" />
        <span v-if="props.props.hint" class="text-xs text-muted-foreground">
          {{ props.props.hint }}
        </span>
      </div>
      <div
        :class="[face(flipped), '[transform:rotateY(180deg)]']"
        :aria-hidden="!flipped"
      >
        <IuiNodes :value="props.props.back" />
      </div>
    </div>
    <span
      class="mt-1.5 flex items-center justify-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/flashcard:opacity-100 group-focus-visible/flashcard:opacity-100"
      aria-hidden="true"
    >
      <RotateCcwIcon class="size-3" />
      {{ t("intelligentUi.flashcard.flip") }}
    </span>
  </button>
</template>
