<script setup lang="ts">
import { ChevronDownIcon, PlusIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { InputGroupButton } from "@/components/ui/input-group";
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
import { useDraftProjectOpener } from "@/composables/useDraftProjectOpener";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { projectIconComponent } from "@/lib/projectIcons";
import { isTemporaryWorkspace, type PineProject } from "@/shared/projects";
import { useProjectStore } from "@/stores/project";
import ProjectDialog from "./ProjectDialog.vue";

/**
 * "Send to {project}" for a draft: picks the project its first message
 * creates the session in. Choosing a project also moves the sidebars and
 * accent colour to it, since the draft tab now belongs there.
 */
const props = defineProps<{
  projectId: string;
  /** Pairs the trigger with the composer's chooser chip while it moves here. */
  transitionName?: string;
}>();
const emit = defineEmits<{ select: [projectId: string] }>();

const { t } = useI18n();
const projectStore = useProjectStore();
const { projects } = storeToRefs(projectStore);
const displayName = useProjectDisplayName();
const isCreateOpen = ref(false);
const openForDraft = useDraftProjectOpener();
const selected = computed(() => projectStore.projectById(props.projectId));

async function select(projectId: unknown): Promise<void> {
  if (typeof projectId !== "string" || projectId === props.projectId) return;
  if (await openForDraft(projectId)) emit("select", projectId);
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
      <InputGroupButton
        data-slot="project-target-trigger"
        class="min-w-0 text-muted-foreground"
        :style="
          props.transitionName
            ? { viewTransitionName: props.transitionName }
            : undefined
        "
        size="sm"
        :aria-label="
          t('project.composer.sendTo', { name: displayName(selected) })
        "
        :title="t('project.composer.sendToLabel')"
      >
        <component
          :is="projectIconComponent(selected)"
          data-icon="inline-start"
        />
        <span class="truncate">{{ displayName(selected) }}</span>
        <ChevronDownIcon data-icon="inline-end" />
      </InputGroupButton>
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
          <component :is="projectIconComponent(project)" />
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
