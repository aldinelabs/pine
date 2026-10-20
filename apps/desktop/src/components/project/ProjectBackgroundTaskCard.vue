<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import ProjectBackgroundTaskSummary from "./ProjectBackgroundTaskSummary.vue";
import ProjectStatusCard from "./ProjectStatusCard.vue";

/** The session's background processes, as wide as their longest row. */
const { visibleTasks: tasks } = storeToRefs(useBackgroundTasksStore());
</script>

<template>
  <ProjectStatusCard
    v-if="tasks.length > 0"
    data-testid="project-background-task-card"
  >
    <ProjectBackgroundTaskSummary />
  </ProjectStatusCard>
</template>
