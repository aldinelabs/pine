<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import {
  VisArea,
  VisAxis,
  VisDonut,
  VisGroupedBar,
  VisLine,
  VisSingleContainer,
  VisXYContainer,
} from "@unovis/vue";
import { computed, h, render } from "vue";
import {
  ChartContainer,
  ChartCrosshair,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

type Datum = Record<string, string | number | null>;

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Chart">>>();

const COLORS = 5;
const colorAt = (index: number) => `var(--chart-${(index % COLORS) + 1})`;

const data = computed<Datum[]>(() =>
  (props.props.data ?? []).filter(
    (item): item is Datum => typeof item === "object" && item !== null,
  ),
);
const series = computed(() => (props.props.series ?? []).filter(Boolean));
const isDonut = computed(() => props.props.type === "donut");

/** Series for XY charts; categories for a donut, which has one series. */
const config = computed<ChartConfig>(() =>
  isDonut.value
    ? Object.fromEntries(
        data.value.map((item, index) => [
          String(item[props.props.x] ?? index),
          {
            label: String(item[props.props.x] ?? index),
            color: colorAt(index),
          },
        ]),
      )
    : Object.fromEntries(
        series.value.map((key, index) => [
          key,
          { label: key, color: colorAt(index) },
        ]),
      ),
);

const numberAt = (item: Datum, key: string) => Number(item[key]) || 0;
const y = computed(() =>
  series.value.map((key) => (item: Datum) => numberAt(item, key)),
);
const seriesColor = (_item: Datum, index: number) => colorAt(index);
const xValue = (_item: Datum, index: number) => index;
/** One tick per category; scale-chosen ticks would repeat labels. */
const xTicks = computed(() => data.value.map((_item, index) => index));
const xTick = (index: number) =>
  String(data.value[Math.round(index)]?.[props.props.x] ?? "");
/** Crosshair template; unlike componentToString it reads the latest config,
 * which changes while the block streams in. */
function tooltip(item: Datum, x: number | Date): string {
  const container = document.createElement("div");
  render(
    h(ChartTooltipContent, {
      payload: item,
      config: config.value,
      x,
      labelFormatter: (index: number | Date) => xTick(Number(index)),
    }),
    container,
  );
  return container.innerHTML;
}
const donutValue = (item: Datum) => numberAt(item, series.value[0] ?? "");
const donutColor = (_item: Datum, index: number) => colorAt(index);
</script>

<template>
  <figure data-slot="iui-chart" class="flex min-w-0 flex-col gap-2">
    <figcaption v-if="props.props.title" class="text-sm font-medium">
      {{ props.props.title }}
    </figcaption>
    <ChartContainer
      :config="config"
      :cursor="!isDonut"
      :class="isDonut ? 'aspect-square max-h-60' : 'aspect-[16/7] min-h-48'"
    >
      <VisSingleContainer v-if="isDonut" :data="data">
        <VisDonut :value="donutValue" :color="donutColor" :arc-width="28" />
      </VisSingleContainer>
      <VisXYContainer v-else :data="data" :margin="{ left: 4, right: 4 }">
        <VisGroupedBar
          v-if="props.props.type === 'bar'"
          :x="xValue"
          :y="y"
          :color="seriesColor"
          :rounded-corners="4"
          :bar-padding="0.2"
        />
        <template v-else-if="props.props.type === 'area'">
          <VisArea :x="xValue" :y="y" :color="seriesColor" :opacity="0.35" />
          <VisLine :x="xValue" :y="y" :color="seriesColor" />
        </template>
        <VisLine v-else :x="xValue" :y="y" :color="seriesColor" />
        <VisAxis
          type="x"
          :x="xValue"
          :tick-line="false"
          :domain-line="false"
          :grid-line="false"
          :tick-values="xTicks"
          :tick-format="xTick"
        />
        <VisAxis
          type="y"
          :tick-line="false"
          :domain-line="false"
          :num-ticks="4"
        />
        <ChartTooltip />
        <ChartCrosshair :template="tooltip" :color="seriesColor" />
      </VisXYContainer>
      <ChartLegendContent v-if="isDonut || series.length > 1" />
    </ChartContainer>
  </figure>
</template>
