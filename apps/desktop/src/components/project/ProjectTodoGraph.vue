<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  layoutTodoGraph,
  sanitizeTaskText,
  type Task,
  type TodoGraphEdge,
} from "@pine/rpiv-todo";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const props = defineProps<{
  tasks: readonly Task[];
  /** The in-progress node pulses only while the agent is working. */
  isRunning: boolean;
}>();
const emit = defineEmits<{ select: [] }>();
const { t } = useI18n();

const LANE_WIDTH = 14;
/** The sidebar button's horizontal padding (`px-3`). */
const TEXT_INSET = 12;
const NODE_RADIUS = 4;
const CURVE = 14;
/** A button is `h-9`; the first text line's centre sits at half of it. */
const FIRST_LINE_CENTER = 18;
const ROW_PITCH = 38;

const layout = computed(() => layoutTodoGraph(props.tasks));
const gutterWidth = computed(() => layout.value.laneCount * LANE_WIDTH);

const root = ref<HTMLElement | null>(null);
const rowElements = ref<HTMLElement[]>([]);
const measured = ref<number[]>([]);

/** Rows grow when a task shows its active form, so centres are measured. */
function measure(): void {
  const elements = rowElements.value.slice(0, layout.value.rows.length);
  // Unlaid-out environments report zero sizes; fall back to a fixed pitch.
  measured.value = elements.some((element) => element.offsetHeight > 0)
    ? elements.map((element) => element.offsetTop + FIRST_LINE_CENTER)
    : [];
}
const centers = computed(() =>
  layout.value.rows.map(
    (_, index) =>
      measured.value[index] ?? index * ROW_PITCH + FIRST_LINE_CENTER,
  ),
);
const height = computed(() =>
  Math.max(0, (centers.value.at(-1) ?? 0) + FIRST_LINE_CENTER),
);

onMounted(measure);
watch(
  () => props.tasks,
  () => void nextTick(measure),
  { deep: true },
);
useResizeObserver(root, measure);

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/**
 * A straight run in the dependency's lane. Into another lane, it holds its
 * lane until just above the dependant, then curves into the dependant's node.
 */
function edgePath(edge: TodoGraphEdge): string {
  const fromX = laneX(edge.fromLane);
  const toX = laneX(edge.toLane);
  const fromY = centers.value[edge.from] ?? 0;
  const toY = centers.value[edge.to] ?? 0;
  if (fromX === toX) return `M ${fromX} ${fromY} V ${toY}`;
  const bend = Math.min(CURVE, toY - fromY);
  return `M ${fromX} ${fromY} V ${toY - bend} Q ${fromX} ${toY} ${toX} ${toY}`;
}

function statusLabel(task: Task): string {
  return t(`project.todos.statuses.${task.status}`);
}
</script>

<template>
  <div ref="root" class="relative">
    <svg
      data-testid="project-todo-graph"
      aria-hidden="true"
      class="pointer-events-none absolute top-0"
      :style="{ left: `${TEXT_INSET}px` }"
      :width="gutterWidth"
      :height="height"
    >
      <path
        v-for="(edge, index) in layout.edges"
        :key="index"
        data-testid="project-todo-edge"
        :data-satisfied="edge.satisfied"
        :d="edgePath(edge)"
        fill="none"
        stroke-width="1.5"
        stroke-linecap="round"
        :stroke-dasharray="edge.satisfied ? undefined : '3 3'"
        class="stroke-muted-foreground/50"
      />
      <g v-for="(row, index) in layout.rows" :key="row.task.id">
        <circle
          v-if="row.task.status === 'in_progress'"
          :cx="laneX(row.lane)"
          :cy="centers[index]"
          :r="NODE_RADIUS + 3"
          :class="cn('fill-primary/20', isRunning && 'animate-pulse')"
        />
        <circle
          data-testid="project-todo-node"
          :data-status="row.task.status"
          :data-lane="row.lane"
          :cx="laneX(row.lane)"
          :cy="centers[index]"
          :r="NODE_RADIUS"
          stroke-width="1.5"
          :class="
            row.task.status === 'in_progress'
              ? 'fill-primary stroke-primary'
              : row.task.status === 'completed'
                ? 'fill-muted-foreground/60 stroke-muted-foreground/60'
                : 'fill-sidebar stroke-muted-foreground'
          "
        />
      </g>
    </svg>

    <SidebarMenu>
      <SidebarMenuItem
        v-for="(row, index) in layout.rows"
        :key="row.task.id"
        :ref="
          (element) => {
            if (element)
              rowElements[index] = (element as { $el: HTMLElement }).$el;
          }
        "
        data-testid="project-todo-row"
        :data-status="row.task.status"
      >
        <SidebarMenuButton
          class="h-auto min-h-9 py-2"
          :style="{ paddingLeft: `${TEXT_INSET + gutterWidth + 8}px` }"
          :title="
            row.task.description
              ? sanitizeTaskText(row.task.description)
              : sanitizeTaskText(row.task.subject)
          "
          @click="emit('select')"
        >
          <span class="sr-only">{{ statusLabel(row.task) }}</span>
          <span class="flex min-w-0 flex-col">
            <span
              :class="
                cn(
                  'truncate',
                  row.task.status === 'in_progress' &&
                    'text-primary font-medium',
                  row.task.status === 'completed' &&
                    'text-muted-foreground line-through',
                )
              "
            >
              {{ sanitizeTaskText(row.task.subject) }}
            </span>
            <span
              v-if="row.task.status === 'in_progress' && row.task.activeForm"
              class="text-muted-foreground truncate text-xs"
            >
              {{ sanitizeTaskText(row.task.activeForm) }}
            </span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </div>
</template>
