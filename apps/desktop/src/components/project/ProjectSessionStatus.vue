<script setup lang="ts">
import type { TaskState } from "@pine/rpiv-todo";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useCollapseTransition } from "@/composables/useCollapseTransition";
import { visibleTodoState } from "@/lib/sessionStatus";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import { cn } from "@/lib/utils";
import ProjectBackgroundTaskCard from "./ProjectBackgroundTaskCard.vue";
import ProjectTodoCard from "./ProjectTodoCard.vue";

/**
 * What the session is working through, at the end of the transcript: the
 * todo list and the background processes, side by side. They share the row
 * according to content, with room reserved for both when one label is long. Cards grow in and shrink away, so the transcript glides rather
 * than jumps when one appears or fades. While the transcript follows its
 * bottom the cards hold still above the composer and the reply scrolls under
 * them; only the cards themselves take clicks.
 */
const props = defineProps<{
  todos: TaskState | null;
  /** Completed tasks fade from the card once a full turn has passed. */
  hiddenCompletedIds: ReadonlySet<number>;
  /** The in-progress loader spins only while the agent is working. */
  isRunning: boolean;
  /** False when staged steering sits directly above, which owns the gap. */
  topGap?: boolean;
}>();
const { visibleTasks: tasks } = storeToRefs(useBackgroundTasksStore());
const row = useCollapseTransition("height");
const card = useCollapseTransition("width");

const hasTodos = computed(() =>
  Boolean(
    visibleTodoState(props.todos, props.hiddenCompletedIds)?.tasks.length,
  ),
);
const hasTasks = computed(() => tasks.value.length > 0);
</script>

<template>
  <Transition :css="false" @enter="row.onEnter" @leave="row.onLeave">
    <!-- Animated boxes carry no padding, border or gap of their own: a box
         collapsing to nothing must take all of its space with it, or that
         space vanishes in one frame when it is removed. -->
    <!-- Bottom-aligned, so while its room grows the cards already sit where
         they will reveal, above the composer, rather than hang below. -->
    <div
      v-if="hasTodos || hasTasks"
      data-testid="project-session-status"
      class="flex flex-col justify-end"
    >
      <!-- On a phone the cards keep their content width and the row scrolls
           horizontally with an edge fade, instead of squeezing either card. -->
      <div
        data-testid="project-status-card-scroll"
        class="max-sm:pointer-events-auto max-sm:-mx-1 max-sm:overflow-x-auto max-sm:overscroll-x-contain max-sm:no-scrollbar"
      >
        <div
          data-testid="project-status-card-row"
          :class="
            cn(
              'flex w-fit max-w-full items-stretch gap-3',
              'max-sm:min-w-full max-sm:max-w-none max-sm:p-1',
              props.topGap === false ? 'pt-3' : 'pt-8',
            )
          "
        >
          <Transition :css="false" @enter="card.onEnter" @leave="card.onLeave">
            <div
              v-if="hasTodos"
              data-testid="project-todo-card-slot"
              class="pointer-events-auto flex min-w-[30%] flex-auto max-sm:min-w-0 max-sm:flex-none"
            >
              <ProjectTodoCard
                :todos="todos"
                :hidden-completed-ids="hiddenCompletedIds"
                :is-running="isRunning"
              />
            </div>
          </Transition>
          <Transition :css="false" @enter="card.onEnter" @leave="card.onLeave">
            <div
              v-if="hasTasks"
              data-testid="project-background-task-card-slot"
              class="pointer-events-auto flex min-w-[30%] flex-auto max-sm:min-w-0 max-sm:flex-none"
            >
              <ProjectBackgroundTaskCard />
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Transition>
</template>
