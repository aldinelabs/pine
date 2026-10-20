<script setup lang="ts">
import {
  CheckIcon,
  CircleStopIcon,
  CircleXIcon,
  SquareIcon,
} from "@lucide/vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  formatDuration,
  type BackgroundTaskSnapshot,
} from "@pine/pi-background-tasks";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";

/**
 * The background-process half of the status card. Each row opens the
 * process's details (see `ProjectBackgroundTaskInspector`); a running one can
 * be stopped from its row.
 */
const { t } = useI18n();
const store = useBackgroundTasksStore();
const { visibleTasks: tasks, runningCount } = storeToRefs(store);

/** Running processes first, then the most recently finished. */
const ordered = computed(() => {
  const running = tasks.value.filter((task) => task.status === "running");
  const finished = tasks.value
    .filter((task) => task.status !== "running")
    .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
  return [...running, ...finished];
});

// Running processes show their elapsed time, so the rows tick only while one
// runs.
const { now, pause, resume } = useNow({
  scheduler: (callback) => useIntervalFn(callback, 1000),
  controls: true,
});
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
  <div
    data-testid="project-background-task-summary"
    class="min-w-0 p-(--status-card-inset)"
  >
    <ul
      class="scroll-fade-y no-scrollbar flex max-h-(--status-card-list-height) flex-col overflow-y-auto overscroll-contain"
    >
      <li
        v-for="task in ordered"
        :key="task.id"
        data-testid="project-background-task-row"
        :data-status="task.status"
        class="group/task relative"
      >
        <button
          type="button"
          class="flex h-6 w-full min-w-0 items-center gap-2 rounded-full px-1.5 text-left transition-colors duration-500 ease-out-expo outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/30"
          :aria-label="`${task.name}: ${t(`project.backgroundTasks.statuses.${task.status}`)}`"
          @click="store.inspect(task.id)"
        >
          <Spinner
            v-if="task.status === 'running'"
            aria-hidden="true"
            class="text-primary size-4 shrink-0"
          />
          <CheckIcon
            v-else-if="task.status === 'completed'"
            aria-hidden="true"
            class="text-muted-foreground size-4 shrink-0"
          />
          <CircleStopIcon
            v-else-if="task.status === 'killed'"
            aria-hidden="true"
            class="text-muted-foreground size-4 shrink-0"
          />
          <CircleXIcon
            v-else
            aria-hidden="true"
            class="text-destructive size-4 shrink-0"
          />
          <span class="min-w-0 flex-1 truncate">{{ task.name }}</span>
          <span
            class="text-muted-foreground shrink-0 text-xs tabular-nums transition-opacity duration-500 ease-out-expo"
            :class="{
              'group-hover/task:opacity-0 group-focus-within/task:opacity-0':
                task.status === 'running',
            }"
          >
            {{ runtime(task) }}
          </span>
        </button>
        <Button
          v-if="task.status === 'running'"
          type="button"
          variant="ghost"
          size="icon-xs"
          class="absolute top-0 right-0 rounded-full opacity-0 group-hover/task:opacity-100 group-focus-within/task:opacity-100"
          :aria-label="t('project.backgroundTasks.stop')"
          :title="t('project.backgroundTasks.stop')"
          data-testid="project-background-task-stop"
          @click="stop(task)"
        >
          <SquareIcon />
        </Button>
      </li>
    </ul>
  </div>
</template>
