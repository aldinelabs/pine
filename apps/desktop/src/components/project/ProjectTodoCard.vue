<script setup lang="ts">
import type { TaskState } from "@pine/rpiv-todo";
import { computed } from "vue";
import { Card } from "@/components/ui/card";
import { visibleTodoState } from "@/lib/sessionStatus";
import ProjectTodoSummary from "./ProjectTodoSummary.vue";

/**
 * The session's todo list at the end of the transcript, as wide as its
 * longest task. It shows until every task has faded or been deleted.
 */
const props = defineProps<{
  todos: TaskState | null;
  /** Completed tasks fade from the card once a full turn has passed. */
  hiddenCompletedIds: ReadonlySet<number>;
  /** The in-progress loader spins only while the agent is working. */
  isRunning: boolean;
}>();

const visible = computed(() => {
  const state = visibleTodoState(props.todos, props.hiddenCompletedIds);
  return state?.tasks.length ? state : null;
});
</script>

<template>
  <Card
    v-if="visible && todos"
    size="sm"
    data-testid="project-todo-card"
    class="status-card w-fit max-w-full gap-0 p-(--status-card-inset) shadow-none"
  >
    <ProjectTodoSummary
      :visible="visible"
      :todos="todos"
      :is-running="isRunning"
    />
  </Card>
</template>
