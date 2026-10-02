<script setup lang="ts">
import { ListTreeIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  DEFAULT_MAX_PANEL_LINES,
  selectOverlayLayout,
  selectTodoCounts,
  type TaskState,
} from "@pine/rpiv-todo";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSessionStore } from "@/stores/session";
import ProjectTodoGraph from "./ProjectTodoGraph.vue";
import ProjectTodoListDialog from "./ProjectTodoListDialog.vue";

const { t } = useI18n();
const session = useSessionStore();

/** Shows every task, like Pi's tool-output expansion does for the overlay. */
const showEverything = ref(false);
const isListOpen = ref(false);

/** Deleted tombstones never show; completed tasks fade after a full turn. */
const panelState = computed<TaskState | null>(() => {
  const todos = session.todos;
  if (!todos) return null;
  const hidden = session.hiddenCompletedTodoIds;
  return {
    nextId: todos.nextId,
    tasks: todos.tasks.filter(
      (task) =>
        task.status !== "deleted" &&
        !(task.status === "completed" && hidden.has(task.id)),
    ),
  };
});
const hasTasks = computed(() => Boolean(panelState.value?.tasks.length));
const counts = computed(() =>
  panelState.value ? selectTodoCounts(panelState.value) : null,
);
/** The heading counts against the row budget, as in the upstream overlay. */
const layout = computed(() => {
  const state = panelState.value;
  if (!state) return null;
  const all = selectOverlayLayout(state, Number.POSITIVE_INFINITY);
  const fitted = selectOverlayLayout(state, DEFAULT_MAX_PANEL_LINES - 1);
  const overflows = fitted.hiddenCompleted + fitted.truncatedTail > 0;
  return { ...(showEverything.value ? all : fitted), overflows };
});
const moreLabel = computed(() => {
  const current = layout.value;
  if (!current) return "";
  const count = current.hiddenCompleted + current.truncatedTail;
  const details = [
    current.hiddenCompleted
      ? t("project.todos.hiddenCompleted", { count: current.hiddenCompleted })
      : "",
    current.truncatedTail
      ? t("project.todos.hiddenPending", { count: current.truncatedTail })
      : "",
  ].filter(Boolean);
  return details.length
    ? t("project.todos.moreDetails", {
        count,
        details: details.join(t("project.todos.detailSeparator")),
      })
    : t("project.todos.more", { count });
});
</script>

<template>
  <SidebarGroup
    v-if="hasTasks && counts && layout"
    data-testid="project-todo-panel"
  >
    <SidebarGroupLabel>
      {{ t("project.todos.heading") }}
      {{
        t("project.todos.progress", {
          completed: counts.completed,
          total: counts.total,
        })
      }}
    </SidebarGroupLabel>

    <SidebarGroupContent>
      <ProjectTodoGraph
        :tasks="layout.visible"
        :is-running="session.isRunning"
        @select="isListOpen = true"
      />
      <SidebarMenu v-if="layout.overflows">
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            data-testid="project-todo-overflow"
            class="text-muted-foreground"
            @click="showEverything = !showEverything"
          >
            <span>{{
              showEverything ? t("project.todos.showLess") : moreLabel
            }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <Button
        variant="outline"
        size="sm"
        class="mt-2 w-full"
        data-testid="project-todo-details"
        @click="isListOpen = true"
      >
        <ListTreeIcon data-icon="inline-start" />
        {{ t("project.todos.viewDetails") }}
      </Button>
    </SidebarGroupContent>
  </SidebarGroup>

  <ProjectTodoListDialog
    v-model:open="isListOpen"
    :todos="session.todos"
    :is-running="session.isRunning"
  />
</template>
