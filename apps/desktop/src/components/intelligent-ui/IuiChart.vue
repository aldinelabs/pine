<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import {
  VisArea,
  VisAxis,
  VisDonut,
  VisGroupedBar,
  VisLine,
  VisScatter,
  VisSingleContainer,
  VisStackedBar,
  VisXYContainer,
} from "@unovis/vue";
import {
  computed,
  h,
  onBeforeUnmount,
  onMounted,
  render,
  useTemplateRef,
} from "vue";
import {
  ChartContainer,
  ChartCrosshair,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { chartAxes, chartSeriesKeys } from "@/shared/intelligentUiChart";
import { observeCrosshairFlip } from "./crosshairFlip";

type Datum = Record<string, string | number | null>;

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Chart">>>();

const isStreaming = useIsStreaming();

// The crosshair jumps between points (duration 0) and eases there as a FLIP.
const figure = useTemplateRef<HTMLElement>("figure");
let stopCrosshairFlip: (() => void) | undefined;
onMounted(() => {
  if (figure.value) stopCrosshairFlip = observeCrosshairFlip(figure.value);
});
onBeforeUnmount(() => stopCrosshairFlip?.());
/** Each streamed batch updates the data; transitions would restart on every
 * one, so draw instantly until the block closes. */
const duration = computed(() => (isStreaming.value ? 0 : undefined));

const COLORS = 5;
/** Scatter points at the extremes would sit on the plot's edge. */
const SCATTER_PADDING = { top: 12, bottom: 12, left: 12, right: 12 };
const colorAt = (index: number) => `var(--chart-${(index % COLORS) + 1})`;

const data = computed<Datum[]>(() =>
  (props.props.data ?? []).filter(
    (item): item is Datum => typeof item === "object" && item !== null,
  ),
);
/** x and series as given, or inferred from the rows when left out. */
const axes = computed(() =>
  chartAxes(data.value, props.props.type, props.props.x, props.props.series),
);
const xKey = computed(() => axes.value.x);
const series = computed(() => axes.value.series);
const seriesKeys = computed(() =>
  chartSeriesKeys(data.value, xKey.value, series.value),
);
const isRound = computed(
  () => props.props.type === "donut" || props.props.type === "pie",
);
const isScatter = computed(() => props.props.type === "scatter");
const stacked = computed(() => props.props.stacked === true);

const roundTotal = computed(() =>
  data.value.reduce((sum, item) => sum + Math.max(0, donutValue(item)), 0),
);
/** A pie or donut's legend shows each slice's share or value when asked. */
function sliceLabel(item: Datum, index: number): string {
  const name = String(item[xKey.value] ?? index);
  const value = donutValue(item);
  if (props.props.format === "percent" && roundTotal.value > 0)
    return `${name} · ${Math.round((value / roundTotal.value) * 1000) / 10}%`;
  if (props.props.format === "number")
    return `${name} · ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return name;
}

/** Series for XY charts; categories for a pie or donut, which has one series. */
const config = computed<ChartConfig>(() =>
  isRound.value
    ? Object.fromEntries(
        data.value.map((item, index) => [
          String(item[xKey.value] ?? index),
          { label: sliceLabel(item, index), color: colorAt(index) },
        ]),
      )
    : Object.fromEntries(
        seriesKeys.value.map((key, index) => [
          key,
          { label: series.value[index] ?? key, color: colorAt(index) },
        ]),
      ),
);

/** A height in px replaces the default shape, within sensible bounds. */
const plotStyle = computed(() => {
  const height = props.props.height;
  return !isRound.value && typeof height === "number" && height > 0
    ? { height: `${Math.min(640, Math.max(120, Math.round(height)))}px` }
    : undefined;
});

const numberAt = (item: Datum, key: string) => Number(item[key]) || 0;
const y = computed(() =>
  seriesKeys.value.map((key) => (item: Datum) => numberAt(item, key)),
);
const seriesColor = (_item: Datum, index: number) => colorAt(index);
const xValue = (item: Datum, index: number) =>
  isScatter.value ? numberAt(item, xKey.value) : index;
/** One tick per category; scale-chosen ticks would repeat labels. */
const xTicks = computed(() => data.value.map((_item, index) => index));
const xTick = (index: number) =>
  isScatter.value
    ? index.toLocaleString()
    : String(data.value[Math.round(index)]?.[xKey.value] ?? "");
/** Crosshair template; unlike componentToString it reads the latest config,
 * which changes while the block streams in. */
function tooltip(item: Datum, x: number | Date): string {
  const container = document.createElement("div");
  render(
    h(ChartTooltipContent, {
      payload: item,
      config: config.value,
      x,
      labelFormatter: (index: number | Date) =>
        isScatter.value
          ? `${xKey.value}: ${Number(index).toLocaleString()}`
          : xTick(Number(index)),
    }),
    container,
  );
  return container.innerHTML;
}
function donutValue(item: Datum): number {
  return numberAt(item, seriesKeys.value[0] ?? "");
}
const donutColor = (_item: Datum, index: number) => colorAt(index);
</script>

<template>
  <figure ref="figure" data-iui="chart" class="flex min-w-0 flex-col gap-2">
    <figcaption v-if="props.props.title" class="text-sm font-medium">
      {{ props.props.title }}
    </figcaption>
    <ChartContainer
      :config="config"
      :cursor="!isRound"
      :class="
        isRound
          ? 'aspect-square max-h-60'
          : plotStyle
            ? 'aspect-auto'
            : 'aspect-[16/7] min-h-48'
      "
      :style="plotStyle"
    >
      <VisSingleContainer v-if="isRound" :data="data" :duration="duration">
        <VisDonut
          :value="donutValue"
          :color="donutColor"
          :arc-width="props.props.type === 'pie' ? 0 : 28"
        />
      </VisSingleContainer>
      <VisXYContainer
        v-else
        :data="data"
        :duration="duration"
        :margin="{ left: 4, right: 4 }"
        v-bind="isScatter ? { padding: SCATTER_PADDING } : {}"
      >
        <template v-if="props.props.type === 'bar'">
          <VisStackedBar
            v-if="stacked"
            :x="xValue"
            :y="y"
            :color="seriesColor"
            :rounded-corners="4"
            :bar-padding="0.2"
          />
          <VisGroupedBar
            v-else
            :x="xValue"
            :y="y"
            :color="seriesColor"
            :rounded-corners="4"
            :bar-padding="0.2"
          />
        </template>
        <!-- Unovis stacks an area's accessors; unstacked areas draw apart. -->
        <VisArea
          v-else-if="props.props.type === 'area' && stacked"
          :x="xValue"
          :y="y"
          :color="seriesColor"
          :opacity="0.5"
        />
        <template v-else-if="props.props.type === 'area'">
          <VisArea
            v-for="(accessor, index) in y"
            :key="index"
            :x="xValue"
            :y="accessor"
            :color="colorAt(index)"
            :opacity="0.25"
          />
          <VisLine :x="xValue" :y="y" :color="seriesColor" />
        </template>
        <template v-else-if="isScatter">
          <VisScatter
            v-for="(accessor, index) in y"
            :key="index"
            :x="xValue"
            :y="accessor"
            :color="colorAt(index)"
            :size="10"
          />
        </template>
        <VisLine v-else :x="xValue" :y="y" :color="seriesColor" />
        <VisAxis
          type="x"
          :x="xValue"
          :tick-line="false"
          :domain-line="false"
          :grid-line="false"
          :tick-values="isScatter ? undefined : xTicks"
          :num-ticks="isScatter ? 5 : undefined"
          :tick-format="xTick"
        />
        <VisAxis
          type="y"
          :tick-line="false"
          :domain-line="false"
          :num-ticks="4"
        />
        <ChartTooltip />
        <ChartCrosshair
          v-if="!isScatter"
          :template="tooltip"
          :color="seriesColor"
          :duration="0"
        />
      </VisXYContainer>
      <ChartLegendContent v-if="isRound || series.length > 1" />
    </ChartContainer>
  </figure>
</template>
