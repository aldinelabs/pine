<script setup lang="ts">
import {
  CheckIcon,
  CheckCheckIcon,
  CircleStopIcon,
  CircleXIcon,
  RotateCcwIcon,
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
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import ProjectBackgroundTaskDialog from "./ProjectBackgroundTaskDialog.vue";

const { t } = useI18n();
const store = useBackgroundTasksStore();
const { tasks, runningCount, unseenFinishedIds, inspectedTaskId } =
  storeToRefs(store);

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

async function stopAll(): Promise<void> {
  try {
    const { stopped, failures } = await store.stopAll();
    if (failures.length > 0) {
      toast.error(
        t("project.backgroundTasks.stopAllFailed", { count: failures.length }),
        { description: failures.join("\n") },
      );
    } else if (stopped > 0) {
      toast.success(
        t("project.backgroundTasks.stoppedAll", { count: stopped }),
      );
    }
  } catch (error) {
    toast.error(t("project.backgroundTasks.stopFailed"), {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

async function rerun(task: BackgroundTaskSnapshot): Promise<void> {
  try {
    const started = await store.rerun(task.id);
    toast.success(
      t("project.backgroundTasks.rerunStarted", { name: started.name }),
    );
  } catch (error) {
    toast.error(t("project.backgroundTasks.rerunFailed"), {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
</script>

<template>
  <SidebarGroup data-testid="project-background-task-panel">
    <SidebarGroupLabel>
      {{ t("project.backgroundTasks.heading") }}
      <Tooltip v-if="unseenFinishedIds.size > 0">
        <TooltipTrigger as-child>
          <Button
            size="icon-sm"
            variant="ghost"
            class="ml-auto shrink-0"
            data-testid="project-background-task-mark-read"
            :aria-label="t('project.backgroundTasks.markAllRead')"
            @click="store.markAllFinishedSeen()"
          >
            <CheckCheckIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{{
          t("project.backgroundTasks.markAllRead")
        }}</TooltipContent>
      </Tooltip>
      <span
        v-if="runningCount > 0"
        class="ml-auto tabular-nums"
        :class="
          cn(runningCount > 1 && 'mr-6', unseenFinishedIds.size > 0 && 'ml-2')
        "
      >
        {{ t("project.backgroundTasks.running", { count: runningCount }) }}
      </span>
    </SidebarGroupLabel>
    <Tooltip v-if="runningCount > 1">
      <TooltipTrigger as-child>
        <SidebarGroupAction
          data-testid="project-background-task-stop-all"
          :aria-label="t('project.backgroundTasks.stopAll')"
          @click="stopAll"
        >
          <SquareIcon />
        </SidebarGroupAction>
      </TooltipTrigger>
      <TooltipContent side="left">
        {{ t("project.backgroundTasks.stopAll") }}
      </TooltipContent>
    </Tooltip>

    <SidebarGroupContent>
      <SidebarMenu
        v-if="tasks.length === 0"
        data-testid="project-background-task-placeholder"
      >
        <SidebarMenuItem>
          <SidebarMenuButton as="div" class="pointer-events-none">
            {{ t("project.backgroundTasks.empty") }}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <SidebarMenu v-else>
        <SidebarMenuItem
          v-for="task in tasks"
          :key="task.id"
          data-testid="project-background-task-row"
          :data-status="task.status"
        >
          <SidebarMenuButton
            class="h-auto min-h-9 py-2 pr-12"
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
            <span class="flex min-w-0 flex-col">
              <span
                :class="
                  cn(
                    'truncate',
                    task.status === 'failed' && 'text-destructive',
                    task.status !== 'running' &&
                      task.status !== 'failed' &&
                      'text-muted-foreground',
                  )
                "
              >
                {{ task.name }}
              </span>
              <span class="text-muted-foreground truncate text-xs tabular-nums">
                {{ t(`project.backgroundTasks.statuses.${task.status}`) }}
                · {{ runtime(task) }}
              </span>
            </span>
            <span
              v-if="unseenFinishedIds.has(task.id)"
              role="img"
              :aria-label="t('project.backgroundTasks.unread')"
              class="bg-primary ml-auto size-1.5 shrink-0 rounded-full"
            />
          </SidebarMenuButton>
          <SidebarMenuAction
            v-if="task.status === 'running'"
            show-on-hover
            :aria-label="t('project.backgroundTasks.stop')"
            :title="t('project.backgroundTasks.stop')"
            data-testid="project-background-task-stop"
            @click="stop(task)"
          >
            <SquareIcon />
          </SidebarMenuAction>
          <SidebarMenuAction
            v-else
            show-on-hover
            :aria-label="t('project.backgroundTasks.rerun')"
            :title="t('project.backgroundTasks.rerun')"
            data-testid="project-background-task-rerun"
            @click="rerun(task)"
          >
            <RotateCcwIcon />
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
