<script setup lang="ts">
import { ListTodoIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { selectTodoCounts, type TaskState } from "@pine/rpiv-todo";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import ProjectTodoGraph from "./ProjectTodoGraph.vue";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";

const props = defineProps<{ todos: TaskState | null; isRunning: boolean }>();
const open = defineModel<boolean>("open", { required: true });
const { t } = useI18n();
const state = computed<TaskState>(
  () => props.todos ?? { tasks: [], nextId: 1 },
);
const tasks = computed(() =>
  state.value.tasks.filter((task) => task.status !== "deleted"),
);
const counts = computed(() => selectTodoCounts(state.value));
const summary = computed(() =>
  [
    counts.value.completed
      ? t("project.todos.dialog.summaryCompleted", {
          completed: counts.value.completed,
          total: counts.value.total,
        })
      : "",
    counts.value.inProgress
      ? t("project.todos.dialog.summaryInProgress", {
          count: counts.value.inProgress,
        })
      : "",
    counts.value.pending
      ? t("project.todos.dialog.summaryPending", {
          count: counts.value.pending,
        })
      : "",
  ]
    .filter(Boolean)
    .join(" · "),
);
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :class="[
        'flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
      data-testid="project-todo-list-dialog"
    >
      <DialogHeader class="shrink-0 pr-8">
        <DialogTitle>{{ t("project.todos.dialog.title") }}</DialogTitle>
        <DialogDescription :class="!summary && 'sr-only'">{{
          summary || t("project.todos.dialog.emptyTitle")
        }}</DialogDescription>
      </DialogHeader>
      <DialogScrollArea class="flex-1" data-testid="project-todo-list-scroll">
        <Empty v-if="tasks.length === 0">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ListTodoIcon /></EmptyMedia>
            <EmptyTitle>{{ t("project.todos.dialog.emptyTitle") }}</EmptyTitle>
            <EmptyDescription>{{
              t("project.todos.dialog.emptyDescription")
            }}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <ProjectTodoGraph
          v-else
          :tasks="tasks"
          :is-running="isRunning"
          detailed
        />
      </DialogScrollArea>
    </DialogContent>
  </Dialog>
</template>
