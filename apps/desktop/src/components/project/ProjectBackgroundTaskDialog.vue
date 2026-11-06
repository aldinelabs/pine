<script setup lang="ts">
import { CopyIcon, SquareIcon } from "@lucide/vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import { toast } from "vue-sonner";
import { formatDuration, formatSize } from "@pine/pi-background-tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";
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
const outputArea = ref<InstanceType<typeof DialogScrollArea> | null>(null);
const outputElement = computed(() => outputArea.value?.viewport);
// Following the tail stops while the user scrolls up to read earlier output.
const isFollowing = ref(true);
let outputRequest = 0;
const {
  now,
  pause: pauseClock,
  resume: resumeClock,
} = useNow({
  scheduler: (callback) => useIntervalFn(callback, 1000),
  controls: true,
});
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
    {
      key: "permissions",
      value: current.privileged
        ? t("project.backgroundTasks.native")
        : t("project.backgroundTasks.sandboxed"),
    },
    { key: "started", value: formatTime(current.startTime) },
    ...(current.endTime
      ? [{ key: "ended", value: formatTime(current.endTime) }]
      : []),
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
      :class="[
        'flex max-h-[85dvh] flex-col gap-4 overflow-hidden sm:max-w-2xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader class="shrink-0">
        <div class="flex min-w-0 items-center gap-2 pr-6">
          <DialogTitle class="min-w-0 truncate">
            {{ task?.name ?? t("project.backgroundTasks.heading") }}
          </DialogTitle>
          <Badge v-if="task" :variant="statusVariant" class="shrink-0">
            <Spinner v-if="isRunning" data-icon="inline-start" />
            {{ t(`project.backgroundTasks.statuses.${task.status}`) }}
          </Badge>
        </div>
        <DialogDescription :class="!task && 'sr-only'">
          <template v-if="task">
            {{ task.id }}
          </template>
          <template v-else>
            {{ t("project.backgroundTasks.dialog.gone") }}
          </template>
        </DialogDescription>
      </DialogHeader>

      <!-- Only the details shrink; the header and actions stay outside the scroller. -->
      <DialogScrollArea
        v-if="task"
        data-testid="project-background-task-details"
        class="flex-1"
        content-class="flex min-w-0 flex-col gap-4"
      >
        <dl class="grid shrink-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div
            v-for="detail in details"
            :key="detail.key"
            class="flex min-w-0 flex-col gap-1"
          >
            <dt class="text-muted-foreground text-xs">
              {{ t(`project.backgroundTasks.dialog.${detail.key}`) }}
            </dt>
            <dd class="text-sm tabular-nums wrap-break-word">
              {{ detail.value }}
            </dd>
          </div>
        </dl>

        <p
          v-if="task.error"
          role="alert"
          class="text-destructive shrink-0 text-sm wrap-break-word"
        >
          {{ task.error }}
        </p>

        <section class="flex shrink-0 flex-col gap-1">
          <h3 class="text-muted-foreground text-xs font-medium">
            {{ t("project.backgroundTasks.dialog.command") }}
          </h3>
          <DialogScrollArea
            edge-inset="0rem"
            class="rounded-lg bg-muted px-3 py-2"
            viewport-class="max-h-24"
          >
            <pre class="font-mono text-xs break-all whitespace-pre-wrap">{{
              task.command
            }}</pre>
          </DialogScrollArea>
        </section>

        <section class="flex shrink-0 flex-col gap-1">
          <h3
            class="text-muted-foreground flex items-center text-xs font-medium"
          >
            {{ t("project.backgroundTasks.dialog.output") }}
            <span v-if="outputSummary" class="ml-auto font-normal">
              {{ outputSummary }}
            </span>
          </h3>
          <DialogScrollArea
            ref="outputArea"
            edge-inset="0rem"
            class="h-64 shrink-0 rounded-lg bg-muted px-3 py-2"
            data-testid="project-background-task-output"
            @scroll="onOutputScroll"
          >
            <pre class="font-mono text-xs break-all whitespace-pre-wrap">{{
              outputError
                ? t("project.backgroundTasks.dialog.outputFailed")
                : output || t("project.backgroundTasks.dialog.noOutput")
            }}</pre>
          </DialogScrollArea>
          <p class="text-muted-foreground text-xs break-all">
            {{ task.outputPath }}
          </p>
        </section>
      </DialogScrollArea>

      <DialogFooter v-if="task" class="shrink-0">
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
