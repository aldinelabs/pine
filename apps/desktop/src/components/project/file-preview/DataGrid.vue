<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { cn } from "@/lib/utils";
import { formatGridCell, type GridCell } from "@/lib/dataGrid";

export interface DataGridColumn {
  key: string;
  label: string;
  /** A short type shown under the name, such as `INTEGER`. */
  type?: string;
}

const props = withDefaults(
  defineProps<{
    columns: readonly DataGridColumn[];
    rowCount: number;
    /** Returns rows `start` to `end` (exclusive), one cell per column. */
    loadRows: (start: number, end: number) => Promise<GridCell[][]>;
    /** Shows each row's number in a leading column. */
    rowNumbers?: boolean;
  }>(),
  { rowNumbers: true },
);
const emit = defineEmits<{ failed: [error: unknown] }>();
const { t, locale } = useI18n();

const ROW_HEIGHT = 32;
const PAGE_SIZE = 200;
const MIN_WIDTH = 72;
const MAX_WIDTH = 320;

const scroller = useTemplateRef<HTMLDivElement>("scroller");
/** Loaded pages of rows; a page is requested once. */
const pages = shallowRef(new Map<number, GridCell[][]>());
const requested = new Set<number>();
/** Bumped whenever the data source changes, so stale pages are dropped. */
let generation = 0;
const widths = ref<number[]>([]);

const numberWidth = computed(() =>
  props.rowNumbers ? Math.max(40, String(props.rowCount).length * 8 + 20) : 0,
);
const template = computed(() =>
  [
    ...(props.rowNumbers ? [`${numberWidth.value}px`] : []),
    ...props.columns.map(
      (_, index) => `${widths.value[index] ?? MIN_WIDTH * 1.5}px`,
    ),
  ].join(" "),
);
const totalWidth = computed(
  () =>
    numberWidth.value +
    props.columns.reduce(
      (sum, _, index) => sum + (widths.value[index] ?? MIN_WIDTH * 1.5),
      0,
    ),
);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.rowCount,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index: number) => index,
    getScrollElement: () => scroller.value,
    overscan: 12,
  })),
);
const visibleRows = computed(() => virtualizer.value.getVirtualItems());

/** Approximate width in ems; wide (CJK) characters count double. */
function textWidth(text: string): number {
  let width = 0;
  for (const char of text)
    width +=
      /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uff60]/.test(
        char,
      )
        ? 1
        : 0.56;
  return width;
}

/** Sizes columns from their names and the first page of values. */
function measure(rows: GridCell[][]): void {
  widths.value = props.columns.map((column, index) => {
    const longest = Math.max(
      textWidth(column.label) * 1.05,
      textWidth(column.type ?? "") * 0.85,
      ...rows
        .slice(0, 50)
        .map((row) => textWidth(formatGridCell(row[index], locale.value).text)),
    );
    return Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, Math.ceil(longest * 14 + 28)),
    );
  });
}

async function requestPage(page: number): Promise<void> {
  if (requested.has(page)) return;
  requested.add(page);
  const current = generation;
  try {
    const start = page * PAGE_SIZE;
    const rows = await props.loadRows(
      start,
      Math.min(props.rowCount, start + PAGE_SIZE),
    );
    if (current !== generation) return;
    const next = new Map(pages.value);
    next.set(page, rows);
    pages.value = next;
    if (page === 0) measure(rows);
  } catch (error) {
    if (current === generation) emit("failed", error);
  }
}

watch(
  visibleRows,
  (items) => {
    const first = items[0]?.index;
    const last = items.at(-1)?.index;
    if (first === undefined || last === undefined) return;
    for (
      let page = Math.floor(first / PAGE_SIZE);
      page <= Math.floor(last / PAGE_SIZE);
      page++
    )
      void requestPage(page);
  },
  { immediate: true },
);

watch(
  () => [props.loadRows, props.columns, props.rowCount],
  () => {
    generation++;
    requested.clear();
    pages.value = new Map();
    widths.value = [];
    scroller.value?.scrollTo({ top: 0, left: 0 });
    void requestPage(0);
  },
);
if (props.rowCount) void requestPage(0);

function rowAt(index: number): GridCell[] | undefined {
  return pages.value.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];
}

function cell(index: number, column: number) {
  return formatGridCell(rowAt(index)?.[column], locale.value);
}
</script>

<template>
  <div
    ref="scroller"
    data-slot="data-grid"
    role="grid"
    :aria-rowcount="rowCount + 1"
    :aria-colcount="columns.length"
    class="relative h-full min-h-0 overflow-auto text-sm"
  >
    <div :style="{ width: `${totalWidth}px`, minWidth: '100%' }">
      <div
        role="row"
        class="sticky top-0 z-10 grid border-b bg-background"
        :style="{ gridTemplateColumns: template }"
      >
        <div
          v-if="rowNumbers"
          role="columnheader"
          class="sticky left-0 z-10 bg-background"
          :aria-label="t('project.preview.rowNumber')"
        />
        <div
          v-for="column in columns"
          :key="column.key"
          role="columnheader"
          class="flex min-w-0 flex-col justify-center px-3 py-1.5"
          :title="
            column.type ? `${column.label} · ${column.type}` : column.label
          "
        >
          <span class="truncate font-medium">{{ column.label }}</span>
          <span
            v-if="column.type"
            class="truncate text-xs text-muted-foreground"
            >{{ column.type }}</span
          >
        </div>
      </div>
      <div
        class="relative"
        :style="{ height: `${virtualizer.getTotalSize()}px` }"
      >
        <div
          v-for="item in visibleRows"
          :key="item.index"
          role="row"
          :aria-rowindex="item.index + 2"
          class="absolute inset-x-0 grid border-b border-border/60 hover:bg-muted/50"
          :style="{
            gridTemplateColumns: template,
            height: `${ROW_HEIGHT}px`,
            transform: `translateY(${item.start}px)`,
          }"
        >
          <div
            v-if="rowNumbers"
            class="sticky left-0 bg-background px-2 text-right leading-8 text-muted-foreground tabular-nums"
          >
            {{ item.index + 1 }}
          </div>
          <div
            v-for="(column, columnIndex) in columns"
            :key="column.key"
            role="gridcell"
            :title="cell(item.index, columnIndex).text"
            :class="
              cn(
                'truncate px-3 leading-8',
                cell(item.index, columnIndex).kind === 'number' &&
                  'text-right tabular-nums',
                cell(item.index, columnIndex).kind === 'empty' &&
                  'text-muted-foreground/60',
                (cell(item.index, columnIndex).kind === 'null' ||
                  cell(item.index, columnIndex).kind === 'binary') &&
                  'text-muted-foreground italic',
              )
            "
          >
            {{ cell(item.index, columnIndex).text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
