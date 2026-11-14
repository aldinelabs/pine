<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/formatBytes";
import { formatDuration } from "@/lib/formatDuration";
import type { ProjectFilePreview } from "@/shared/projectFiles";
import type {
  PreviewProperty,
  PreviewRendererMetadata,
} from "./file-preview/previewRenderer";

/**
 * What is known about a previewed file: what every file has (type, size,
 * times, location), what the preview measured (lines, dimensions, pages) and
 * what the format itself records (document properties, tags, headers).
 */
const props = defineProps<{
  preview: ProjectFilePreview | undefined;
  /** The preview is still being read. */
  loading: boolean;
  fileType: string;
  /** Where the file is: its path in the project, or its full path. */
  path: string;
  metadata: PreviewRendererMetadata | undefined;
}>();
const { t, locale } = useI18n();

interface Row {
  key: string;
  label: string;
  value: string;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatNumber(value: number): string {
  return value.toLocaleString(locale.value);
}

function propertyValue(property: PreviewProperty): string {
  switch (property.type) {
    case "number":
      return formatNumber(property.value);
    case "date":
      return formatDate(property.value);
    case "boolean":
      return t(`project.preview.details.${property.value ? "yes" : "no"}`);
    default:
      return property.value;
  }
}

const rows = computed<Row[]>(() => {
  const preview = props.preview;
  if (!preview) return [];
  const metadata = props.metadata;
  const label = (key: string) => t(`project.preview.details.${key}`);
  const result: Row[] = [
    { key: "type", label: label("type"), value: props.fileType },
    {
      key: "size",
      label: label("size"),
      value: `${formatBytes(preview.size, locale.value)} (${formatNumber(preview.size)} B)`,
    },
    {
      key: "modified",
      label: label("modified"),
      value: formatDate(preview.modifiedAt),
    },
  ];
  if (preview.createdAt)
    result.push({
      key: "created",
      label: label("created"),
      value: formatDate(preview.createdAt),
    });
  result.push({ key: "location", label: label("location"), value: props.path });
  if (preview.kind === "text") {
    result.push({
      key: "encoding",
      label: label("encoding"),
      value: preview.encoding.toUpperCase(),
    });
    if (metadata?.rowCount === undefined)
      result.push({
        key: "lines",
        label: label("lines"),
        value: formatNumber(preview.text.split(/\r\n|\r|\n/).length),
      });
  }
  if (metadata?.width !== undefined && metadata.height !== undefined)
    result.push({
      key: "dimensions",
      label: label("dimensions"),
      value: `${formatNumber(metadata.width)} × ${formatNumber(metadata.height)}`,
    });
  if (metadata?.duration !== undefined && Number.isFinite(metadata.duration))
    result.push({
      key: "duration",
      label: label("duration"),
      value: formatDuration(metadata.duration),
    });
  if (metadata?.pageCount)
    result.push({
      key: "pages",
      label: label("pages"),
      value: formatNumber(metadata.pageCount),
    });
  if (metadata?.rowCount !== undefined) {
    result.push({
      key: "rows",
      label: label("rows"),
      value: formatNumber(metadata.rowCount),
    });
    result.push({
      key: "columns",
      label: label("columns"),
      value: formatNumber(metadata.columnCount ?? 0),
    });
  }
  for (const property of metadata?.properties ?? []) {
    const value = propertyValue(property);
    if (!value.trim()) continue;
    result.push({
      key: `property:${property.key}`,
      label: t(`project.preview.details.properties.${property.key}`),
      value,
    });
  }
  return result;
});
</script>

<template>
  <section
    data-slot="preview-details"
    class="flex min-h-0 flex-col"
    :aria-label="t('project.preview.details.title')"
  >
    <dl
      v-if="preview"
      class="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 pb-3 text-xs"
    >
      <template v-for="row in rows" :key="row.key">
        <dt class="text-muted-foreground" :data-detail="row.key">
          {{ row.label }}
        </dt>
        <dd
          class="min-w-0 whitespace-pre-line break-words tabular-nums select-text"
          :title="row.value"
        >
          {{ row.value }}
        </dd>
      </template>
    </dl>
    <!-- The rows every file has, held at their height while it loads. -->
    <div
      v-else-if="loading"
      class="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 pb-3"
      role="status"
      :aria-label="t('project.files.loading')"
    >
      <template v-for="index in 5" :key="index">
        <Skeleton class="my-0.5 h-3 w-14" />
        <Skeleton class="my-0.5 h-3 w-full max-w-40" />
      </template>
    </div>
  </section>
</template>
