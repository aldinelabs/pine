<script setup lang="ts">
import type { TaskState } from "@pine/rpiv-todo";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useCollapseTransition } from "@/composables/useCollapseTransition";
import { visibleTodoState } from "@/lib/sessionStatus";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import ProjectBackgroundTaskCard from "./ProjectBackgroundTaskCard.vue";
import ProjectTodoCard from "./ProjectTodoCard.vue";

/**
 * What the session is working through, at the end of the transcript: the
 * todo list and the background processes, side by side, each as wide as its
 * content. Cards grow in and shrink away, so the transcript glides rather
 * than jumps when one appears or fades.
 */
const props = defineProps<{
  todos: TaskState | null;
  /** Completed tasks fade from the card once a full turn has passed. */
  hiddenCompletedIds: ReadonlySet<number>;
  /** The in-progress loader spins only while the agent is working. */
  isRunning: boolean;
}>();
const { visibleTasks: tasks } = storeToRefs(useBackgroundTasksStore());
const row = useCollapseTransition("height");
const card = useCollapseTransition("both");

const hasTodos = computed(() =>
  Boolean(
    visibleTodoState(props.todos, props.hiddenCompletedIds)?.tasks.length,
  ),
);
const hasTasks = computed(() => tasks.value.length > 0);
</script>

<template>
  <Transition :css="false" @enter="row.onEnter" @leave="row.onLeave">
    <!-- The top padding stands in for the transcript's item gap, so it
         collapses along with the cards. -->
    <div
      v-if="hasTodos || hasTasks"
      data-testid="project-session-status"
      class="pt-8"
    >
      <div class="flex items-start gap-2 *:pointer-events-auto">
        <Transition :css="false" @enter="card.onEnter" @leave="card.onLeave">
          <ProjectTodoCard
            v-if="hasTodos"
            class="min-w-0"
            :todos="todos"
            :hidden-completed-ids="hiddenCompletedIds"
            :is-running="isRunning"
          />
        </Transition>
        <Transition :css="false" @enter="card.onEnter" @leave="card.onLeave">
          <ProjectBackgroundTaskCard v-if="hasTasks" class="min-w-0" />
        </Transition>
      </div>
    </div>
  </Transition>
</template>
