<script setup lang="ts">
import {
  CheckIcon,
  CircleStopIcon,
  CircleXIcon,
  LoaderCircleIcon,
} from "@lucide/vue";
import { useElementSize } from "@vueuse/core";
import { computed, ref } from "vue";
import { formatDuration } from "@pine/pi-background-tasks";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

defineProps<{
  kind: "todos" | "processes";
  label: string;
}>();

const root = ref<HTMLElement | null>(null);
const { height } = useElementSize(root);
// Match the sidebar's 36px rows and 2px gaps; keep a single middle row.
const ROW_HEIGHT = 36;
const ROW_GAP = 2;
const ROW_PITCH = ROW_HEIGHT + ROW_GAP;
const rowCount = computed(() => {
  const available = Math.max(
    1,
    Math.floor((height.value + ROW_GAP) / ROW_PITCH),
  );
  return available % 2 === 0 ? available - 1 : available;
});
const middleIndex = computed(() => Math.floor(rowCount.value / 2));

// Decorative examples stay local to the empty state, never entering a store.
const examples = [
  { width: "62%", icon: CheckIcon },
  { width: "44%", icon: CircleStopIcon },
  { width: "58%", icon: LoaderCircleIcon },
  { width: "52%", icon: CircleXIcon },
  { width: "36%", icon: CheckIcon },
];
const durations = new Map<number, string>();
function exampleDuration(index: number): string {
  const existing = durations.get(index);
  if (existing) return existing;
  const value = formatDuration(Math.floor(Math.random() * 600_000) + 1000);
  durations.set(index, value);
  return value;
}
const rows = computed(() =>
  Array.from({ length: rowCount.value }, (_, index) => ({
    ...examples[index % examples.length],
    duration: exampleDuration(index),
    x: index % 4 === 2 ? 5.5 : 16.5,
    y: index * ROW_PITCH + ROW_HEIGHT / 2,
    status:
      index < middleIndex.value
        ? "completed"
        : index === middleIndex.value
          ? "in_progress"
          : "pending",
  })),
);
const graphHeight = computed(() => rowCount.value * ROW_PITCH - ROW_GAP);
const edges = computed(() => {
  const result: { path: string; completed: boolean }[] = [];
  for (const [index, from] of rows.value.entries()) {
    const targets = [rows.value[index + 1]];
    // A small fork and join every four rows illustrates dependencies.
    if (index % 4 === 1) targets.push(rows.value[index + 2]);
    for (const to of targets) {
      if (!to) continue;
      result.push({
        path:
          from.x === to.x
            ? `M${from.x} ${from.y}V${to.y}`
            : `M${from.x} ${from.y}V${to.y - 14}Q${from.x} ${to.y} ${to.x} ${to.y}`,
        completed: from.status === "completed",
      });
    }
  }
  return result;
});
</script>

<template>
  <div
    ref="root"
    class="flex min-h-0 flex-1 flex-col justify-center overflow-hidden"
  >
    <div class="relative">
      <SidebarMenu>
        <SidebarMenuItem
          v-for="(row, index) in rows"
          :key="index"
          :aria-hidden="index !== middleIndex || undefined"
        >
          <SidebarMenuButton as="div" class="pointer-events-none">
            <component
              :is="row.icon"
              v-if="kind === 'processes'"
              aria-hidden="true"
              class="text-muted-foreground opacity-50"
            />
            <div class="flex min-w-0 flex-1 items-center">
              <span
                v-if="index === middleIndex"
                data-testid="project-sidebar-empty-label"
                class="text-muted-foreground truncate"
              >
                {{ label }}
              </span>
              <Skeleton
                v-else
                aria-hidden="true"
                class="h-2.5 animate-none opacity-60"
                :style="{ width: row.width }"
              />
            </div>
            <span
              v-if="kind === 'processes'"
              aria-hidden="true"
              class="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums opacity-50"
            >
              {{ row.duration }}
            </span>
            <span v-else aria-hidden="true" class="w-5 shrink-0" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <svg
        v-if="kind === 'todos'"
        aria-hidden="true"
        class="pointer-events-none absolute top-0 right-3 overflow-visible"
        width="22"
        :height="graphHeight"
        fill="none"
        stroke-width="1.5"
      >
        <g class="stroke-muted-foreground/30" stroke-linecap="round">
          <path
            v-for="(edge, index) in edges"
            :key="index"
            :d="edge.path"
            :stroke-dasharray="edge.completed ? undefined : '3 3'"
          />
        </g>
        <g v-for="(row, index) in rows" :key="index">
          <circle
            v-if="row.status === 'in_progress'"
            :cx="row.x"
            :cy="row.y"
            r="7"
            class="fill-muted-foreground/10"
            stroke="none"
          />
          <circle
            :cx="row.x"
            :cy="row.y"
            r="4"
            :class="{
              'fill-muted-foreground/30 stroke-muted-foreground/40':
                row.status === 'completed',
              'fill-muted-foreground/50 stroke-muted-foreground/50':
                row.status === 'in_progress',
              'fill-sidebar stroke-muted-foreground/40':
                row.status === 'pending',
            }"
          />
        </g>
      </svg>
    </div>
  </div>
</template>
