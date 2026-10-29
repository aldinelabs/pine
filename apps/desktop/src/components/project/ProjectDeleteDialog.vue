<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PineProject } from "@/shared/projects";
import { useProjectStore } from "@/stores/project";

const props = defineProps<{ project: PineProject | null }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ deleted: [projectId: string] }>();
const { t } = useI18n();
const projectStore = useProjectStore();

/** Deleting closes the project's tabs and removes only Pine's own data. */
async function deleteProject(): Promise<void> {
  const project = props.project;
  open.value = false;
  if (!project) return;
  try {
    await projectStore.deleteProject(project.id);
    emit("deleted", project.id);
  } catch (error) {
    handleError(error, {
      id: `project.delete.${project.id}`,
      title: t("errors.projectDelete.title"),
      description: t("errors.projectDelete.description"),
    });
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("projects.deleteTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("projects.deleteDescription", { name: project?.name ?? "" }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <AlertDialogAction
          data-action="confirm-delete-project"
          variant="destructive"
          :disabled="projectStore.isSavingProject"
          @click="deleteProject"
        >
          {{ t("common.delete") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
