<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { selectTodoCounts, type TaskState } from "@pine/rpiv-todo";
import ProjectTodoGraph from "./ProjectTodoGraph.vue";
import ProjectTodoListDialog from "./ProjectTodoListDialog.vue";

/**
 * The todo half of the status card: the whole dependency graph, scrolling
 * inside the card once it outgrows it. It opens the full list.
 */
const props = defineProps<{
  /** Already without deleted and faded tasks; see `visibleTodoState`. */
  visible: TaskState;
  /** Every task, for the full list and the progress count. */
  todos: TaskState;
  /** The in-progress loader spins only while the agent is working. */
  isRunning: boolean;
}>();
const { t } = useI18n();
const isListOpen = ref(false);
const scroller = useTemplateRef<HTMLElement>("scroller");

const counts = computed(() => selectTodoCounts(props.todos));
const label = computed(
  () =>
    `${t("project.todos.heading")} ${t("project.todos.progress", {
      completed: counts.value.completed,
      total: counts.value.total,
    })}`,
);

/** Centres the task being worked on as the agent moves through them. */
const activeTaskId = computed(
  () => props.visible.tasks.find((task) => task.status === "in_progress")?.id,
);
watch(
  activeTaskId,
  async (id) => {
    if (id === undefined) return;
    await nextTick();
    const container = scroller.value;
    const row = container?.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
    if (!container || !row) return;
    // Centred, so the row never sits under the scroll fade at either edge.
    container.scrollTop =
      row.offsetTop - (container.clientHeight - row.offsetHeight) / 2;
  },
  { immediate: true },
);
</script>

<template>
  <div
    role="button"
    tabindex="0"
    data-testid="project-todo-summary"
    :aria-label="label"
    class="min-w-0 cursor-pointer rounded-(--status-card-inner-radius) px-3 py-(--status-card-inset) transition-colors duration-500 ease-out-expo outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/30"
    @click="isListOpen = true"
    @keydown.enter.prevent="isListOpen = true"
    @keydown.space.prevent="isListOpen = true"
  >
    <div
      ref="scroller"
      class="scroll-fade-y no-scrollbar relative max-h-(--status-card-list-height) overflow-y-auto overscroll-contain"
    >
      <ProjectTodoGraph :tasks="visible.tasks" :is-running="isRunning" />
    </div>

    <ProjectTodoListDialog
      v-model:open="isListOpen"
      :todos="todos"
      :is-running="isRunning"
    />
  </div>
</template>
