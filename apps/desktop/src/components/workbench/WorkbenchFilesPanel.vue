<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed } from "vue";
import ProjectFileTree from "@/components/project/ProjectFileTree.vue";
import ProjectScope from "@/components/project/ProjectScope.vue";
import RetainedPanel from "@/components/project/RetainedPanel.vue";
import { useProjectStore } from "@/stores/project";

/**
 * The file tree of the conversation's project. Every project open in this
 * window keeps its tree mounted, so switching projects keeps each tree's
 * scroll position and expanded folders.
 */
const projectStore = useProjectStore();
const { currentProjectId, openProjectIds } = storeToRefs(projectStore);
const projectIds = computed(() =>
  [...openProjectIds.value].filter((id) => projectStore.projectById(id)),
);
</script>

<template>
  <div data-testid="workbench-files" class="relative h-full min-h-0">
    <RetainedPanel
      v-for="projectId in projectIds"
      :key="projectId"
      :active="projectId === currentProjectId"
    >
      <ProjectScope :project-id="projectId">
        <ProjectFileTree />
      </ProjectScope>
    </RetainedPanel>
  </div>
</template>
