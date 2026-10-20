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

/**
 * Faded example rows filling an empty process list, with the label on the
 * middle one.
 */
defineProps<{ label: string }>();

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
  })),
);
</script>

<template>
  <div
    ref="root"
    class="flex min-h-0 flex-1 flex-col justify-center overflow-hidden"
  >
    <SidebarMenu>
      <SidebarMenuItem
        v-for="(row, index) in rows"
        :key="index"
        :aria-hidden="index !== middleIndex || undefined"
      >
        <SidebarMenuButton as="div" class="pointer-events-none">
          <component
            :is="row.icon"
            aria-hidden="true"
            class="text-muted-foreground opacity-50"
          />
          <div class="flex min-w-0 flex-1 items-center">
            <span
              v-if="index === middleIndex"
              data-testid="project-background-task-empty-label"
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
            aria-hidden="true"
            class="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums opacity-50"
          >
            {{ row.duration }}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </div>
</template>
