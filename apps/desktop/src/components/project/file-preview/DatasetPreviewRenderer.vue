<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  openAvroDataset,
  openParquet,
  openSqlite,
  openWasm,
  type Dataset,
} from "@/lib/datasets";
import { previewExtension } from "@/shared/previewFormats";
import DataGrid from "./DataGrid.vue";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t, locale } = useI18n();
const toolbar = usePreviewToolbar(() => props.compact);

const openers: Record<string, (buffer: ArrayBuffer) => Promise<Dataset>> = {
  sqlite: openSqlite,
  sqlite3: openSqlite,
  db: openSqlite,
  parquet: openParquet,
  avro: openAvroDataset,
  wasm: openWasm,
};

const dataset = shallowRef<Dataset>();
const selected = ref("0");
const reading = new AbortController();
const table = computed(() => dataset.value?.tables[Number(selected.value)]);
const columns = computed(() =>
  (table.value?.columns ?? []).map((column) => ({
    key: column.name,
    label: column.name,
    type: column.type,
  })),
);
const loadRows = computed(
  () => table.value?.rows ?? (() => Promise.resolve([])),
);

watch(table, (current) => {
  if (current)
    emit("metadataChange", {
      rowCount: current.rowCount,
      columnCount: current.columns.length,
    });
});

onMounted(async () => {
  try {
    const open = openers[previewExtension(props.filePath)];
    if (!open) throw new Error("No reader for this data format.");
    const opened = await open(
      await readPreviewBytes(props.preview, reading.signal),
    );
    if (reading.signal.aborted) {
      opened.close?.();
      return;
    }
    dataset.value = opened;
    if (opened.tables.length > 1) emit("capabilitiesChange", { toolbar: true });
    const first = opened.tables[0];
    if (first)
      emit("metadataChange", {
        rowCount: first.rowCount,
        columnCount: first.columns.length,
      });
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the data preview.", error);
    emit("failed");
  }
});

onBeforeUnmount(() => {
  reading.abort();
  dataset.value?.close?.();
});
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport
      v-if="toolbar && dataset && dataset.tables.length > 1"
      :to="toolbar"
    >
      <Select v-model="selected">
        <SelectTrigger
          size="sm"
          class="w-56"
          :aria-label="t('project.preview.table')"
        >
          <SelectValue>{{ table?.name }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="(item, index) in dataset.tables"
            :key="item.name"
            :value="String(index)"
          >
            <span class="truncate">{{ item.name }}</span>
            <span class="ml-auto pl-4 text-muted-foreground tabular-nums">{{
              item.rowCount.toLocaleString(locale)
            }}</span>
          </SelectItem>
        </SelectContent>
      </Select>
    </Teleport>
    <DataGrid
      v-if="table"
      :columns="columns"
      :row-count="table.rowCount"
      :load-rows="loadRows"
      @failed="emit('failed')"
    />
    <div
      v-else-if="!dataset"
      class="absolute inset-0 grid place-items-center"
      role="status"
    >
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
