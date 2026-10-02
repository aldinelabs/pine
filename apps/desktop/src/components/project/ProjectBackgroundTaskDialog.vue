<script setup lang="ts">
import { CopyIcon, SquareIcon } from "@lucide/vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { formatDuration, formatSize } from "@pine/pi-background-tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";

const props = defineProps<{ taskId: string | null }>();
const open = defineModel<boolean>("open", { required: true });
const { t } = useI18n();
const store = useBackgroundTasksStore();
const { tasks } = storeToRefs(store);

const OUTPUT_REFRESH_MS = 1000;

const task = computed(
  () => tasks.value.find((candidate) => candidate.id === props.taskId) ?? null,
);
const isRunning = computed(() => task.value?.status === "running");

const output = ref("");
const outputSummary = ref("");
const outputError = ref(false);
const outputElement = ref<HTMLElement | null>(null);
// Following the tail stops while the user scrolls up to read earlier output.
const isFollowing = ref(true);
let outputRequest = 0;
const {
  now,
  pause: pauseClock,
  resume: resumeClock,
} = useNow({ interval: 1000, controls: true });
watch(
  [open, isRunning],
  ([isOpen, running]) => {
    if (isOpen && running) resumeClock();
    else pauseClock();
  },
  { immediate: true },
);

async function refreshOutput(): Promise<void> {
  const id = props.taskId;
  if (!id || !open.value) return;
  const request = ++outputRequest;
  try {
    const read = await store.readOutput(id);
    if (request !== outputRequest || id !== props.taskId || !open.value) return;
    output.value = read.content;
    outputSummary.value = read.truncated
      ? t("project.backgroundTasks.dialog.outputTail", {
          shown: formatSize(read.bytesRead),
          total: formatSize(read.totalBytes),
        })
      : "";
    outputError.value = false;
    if (isFollowing.value) {
      await nextTick();
      const element = outputElement.value;
      if (element) element.scrollTop = element.scrollHeight;
    }
  } catch {
    if (request !== outputRequest || id !== props.taskId || !open.value) return;
    outputError.value = true;
  }
}

function onOutputScroll(): void {
  const element = outputElement.value;
  if (!element) return;
  isFollowing.value =
    element.scrollHeight - element.scrollTop - element.clientHeight < 24;
}

const { pause, resume } = useIntervalFn(
  () => void refreshOutput(),
  OUTPUT_REFRESH_MS,
  {
    immediate: false,
  },
);
watch(
  [() => props.taskId, open, isRunning],
  ([id, isOpen, running]) => {
    if (id && isOpen) {
      void refreshOutput();
      if (running) resume();
      else pause();
    } else {
      outputRequest += 1;
      pause();
    }
  },
  { immediate: true },
);
// A finished task's last output arrives after its status flips.
watch(
  () => task.value?.bytesWritten,
  () => {
    if (open.value && !isRunning.value) void refreshOutput();
  },
);
watch(
  () => props.taskId,
  () => {
    output.value = "";
    outputSummary.value = "";
    outputError.value = false;
    isFollowing.value = true;
  },
);
onBeforeUnmount(pause);

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

const duration = computed(() =>
  task.value
    ? formatDuration(
        (task.value.endTime ?? now.value.getTime()) - task.value.startTime,
      )
    : "",
);

const details = computed(() => {
  const current = task.value;
  if (!current) return [];
  return [
    { key: "duration", value: duration.value },
    { key: "started", value: formatTime(current.startTime) },
    ...(current.endTime
      ? [{ key: "ended", value: formatTime(current.endTime) }]
      : []),
    {
      key: "permissions",
      value: current.privileged
        ? t("project.backgroundTasks.native")
        : t("project.backgroundTasks.sandboxed"),
    },
    ...(current.timeoutSeconds
      ? [
          {
            key: "timeout",
            value: t("project.backgroundTasks.dialog.timeoutValue", {
              seconds: current.timeoutSeconds,
            }),
          },
        ]
      : []),
    ...(typeof current.exitCode === "number"
      ? [{ key: "exitCode", value: String(current.exitCode) }]
      : []),
  ];
});

const statusVariant = computed(() => {
  switch (task.value?.status) {
    case "failed":
      return "destructive" as const;
    case "running":
      return "default" as const;
    default:
      return "secondary" as const;
  }
});

async function copyPath(): Promise<void> {
  if (!task.value) return;
  try {
    await navigator.clipboard.writeText(task.value.outputPath);
    toast.success(t("project.backgroundTasks.dialog.pathCopied"));
  } catch {
    toast.error(t("project.backgroundTasks.dialog.copyFailed"));
  }
}

async function stop(): Promise<void> {
  if (!task.value) return;
  try {
    await store.stop(task.value.id);
  } catch (error) {
    toast.error(t("project.backgroundTasks.stopFailed"), {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-testid="project-background-task-dialog"
      class="max-h-[85vh] gap-4 overflow-hidden sm:max-w-2xl"
    >
      <DialogHeader>
        <DialogTitle class="truncate">
          {{ task?.name ?? t("project.backgroundTasks.heading") }}
        </DialogTitle>
        <DialogDescription :class="!task && 'sr-only'">
          <template v-if="task">
            {{ task.id }}
          </template>
          <template v-else>
            {{ t("project.backgroundTasks.dialog.gone") }}
          </template>
        </DialogDescription>
      </DialogHeader>

      <div v-if="task" class="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <div class="flex flex-wrap items-center gap-2">
          <Badge :variant="statusVariant">
            <Spinner v-if="isRunning" data-icon="inline-start" />
            {{ t(`project.backgroundTasks.statuses.${task.status}`) }}
          </Badge>
          <span
            v-for="detail in details"
            :key="detail.key"
            class="text-muted-foreground inline-flex gap-1 text-xs"
          >
            <span>{{ t(`project.backgroundTasks.dialog.${detail.key}`) }}</span>
            <span class="text-foreground tabular-nums">
              {{ detail.value }}
            </span>
          </span>
        </div>

        <p
          v-if="task.error"
          role="alert"
          class="text-destructive text-sm wrap-break-word"
        >
          {{ task.error }}
        </p>

        <section class="flex flex-col gap-1">
          <h3 class="text-muted-foreground text-xs font-medium">
            {{ t("project.backgroundTasks.dialog.command") }}
          </h3>
          <pre
            class="bg-muted max-h-24 overflow-auto rounded-lg px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
            >{{ task.command }}</pre>
        </section>

        <section class="flex min-h-0 flex-col gap-1">
          <h3
            class="text-muted-foreground flex items-center text-xs font-medium"
          >
            {{ t("project.backgroundTasks.dialog.output") }}
            <span v-if="outputSummary" class="ml-auto font-normal">
              {{ outputSummary }}
            </span>
          </h3>
          <pre
            ref="outputElement"
            data-testid="project-background-task-output"
            class="bg-muted h-64 overflow-auto rounded-lg px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
            @scroll="onOutputScroll"
            >{{
              outputError
                ? t("project.backgroundTasks.dialog.outputFailed")
                : output || t("project.backgroundTasks.dialog.noOutput")
            }}</pre>
          <p class="text-muted-foreground text-xs break-all">
            {{ task.outputPath }}
          </p>
        </section>
      </div>

      <DialogFooter v-if="task">
        <Button variant="outline" @click="copyPath">
          <CopyIcon data-icon="inline-start" />
          {{ t("project.backgroundTasks.dialog.copyPath") }}
        </Button>
        <Button v-if="isRunning" variant="outline" @click="stop">
          <SquareIcon data-icon="inline-start" />
          {{ t("project.backgroundTasks.stop") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
