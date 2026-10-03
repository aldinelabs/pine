<script setup lang="ts">
import { ChevronDownIcon, FolderIcon, InboxIcon, PlusIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { isTemporaryWorkspace, type PineProject } from "@/shared/projects";
import { useProjectStore } from "@/stores/project";
import ProjectDialog from "./ProjectDialog.vue";

/**
 * "Send to {project}" for a draft: picks the project its first message
 * creates the session in. Choosing a project also moves the sidebars and
 * accent colour to it, since the draft tab now belongs there.
 */
const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ select: [projectId: string] }>();

const { t } = useI18n();
const projectStore = useProjectStore();
const { projects } = storeToRefs(projectStore);
const displayName = useProjectDisplayName();
const isCreateOpen = ref(false);
const selected = computed(() => projectStore.projectById(props.projectId));

async function select(projectId: unknown): Promise<void> {
  if (typeof projectId !== "string" || projectId === props.projectId) return;
  try {
    const result = await projectStore.ensureOpen(projectId);
    if (!result.opened) {
      toast.info(t("projects.openElsewhere"));
      return;
    }
    emit("select", projectId);
  } catch (error) {
    handleError(error, {
      id: `project.open.${projectId}`,
      title: t("errors.projectOpen.title"),
      description: t("errors.projectOpen.description"),
    });
  }
}

function openCreateDialog(): void {
  // Let the menu finish closing before the dialog takes focus.
  window.setTimeout(() => {
    isCreateOpen.value = true;
  });
}

function created(project: PineProject): void {
  void select(project.id);
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        data-slot="project-target-trigger"
        class="min-w-0"
        type="button"
        variant="ghost"
        size="sm"
        :title="t('project.composer.sendToLabel')"
      >
        <span class="truncate">
          {{ t("project.composer.sendTo", { name: displayName(selected) }) }}
        </span>
        <ChevronDownIcon data-icon="inline-end" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent side="top" align="end" class="w-72">
      <DropdownMenuLabel>
        {{ t("project.composer.sendToLabel") }}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        :model-value="props.projectId"
        @update:model-value="select"
      >
        <DropdownMenuRadioItem
          v-for="project in projects"
          :key="project.id"
          data-slot="project-target-option"
          :value="project.id"
        >
          <InboxIcon v-if="isTemporaryWorkspace(project.id)" />
          <FolderIcon v-else />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate">{{ displayName(project) }}</span>
            <span
              v-if="isTemporaryWorkspace(project.id)"
              class="truncate text-xs font-normal text-muted-foreground"
            >
              {{ t("projects.temporaryWorkspaceDescription") }}
            </span>
          </span>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem @select="openCreateDialog">
          <PlusIcon />
          {{ t("projects.createAction") }}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>

  <ProjectDialog v-model:open="isCreateOpen" @saved="created" />
</template>
