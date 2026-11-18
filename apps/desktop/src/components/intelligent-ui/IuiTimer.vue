<script setup lang="ts">
import { PauseIcon, PlayIcon, RotateCcwIcon } from "@lucide/vue";
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Timer">>>();
const { t } = useI18n();
const isStreaming = useIsStreaming();
const bound = useBoundValue<number | null>(() => props.props.seconds);

const left = computed(() => Math.max(0, Math.round(Number(bound.value) || 0)));
/** Reset goes back to the time the block started with. */
const initial = ref<number>();
watch(
  [left, isStreaming],
  ([value, streaming]) => {
    if (!streaming && initial.value === undefined && value > 0)
      initial.value = value;
  },
  { immediate: true },
);

const running = ref(false);
let interval: ReturnType<typeof setInterval> | undefined;
function stop(): void {
  running.value = false;
  if (interval !== undefined) clearInterval(interval);
  interval = undefined;
}
function start(): void {
  if (left.value <= 0) return;
  running.value = true;
  interval = setInterval(() => {
    const next = left.value - 1;
    bound.value = Math.max(0, next);
    if (next <= 0) stop();
  }, 1000);
}
function reset(): void {
  stop();
  if (initial.value !== undefined) bound.value = initial.value;
}
onBeforeUnmount(stop);

const clock = computed(() => {
  const total = left.value;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
});
</script>

<template>
  <div
    data-iui="timer"
    role="timer"
    :aria-label="props.props.label"
    class="flex min-w-0 items-center gap-3"
  >
    <div class="flex min-w-0 flex-col">
      <span v-if="props.props.label" class="text-sm text-muted-foreground">
        {{ props.props.label }}
      </span>
      <span
        class="text-2xl font-semibold tracking-tight tabular-nums"
        :class="left === 0 && 'text-muted-foreground'"
      >
        {{ clock }}
      </span>
    </div>
    <div class="ml-auto flex gap-1.5">
      <Button
        v-if="running"
        type="button"
        size="icon"
        variant="outline"
        class="rounded-full"
        :aria-label="t('intelligentUi.timer.pause')"
        :title="t('intelligentUi.timer.pause')"
        @click="stop"
      >
        <PauseIcon />
      </Button>
      <Button
        v-else
        type="button"
        size="icon"
        class="rounded-full"
        :aria-label="t('intelligentUi.timer.start')"
        :title="t('intelligentUi.timer.start')"
        :disabled="isStreaming || left === 0"
        @click="start"
      >
        <PlayIcon />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        class="rounded-full"
        :aria-label="t('intelligentUi.timer.reset')"
        :title="t('intelligentUi.timer.reset')"
        :disabled="isStreaming || initial === undefined || left === initial"
        @click="reset"
      >
        <RotateCcwIcon />
      </Button>
    </div>
  </div>
</template>
