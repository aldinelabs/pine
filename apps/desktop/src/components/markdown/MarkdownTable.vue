<script setup lang="ts">
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

defineProps<{
  node: InstanceType<typeof TableNode>["$props"]["node"];
  customId?: string;
  isDark?: boolean;
}>();

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
    data-slot="markdown-table"
    class="markdown-table my-6 overflow-hidden rounded-lg"
  >
    <Table>
      <TableHeader class="bg-muted">
        <TableRow>
          <TableHead
            v-for="(cell, index) in node.header.cells"
            :key="index"
            class="px-4 py-3"
            :class="alignment(cell.align)"
          >
            <MarkdownRender
              class="table-cell-content"
              :nodes="cell.children"
              :custom-id="customId"
              :is-dark="isDark"
              :final="!node.loading"
              :smooth-streaming="false"
              html-policy="escape"
              mode="chat"
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody class="[&>tr:nth-child(even):not(:hover)]:bg-muted/30">
        <TableRow v-for="(row, rowIndex) in node.rows" :key="rowIndex">
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
              :final="!node.loading"
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
