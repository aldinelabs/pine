<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  layoutTodoGraph,
  sanitizeTaskText,
  type Task,
  type TodoGraphEdge,
} from "@pine/rpiv-todo";
import { cn } from "@/lib/utils";

const props = defineProps<{
  tasks: readonly Task[];
  /** The in-progress loader spins only while the agent is working. */
  isRunning: boolean;
}>();
const { t } = useI18n();

const LANE_WIDTH = 11;
/** Space between the labels and the graph. */
const GRAPH_GAP = 6;
const NODE_RADIUS = 4;
/** The in-progress node is a small loader, slightly larger than a dot. */
const SPINNER_RADIUS = 4.5;
const CURVE = 8;
/** Rows are a single `h-6` line, so their centres need no measuring. */
const ROW_HEIGHT = 24;

const layout = computed(() => layoutTodoGraph(props.tasks));
const gutterWidth = computed(() => layout.value.laneCount * LANE_WIDTH);
const height = computed(() => layout.value.rows.length * ROW_HEIGHT);

function centerY(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/** Lane 0 hugs the right edge, so nodes keep their place as lanes appear. */
function laneX(lane: number): number {
  return gutterWidth.value - (lane + 0.5) * LANE_WIDTH;
}

/**
 * A straight run in the dependency's lane. Into another lane, it holds its
 * lane until just above the dependant, then curves into the dependant's node.
 */
function edgePath(edge: TodoGraphEdge): string {
  const fromX = laneX(edge.fromLane);
  const toX = laneX(edge.toLane);
  const fromY = centerY(edge.from);
  const toY = centerY(edge.to);
  if (fromX === toX) return `M ${fromX} ${fromY} V ${toY}`;
  const bend = Math.min(CURVE, toY - fromY);
  return `M ${fromX} ${fromY} V ${toY - bend} Q ${fromX} ${toY} ${toX} ${toY}`;
}

/** An in-progress task reads as what the agent is doing right now. */
function rowText(task: Task): string {
  return sanitizeTaskText(
    task.status === "in_progress" && task.activeForm
      ? task.activeForm
      : task.subject,
  );
}
</script>

<template>
  <div class="relative">
    <svg
      data-testid="project-todo-graph"
      aria-hidden="true"
      class="pointer-events-none absolute top-0 right-0 overflow-visible"
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
        <g
          v-if="row.task.status === 'in_progress'"
          data-testid="project-todo-node"
          :data-status="row.task.status"
          :data-lane="row.lane"
          :transform="`translate(${laneX(row.lane)} ${centerY(index)})`"
        >
          <circle
            :r="SPINNER_RADIUS"
            stroke-width="1.5"
            class="fill-card stroke-primary/25"
          />
          <circle
            :r="SPINNER_RADIUS"
            stroke-width="1.5"
            stroke-linecap="round"
            pathLength="100"
            stroke-dasharray="30 100"
            :class="
              cn(
                'fill-none stroke-primary origin-center [transform-box:fill-box]',
                isRunning && 'animate-spin',
              )
            "
          />
        </g>
        <circle
          v-else
          data-testid="project-todo-node"
          :data-status="row.task.status"
          :data-lane="row.lane"
          :cx="laneX(row.lane)"
          :cy="centerY(index)"
          :r="NODE_RADIUS"
          stroke-width="1.5"
          :class="
            row.task.status === 'completed'
              ? 'fill-muted-foreground/60 stroke-muted-foreground/60'
              : 'fill-card stroke-muted-foreground'
          "
        />
      </g>
    </svg>

    <ul
      class="flex flex-col"
      :style="{ paddingRight: `${gutterWidth + GRAPH_GAP}px` }"
    >
      <li
        v-for="row in layout.rows"
        :key="row.task.id"
        data-testid="project-todo-row"
        :data-task-id="row.task.id"
        :data-status="row.task.status"
        class="flex h-6 min-w-0 items-center gap-1.5"
      >
        <span class="sr-only">{{
          t(`project.todos.statuses.${row.task.status}`)
        }}</span>
        <span class="text-muted-foreground shrink-0 tabular-nums">
          #{{ row.task.id }}
        </span>
        <span
          :class="
            cn(
              'truncate',
              row.task.status === 'in_progress' && 'text-primary font-medium',
              row.task.status === 'completed' &&
                'text-muted-foreground line-through',
            )
          "
        >
          {{ rowText(row.task) }}
        </span>
      </li>
    </ul>
  </div>
</template>
