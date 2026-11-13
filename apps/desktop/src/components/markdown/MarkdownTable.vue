<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import MarkdownRender, { type TableNode } from "markstream-vue";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type MarkdownTableNode = InstanceType<typeof TableNode>["$props"]["node"];

const props = defineProps<{
  node: MarkdownTableNode;
  customId?: string;
  isDark?: boolean;
}>();

/**
 * What the cells resolved to beyond their own source: node types plus link,
 * image and reference targets. A table's `raw` can stay the same while text
 * elsewhere in the message changes how it parses (a footnote or link
 * reference definition that streams in later), so the memo key covers that.
 */
function resolvedShape(value: unknown): string {
  if (Array.isArray(value)) return value.map(resolvedShape).join(",");
  if (!value || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  let shape = typeof node.type === "string" ? node.type : "";
  for (const key of ["href", "src", "id", "label"]) {
    const field = node[key];
    if (typeof field === "string") shape += `|${key}=${field}`;
  }
  const nested = [node.header, node.rows, node.cells, node.children]
    .filter((child) => child !== undefined)
    .map(resolvedShape)
    .join(";");
  return nested ? `${shape}(${nested})` : shape;
}

// markstream re-creates this node on every parse of a streaming block, so a
// finished table would re-render each of its per-cell renderers per flush.
// `contentKey` covers everything the node contributes to the output; the
// template renders `renderedNode`, which is replaced only when that key
// changes. The slot bodies below run inside the Table components' own render
// effects, so reading `props.node` there would re-render every cell on every
// parse whatever the memo says.
const contentKey = computed(() =>
  JSON.stringify([
    props.node.raw,
    props.node.loading,
    resolvedShape(props.node),
  ]),
);
const renderedNode = shallowRef<MarkdownTableNode>(props.node);
watch(
  contentKey,
  () => {
    renderedNode.value = props.node;
  },
  { flush: "sync" },
);
// Every input of the template: the node's content, `customId` and `isDark`.
const memoKey = computed(() => [
  contentKey.value,
  props.customId,
  props.isDark,
]);

function alignment(align?: "left" | "right" | "center"): string {
  return cn(
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left",
  );
}
</script>

<template>
  <div
    v-memo="memoKey"
    data-slot="markdown-table"
    class="markdown-table my-6 overflow-hidden rounded-lg"
  >
    <Table>
      <TableHeader class="bg-muted">
        <TableRow>
          <TableHead
            v-for="(cell, index) in renderedNode.header.cells"
            :key="index"
            class="px-4 py-3"
            :class="alignment(cell.align)"
          >
            <MarkdownRender
              class="table-cell-content"
              :nodes="cell.children"
              :custom-id="customId"
              :is-dark="isDark"
              :final="!renderedNode.loading"
              :smooth-streaming="false"
              html-policy="escape"
              mode="chat"
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody class="[&>tr:nth-child(even):not(:hover)]:bg-muted/30">
        <TableRow v-for="(row, rowIndex) in renderedNode.rows" :key="rowIndex">
          <TableCell
            v-for="(cell, cellIndex) in row.cells"
            :key="cellIndex"
            class="px-4 py-3"
            :class="alignment(cell.align)"
          >
            <MarkdownRender
              class="table-cell-content"
              :nodes="cell.children"
              :custom-id="customId"
              :is-dark="isDark"
              :final="!renderedNode.loading"
              :smooth-streaming="false"
              html-policy="escape"
              mode="chat"
            />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>

<style scoped>
/* Inline Markdown must inherit the native Table cell's font and whitespace. */
.table-cell-content {
  display: contents;
  font: inherit;
}

.table-cell-content :deep(.node-slot),
.table-cell-content :deep(.node-content) {
  display: contents;
}

.table-cell-content :deep(.text-node) {
  white-space: inherit;
}

/* Keep code wrapping at normal line-break opportunities (such as path
   separators) without inheriting MarkdownContent's anywhere wrapping. */
.markdown-table :deep(code.inline-code) {
  white-space: normal;
  overflow-wrap: normal;
  word-break: normal;
}
</style>
