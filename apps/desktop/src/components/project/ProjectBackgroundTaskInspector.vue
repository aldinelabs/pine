<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import ProjectBackgroundTaskDialog from "./ProjectBackgroundTaskDialog.vue";

/**
 * The one details dialog for the process being inspected. Rows in the
 * transcript card and the workbench panel only set what is inspected, so
 * each opens this same dialog once.
 */
const store = useBackgroundTasksStore();
const { inspectedTaskId } = storeToRefs(store);

const isOpen = computed({
  get: () => inspectedTaskId.value !== null,
  set: (open) => {
    if (!open) store.inspect(null);
  },
});
</script>

<template>
  <ProjectBackgroundTaskDialog
    v-model:open="isOpen"
    :task-id="inspectedTaskId"
  />
</template>
