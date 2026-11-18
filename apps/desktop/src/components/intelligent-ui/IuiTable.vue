<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Table">>>();

function isComponent(value: unknown): boolean {
  return (
    Array.isArray(value) ||
    (typeof value === "object" &&
      value !== null &&
      (value as { type?: unknown }).type === "element")
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof value === "boolean") return value ? "✓" : "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

const rows = computed(() =>
  (props.props.rows ?? []).filter((row): row is unknown[] =>
    Array.isArray(row),
  ),
);

/** Columns whose filled cells are all numbers align right, like a ledger. */
const numeric = computed(() =>
  (props.props.columns ?? []).map((_column, index) => {
    const values = rows.value
      .map((row) => row[index])
      .filter((value) => value !== null && value !== undefined && value !== "");
    return (
      values.length > 0 && values.every((value) => typeof value === "number")
    );
  }),
);
</script>

<template>
  <div data-iui="table" class="min-w-0 overflow-hidden rounded-lg">
    <Table>
      <TableCaption v-if="props.props.caption">
        {{ props.props.caption }}
      </TableCaption>
      <TableHeader class="bg-muted">
        <TableRow>
          <TableHead
            v-for="(column, index) in props.props.columns ?? []"
            :key="index"
            class="px-4 py-3"
            :class="numeric[index] && 'text-right'"
          >
            {{ column }}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody class="[&>tr:nth-child(even):not(:hover)]:bg-muted/30">
        <TableRow v-for="(row, rowIndex) in rows" :key="rowIndex">
          <TableCell
            v-for="(value, cellIndex) in row"
            :key="cellIndex"
            class="px-4 py-3"
            :class="[
              typeof value === 'number' && 'tabular-nums',
              numeric[cellIndex] && 'text-right',
            ]"
          >
            <IuiNodes v-if="isComponent(value)" :value="value" />
            <template v-else>{{ formatCell(value) }}</template>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
