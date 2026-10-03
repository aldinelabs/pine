<script setup lang="ts">
import { ref } from "vue";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PineProject, ProjectMutationInput } from "@/shared/projects";
import { useProjectStore } from "@/stores/project";
import ProjectEditor from "./ProjectEditor.vue";

interface Props {
  project?: PineProject | null;
}

const props = withDefaults(defineProps<Props>(), { project: null });
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{
  deleted: [projectId: string];
  saved: [project: PineProject];
}>();
const isDeleteConfirmOpen = ref(false);
const { t } = useI18n();
const projectStore = useProjectStore();

async function save(input: ProjectMutationInput): Promise<void> {
  try {
    const project = props.project
      ? await projectStore.updateProject({ id: props.project.id, ...input })
      : await projectStore.createProject(input);
    emit("saved", project);
    open.value = false;
  } catch (error) {
    handleError(error, {
      id: props.project ? "project.update" : "project.create",
      title: t(
        props.project
          ? "errors.projectUpdate.title"
          : "errors.projectCreate.title",
      ),
      description: t(
        props.project
          ? "errors.projectUpdate.description"
          : "errors.projectCreate.description",
      ),
    });
  }
}
/** Deleting closes the project's tabs and removes only Pine's own data. */
async function deleteProject(): Promise<void> {
  const project = props.project;
  if (!project) return;
  isDeleteConfirmOpen.value = false;
  try {
    await projectStore.deleteProject(project.id);
    open.value = false;
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
  <Dialog v-model:open="open">
    <DialogContent
      class="max-h-[min(85vh,44rem)] gap-0 overflow-hidden p-0 sm:max-w-lg"
    >
      <DialogHeader class="px-6 pt-6 pb-4 pr-16">
        <DialogTitle>
          {{ project ? t("projects.editTitle") : t("projects.createTitle") }}
        </DialogTitle>
        <DialogDescription>
          {{ t("projects.editor.dialogDescription") }}
        </DialogDescription>
      </DialogHeader>
      <ProjectEditor
        :key="project?.updatedAt ?? String(open)"
        :project="project"
        :is-saving="projectStore.isSavingProject"
        @cancel="open = false"
        @delete="isDeleteConfirmOpen = true"
        @submit="save"
      />
    </DialogContent>
  </Dialog>

  <AlertDialog v-model:open="isDeleteConfirmOpen">
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
