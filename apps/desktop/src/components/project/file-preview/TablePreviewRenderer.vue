<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type { GridCell } from "@/lib/dataGrid";
import { MAX_TABLE_ROWS, parseDelimited, readDbf } from "@/lib/tabularData";
import { previewExtension } from "@/shared/previewFormats";
import DataGrid, { type DataGridColumn } from "./DataGrid.vue";
import { readPreviewBytes, readPreviewText } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t, locale } = useI18n();
const toolbar = usePreviewToolbar(() => props.compact);

const columns = shallowRef<DataGridColumn[]>([]);
const rowCount = ref(0);
const truncated = ref(false);
const loadRows = shallowRef<
  (start: number, end: number) => Promise<GridCell[][]>
>(() => Promise.resolve([]));
const loading = ref(true);
const reading = new AbortController();

async function load(): Promise<void> {
  const extension = previewExtension(props.filePath);
  if (extension === "dbf") {
    const table = readDbf(
      await readPreviewBytes(props.preview, reading.signal),
    );
    columns.value = table.fields.map((field) => ({
      key: field.name,
      label: field.name,
      type: field.decimals
        ? `${field.type}(${field.length},${field.decimals})`
        : `${field.type}(${field.length})`,
    }));
    rowCount.value = table.rowCount;
    loadRows.value = (start, end) => Promise.resolve(table.rows(start, end));
    return;
  }
  const table = parseDelimited(
    await readPreviewText(props.preview, reading.signal),
    extension === "tsv" ? "\t" : ",",
  );
  columns.value = table.columns.map((label, index) => ({
    key: String(index),
    label,
  }));
  rowCount.value = table.rows.length;
  truncated.value = table.truncated;
  loadRows.value = (start, end) =>
    Promise.resolve(table.rows.slice(start, end));
}

onMounted(async () => {
  try {
    await load();
    emit("metadataChange", {
      rowCount: rowCount.value,
      columnCount: columns.value.length,
    });
    if (truncated.value) emit("capabilitiesChange", { toolbar: true });
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the table preview.", error);
    emit("failed");
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => reading.abort());
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar && truncated" :to="toolbar">
      <Badge variant="secondary">{{
        t("project.preview.truncatedRows", {
          count: MAX_TABLE_ROWS.toLocaleString(locale),
        })
      }}</Badge>
    </Teleport>
    <DataGrid
      v-if="!loading"
      :columns="columns"
      :row-count="rowCount"
      :load-rows="loadRows"
      @failed="emit('failed')"
    />
    <div v-else class="absolute inset-0 grid place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
