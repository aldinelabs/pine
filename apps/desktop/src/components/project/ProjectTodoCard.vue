<script setup lang="ts">
import type { TaskState } from "@pine/rpiv-todo";
import { computed } from "vue";
import { visibleTodoState } from "@/lib/sessionStatus";
import ProjectStatusCard from "./ProjectStatusCard.vue";
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
  <ProjectStatusCard v-if="visible && todos" data-testid="project-todo-card">
    <ProjectTodoSummary
      :visible="visible"
      :todos="todos"
      :is-running="isRunning"
    />
  </ProjectStatusCard>
</template>
