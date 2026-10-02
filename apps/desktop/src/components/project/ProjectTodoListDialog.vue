<script setup lang="ts">
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ListTodoIcon,
} from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  sanitizeTaskText,
  selectTasksByStatus,
  selectTodoCounts,
  type Task,
  type TaskState,
} from "@pine/rpiv-todo";
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";

const props = defineProps<{
  todos: TaskState | null;
  isRunning: boolean;
}>();
const open = defineModel<boolean>("open", { required: true });
const { t } = useI18n();

/**
 * Pine's counterpart of upstream `/todos`: every task grouped by status,
 * regardless of the panel's row budget or completed-task fading.
 */
const state = computed<TaskState>(
  () => props.todos ?? { tasks: [], nextId: 1 },
);
const counts = computed(() => selectTodoCounts(state.value));
const sections = computed(() => {
  const groups = selectTasksByStatus(state.value);
  return [
    { status: "pending" as const, tasks: groups.pending },
    { status: "in_progress" as const, tasks: groups.inProgress },
    { status: "completed" as const, tasks: groups.completed },
  ].filter((section) => section.tasks.length > 0);
});
/** Upstream omits every count that is zero from the header. */
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

function blockedBy(task: Task): string | undefined {
  return task.blockedBy?.length
    ? t("project.todos.blockedBy", {
        ids: task.blockedBy.map((id) => `#${id}`).join(","),
      })
    : undefined;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[80vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("project.todos.dialog.title") }}</DialogTitle>
        <DialogDescription :class="!summary && 'sr-only'">
          {{ summary || t("project.todos.dialog.emptyTitle") }}
        </DialogDescription>
      </DialogHeader>

      <Empty v-if="sections.length === 0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListTodoIcon />
          </EmptyMedia>
          <EmptyTitle>{{ t("project.todos.dialog.emptyTitle") }}</EmptyTitle>
          <EmptyDescription>
            {{ t("project.todos.dialog.emptyDescription") }}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>

      <section
        v-for="section in sections"
        :key="section.status"
        :data-testid="`project-todo-section-${section.status}`"
        class="flex flex-col gap-1"
      >
        <h3 class="text-muted-foreground px-2.5 text-xs font-medium">
          {{ t(`project.todos.statuses.${section.status}`) }}
        </h3>
        <ItemGroup>
          <Item v-for="task in section.tasks" :key="task.id" size="xs">
            <ItemMedia variant="icon">
              <Spinner
                v-if="task.status === 'in_progress' && isRunning"
                class="text-primary"
              />
              <CircleDotIcon
                v-else-if="task.status === 'in_progress'"
                class="text-primary"
              />
              <CircleCheckIcon
                v-else-if="task.status === 'completed'"
                class="text-muted-foreground"
              />
              <CircleIcon v-else class="text-muted-foreground" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                <span class="text-muted-foreground tabular-nums">
                  #{{ task.id }}
                </span>
                {{ sanitizeTaskText(task.subject) }}
              </ItemTitle>
              <ItemDescription
                v-if="task.status === 'in_progress' && task.activeForm"
              >
                {{ sanitizeTaskText(task.activeForm) }}
              </ItemDescription>
              <ItemDescription v-else-if="task.description">
                {{ sanitizeTaskText(task.description) }}
              </ItemDescription>
            </ItemContent>
            <ItemActions
              v-if="blockedBy(task)"
              class="text-muted-foreground text-xs"
            >
              {{ blockedBy(task) }}
            </ItemActions>
          </Item>
        </ItemGroup>
      </section>
    </DialogContent>
  </Dialog>
</template>
