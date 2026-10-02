<script setup lang="ts">
import { CheckIcon, CircleStopIcon, CircleXIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";

const props = defineProps<{
  task: BackgroundTaskSnapshot;
}>();

const { t } = useI18n();
const backgroundTasks = useBackgroundTasksStore();
const label = computed(() =>
  t(`project.transcript.backgroundTask.${props.task.status}`, {
    name: props.task.name,
  }),
);
/** Tasks of the live session open their details; older ones are gone. */
const isInspectable = computed(() =>
  backgroundTasks.tasks.some((task) => task.id === props.task.id),
);
</script>

<template>
  <Marker
    :as="isInspectable ? 'button' : 'div'"
    :type="isInspectable ? 'button' : undefined"
    data-testid="project-background-task-marker"
    :data-status="task.status"
    :class="isInspectable && 'cursor-pointer text-left hover:text-foreground'"
    @click="isInspectable && backgroundTasks.inspect(task.id)"
  >
    <MarkerIcon>
      <Spinner v-if="task.status === 'running'" />
      <CheckIcon v-else-if="task.status === 'completed'" />
      <CircleStopIcon v-else-if="task.status === 'killed'" />
      <CircleXIcon v-else class="text-destructive" />
    </MarkerIcon>
    <MarkerContent :class="task.status === 'failed' && 'text-destructive'">
      {{ label }}
      <span v-if="task.error" class="text-muted-foreground">
        · {{ task.error }}
      </span>
    </MarkerContent>
  </Marker>
</template>
