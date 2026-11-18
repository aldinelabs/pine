<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon } from "@lucide/vue";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { childList } from "./layout";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Carousel">>>();
const { t } = useI18n();

const items = computed(() => childList(props.props.children));
/** Each item is itemWidth px wide, never wider than the block. */
const itemStyle = computed(() => {
  const width = props.props.itemWidth;
  const px =
    typeof width === "number" && width > 0
      ? Math.min(800, Math.max(80, width))
      : 240;
  return { flexBasis: `min(${px}px, 100%)` };
});
</script>

<template>
  <!-- The arrows sit above the track, not beside it: the reading column has
       no room outside the block. -->
  <Carousel
    data-iui="carousel"
    class="flex min-w-0 flex-col gap-2"
    :opts="{ align: 'start', dragFree: true }"
  >
    <CarouselContent>
      <CarouselItem
        v-for="(item, index) in items"
        :key="index"
        class="flex"
        :style="itemStyle"
      >
        <div class="flex min-w-0 flex-1 flex-col">
          <IuiNodes :value="item" />
        </div>
      </CarouselItem>
    </CarouselContent>
    <div class="flex justify-end gap-2">
      <CarouselPrevious class="static translate-none" variant="ghost">
        <ChevronLeftIcon class="cn-rtl-flip" />
        <span class="sr-only">{{ t("intelligentUi.carousel.previous") }}</span>
      </CarouselPrevious>
      <CarouselNext class="static translate-none" variant="ghost">
        <ChevronRightIcon class="cn-rtl-flip" />
        <span class="sr-only">{{ t("intelligentUi.carousel.next") }}</span>
      </CarouselNext>
    </div>
  </Carousel>
</template>
