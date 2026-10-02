<script setup lang="ts">
import {
  CheckIcon,
  CircleStopIcon,
  CircleXIcon,
  SquareIcon,
} from "@lucide/vue";
import { useNow } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  formatDuration,
  type BackgroundTaskSnapshot,
} from "@pine/pi-background-tasks";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import ProjectBackgroundTaskDialog from "./ProjectBackgroundTaskDialog.vue";
import ProjectSidebarEmptyState from "./ProjectSidebarEmptyState.vue";

const { t } = useI18n();
const store = useBackgroundTasksStore();
const { tasks, runningCount, inspectedTaskId } = storeToRefs(store);

// Running tasks show their elapsed time, so the panel ticks only while one runs.
const { now, pause, resume } = useNow({ interval: 1000, controls: true });
watch(
  runningCount,
  (count) => {
    if (count > 0) resume();
    else pause();
  },
  { immediate: true },
);

function runtime(task: BackgroundTaskSnapshot): string {
  return formatDuration((task.endTime ?? now.value.getTime()) - task.startTime);
}

const isDialogOpen = computed({
  get: () => inspectedTaskId.value !== null,
  set: (open) => {
    if (!open) store.inspect(null);
  },
});

async function stop(task: BackgroundTaskSnapshot): Promise<void> {
  try {
    await store.stop(task.id);
    toast.success(t("project.backgroundTasks.stopped", { name: task.name }));
  } catch (error) {
    toast.error(t("project.backgroundTasks.stopFailed"), {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
</script>

<template>
  <SidebarGroup
    data-testid="project-background-task-panel"
    :class="{ 'h-full min-h-0': tasks.length === 0 }"
  >
    <SidebarGroupLabel>
      {{ t("project.backgroundTasks.heading") }}
      <span v-if="runningCount > 0" class="ml-auto tabular-nums">
        {{ t("project.backgroundTasks.running", { count: runningCount }) }}
      </span>
    </SidebarGroupLabel>
    <SidebarGroupContent
      :class="{ 'flex min-h-0 flex-1 flex-col': tasks.length === 0 }"
    >
      <ProjectSidebarEmptyState
        v-if="tasks.length === 0"
        kind="processes"
        :label="t('project.backgroundTasks.empty')"
        data-testid="project-background-task-placeholder"
      />

      <SidebarMenu v-else>
        <SidebarMenuItem
          v-for="task in tasks"
          :key="task.id"
          data-testid="project-background-task-row"
          :data-status="task.status"
        >
          <SidebarMenuButton
            class="group-has-data-[sidebar=menu-action]/menu-item:pr-3"
            :aria-label="`${task.name}: ${t(`project.backgroundTasks.statuses.${task.status}`)}`"
            @click="store.inspect(task.id)"
          >
            <Spinner v-if="task.status === 'running'" class="text-primary" />
            <CheckIcon
              v-else-if="task.status === 'completed'"
              class="text-muted-foreground"
            />
            <CircleStopIcon
              v-else-if="task.status === 'killed'"
              class="text-muted-foreground"
            />
            <CircleXIcon v-else class="text-destructive" />
            <span class="min-w-0 flex-1 truncate text-sm">{{ task.name }}</span>
            <span
              class="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums"
              :class="{
                'group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0':
                  task.status === 'running',
              }"
            >
              {{ runtime(task) }}
            </span>
          </SidebarMenuButton>
          <SidebarMenuAction
            v-if="task.status === 'running'"
            class="right-3 opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100"
            :aria-label="t('project.backgroundTasks.stop')"
            :title="t('project.backgroundTasks.stop')"
            data-testid="project-background-task-stop"
            @click="stop(task)"
          >
            <SquareIcon />
          </SidebarMenuAction>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>

  <ProjectBackgroundTaskDialog
    v-model:open="isDialogOpen"
    :task-id="inspectedTaskId"
  />
</template>
