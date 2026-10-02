<script setup lang="ts">
import { ChevronRightIcon, ListTreeIcon } from "@lucide/vue";
import { onKeyStroke } from "@vueuse/core";
import { computed, ref } from "vue";
import { I18nT, useI18n } from "vue-i18n";
import {
  DEFAULT_MAX_PANEL_LINES,
  selectHasActive,
  selectOverlayLayout,
  selectShowTaskIds,
  selectTodoCounts,
  type TaskState,
} from "@pine/rpiv-todo";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/session";
import ProjectTodoListDialog from "./ProjectTodoListDialog.vue";
import ProjectTodoRow from "./ProjectTodoRow.vue";

const { t } = useI18n();
const session = useSessionStore();
const isMac = computed(() => window.pine?.platform === "darwin");
const shortcutKeys = computed(() =>
  isMac.value ? ["⌘", "⇧", "T"] : ["Ctrl", "Shift", "T"],
);

const open = ref(true);
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
const hasActive = computed(
  () => panelState.value !== null && selectHasActive(panelState.value),
);
const showIds = computed(
  () => panelState.value !== null && selectShowTaskIds(panelState.value),
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

onKeyStroke(
  (event) =>
    event.key.toLowerCase() === "t" &&
    event.shiftKey &&
    (isMac.value ? event.metaKey : event.ctrlKey),
  (event) => {
    if (!hasTasks.value) return;
    event.preventDefault();
    open.value = !open.value;
  },
);
</script>

<template>
  <Collapsible
    v-if="hasTasks && counts && layout"
    v-model:open="open"
    class="group/collapsible min-h-0"
  >
    <SidebarGroup data-testid="project-todo-panel">
      <Tooltip>
        <TooltipTrigger as-child>
          <SidebarGroupLabel as-child>
            <CollapsibleTrigger
              class="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full pr-9 text-left"
            >
              <span
                aria-hidden="true"
                :class="[
                  'size-1.5 shrink-0 rounded-full',
                  hasActive
                    ? 'bg-primary'
                    : 'ring-muted-foreground ring-1 ring-inset',
                ]"
              />
              <span class="ml-2">{{ t("project.todos.heading") }}</span>
              <span class="text-muted-foreground ml-1.5 tabular-nums">
                {{
                  t("project.todos.progress", {
                    completed: counts.completed,
                    total: counts.total,
                  })
                }}
              </span>
              <ChevronRightIcon
                class="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90"
              />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
        </TooltipTrigger>
        <TooltipContent side="left">
          {{ t("project.todos.toggle") }}
          <KbdGroup>
            <Kbd v-for="key in shortcutKeys" :key="key">{{ key }}</Kbd>
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
      <SidebarGroupAction
        :title="t('project.todos.showAll')"
        @click="isListOpen = true"
      >
        <ListTreeIcon />
        <span class="sr-only">{{ t("project.todos.showAll") }}</span>
      </SidebarGroupAction>

      <p
        v-if="!open"
        data-testid="project-todo-expand-hint"
        class="text-muted-foreground flex items-center gap-1 px-3 text-xs"
      >
        <I18nT keypath="project.todos.expandHint" scope="global">
          <template #key>
            <KbdGroup>
              <Kbd v-for="key in shortcutKeys" :key="key">{{ key }}</Kbd>
            </KbdGroup>
          </template>
        </I18nT>
      </p>

      <CollapsibleContent>
        <SidebarGroupContent>
          <SidebarMenu>
            <ProjectTodoRow
              v-for="task in layout.visible"
              :key="task.id"
              :task="task"
              :show-id="showIds"
              :is-running="session.isRunning"
              @select="isListOpen = true"
            />
            <SidebarMenuItem v-if="layout.overflows">
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
        </SidebarGroupContent>
      </CollapsibleContent>
    </SidebarGroup>
  </Collapsible>

  <ProjectTodoListDialog
    v-model:open="isListOpen"
    :todos="session.todos"
    :is-running="session.isRunning"
  />
</template>
