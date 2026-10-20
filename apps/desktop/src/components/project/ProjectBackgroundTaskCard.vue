<script setup lang="ts">
import { storeToRefs } from "pinia";
import { Card } from "@/components/ui/card";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import ProjectBackgroundTaskSummary from "./ProjectBackgroundTaskSummary.vue";

/** The session's background processes, as wide as their longest row. */
const { visibleTasks: tasks } = storeToRefs(useBackgroundTasksStore());
</script>

<template>
  <Card
    v-if="tasks.length > 0"
    size="sm"
    data-testid="project-background-task-card"
    class="status-card w-fit max-w-full gap-0 p-(--status-card-inset) shadow-none"
  >
    <ProjectBackgroundTaskSummary />
  </Card>
</template>
