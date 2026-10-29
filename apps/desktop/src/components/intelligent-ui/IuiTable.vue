<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
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

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Table">>>();

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof value === "boolean") return value ? "✓" : "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}
</script>

<template>
  <div data-slot="iui-table" class="min-w-0">
    <Table>
      <TableCaption v-if="props.props.caption">
        {{ props.props.caption }}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead
            v-for="(column, index) in props.props.columns ?? []"
            :key="index"
          >
            {{ column }}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="(row, rowIndex) in props.props.rows ?? []"
          :key="rowIndex"
        >
          <TableCell
            v-for="(value, cellIndex) in row ?? []"
            :key="cellIndex"
            :class="typeof value === 'number' && 'tabular-nums'"
          >
            {{ formatCell(value) }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
