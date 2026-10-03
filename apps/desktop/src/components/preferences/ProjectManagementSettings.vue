<script setup lang="ts">
import {
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
import ProjectDialog from "@/components/project/ProjectDialog.vue";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldDescription } from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { formatBytes } from "@/lib/formatBytes";
import { projectIconComponent } from "@/lib/projectIcons";
import {
  isTemporaryWorkspace,
  type ClearableProjectStorage,
  type PineProject,
  type ProjectStorageUsage,
} from "@/shared/projects";
import { useProjectStore } from "@/stores/project";

/**
 * Every project in one list, with the data Pine keeps for each outside its
 * folders. Temporary files and pasted attachments can be cleared; history,
 * settings, and the user's folders are never touched here.
 */
const { locale, t } = useI18n();
const projectStore = useProjectStore();
const { projects } = storeToRefs(projectStore);
const displayName = useProjectDisplayName();
const usage = ref<ReadonlyMap<string, ProjectStorageUsage>>(new Map());
const isMeasuring = ref(false);
const clearing = ref<string | null>(null);
const isProjectDialogOpen = ref(false);
const editingProject = ref<PineProject | null>(null);
// The target outlives the dialog: confirming closes it before the action's
// click handler runs.
const pendingAttachmentClear = ref<PineProject | null>(null);
const isAttachmentConfirmOpen = ref(false);

function size(bytes: number | undefined): string {
  return formatBytes(bytes ?? 0, locale.value);
}

function defaultFolderPath(project: PineProject): string {
  return (
    project.folders.find((folder) => folder.id === project.defaultFolderId)
      ?.path ?? ""
  );
}

async function measure(): Promise<void> {
  isMeasuring.value = true;
  try {
    const result = await window.pine.getProjectStorage();
    usage.value = new Map(
      result.usage.map((entry) => [entry.projectId, entry]),
    );
  } catch (error) {
    handleError(error, {
      id: "project-storage.load",
      title: t("preferences.projectManagement.loadFailed"),
    });
  } finally {
    isMeasuring.value = false;
  }
}

async function clear(
  project: PineProject,
  kind: ClearableProjectStorage,
): Promise<void> {
  if (clearing.value) return;
  clearing.value = project.id;
  const before = usage.value.get(project.id)?.total ?? 0;
  try {
    const next = await window.pine.clearProjectStorage({
      id: project.id,
      kind,
    });
    usage.value = new Map(usage.value).set(project.id, next);
    toast.success(
      t("preferences.projectManagement.cleared", {
        size: size(Math.max(0, before - next.total)),
      }),
    );
  } catch (error) {
    handleError(error, {
      id: `project-storage.clear.${project.id}`,
      title: t("preferences.projectManagement.clearFailed"),
      description: error instanceof Error ? error.message : undefined,
    });
  } finally {
    clearing.value = null;
  }
}

function requestAttachmentClear(project: PineProject): void {
  pendingAttachmentClear.value = project;
  isAttachmentConfirmOpen.value = true;
}

function confirmAttachmentClear(): void {
  const project = pendingAttachmentClear.value;
  isAttachmentConfirmOpen.value = false;
  if (project) void clear(project, "attachments");
}

function openProjectDialog(project: PineProject | null): void {
  // Let the menu close before the dialog takes focus.
  window.setTimeout(() => {
    editingProject.value = project;
    isProjectDialogOpen.value = true;
  });
}

onMounted(() => {
  void projectStore.loadProjects().catch(() => undefined);
  void measure();
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4">
      <FieldDescription>
        {{ t("preferences.projectManagement.description") }}
      </FieldDescription>
      <Button
        data-testid="project-management-create"
        size="sm"
        variant="outline"
        @click="openProjectDialog(null)"
      >
        <PlusIcon data-icon="inline-start" />
        {{ t("preferences.projectManagement.create") }}
      </Button>
    </div>

    <ItemGroup class="gap-2">
      <Item
        v-for="project in projects"
        :key="project.id"
        data-slot="project-management-row"
        variant="outline"
        size="sm"
      >
        <ItemMedia variant="icon">
          <component :is="projectIconComponent(project)" />
        </ItemMedia>
        <ItemContent class="min-w-0">
          <ItemTitle class="w-full">
            <span class="truncate">{{ displayName(project) }}</span>
          </ItemTitle>
          <ItemDescription class="truncate">
            {{
              isTemporaryWorkspace(project.id)
                ? t("projects.temporaryWorkspaceDescription")
                : defaultFolderPath(project)
            }}
          </ItemDescription>
          <p
            v-if="usage.get(project.id)"
            data-slot="project-storage-breakdown"
            class="flex flex-wrap gap-x-3 text-xs text-muted-foreground"
          >
            <span>
              {{
                t("preferences.projectManagement.sessions", {
                  size: size(usage.get(project.id)?.sessions),
                })
              }}
            </span>
            <span>
              {{
                t("preferences.projectManagement.temporary", {
                  size: size(usage.get(project.id)?.temporary),
                })
              }}
            </span>
            <span>
              {{
                t("preferences.projectManagement.attachments", {
                  size: size(usage.get(project.id)?.attachments),
                })
              }}
            </span>
            <span>
              {{
                t("preferences.projectManagement.cache", {
                  size: size(usage.get(project.id)?.cache),
                })
              }}
            </span>
          </p>
          <p
            v-else-if="isMeasuring"
            class="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Spinner class="size-3" />
            {{ t("preferences.projectManagement.loading") }}
          </p>
        </ItemContent>
        <ItemActions>
          <Spinner
            v-if="clearing === project.id"
            class="text-muted-foreground"
          />
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="
                  t('preferences.projectManagement.actions', {
                    name: displayName(project),
                  })
                "
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  data-action="clear-temporary"
                  :disabled="clearing !== null"
                  @select="clear(project, 'temporary')"
                >
                  <Trash2Icon />
                  {{ t("preferences.projectManagement.clearTemporary") }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-action="clear-attachments"
                  :disabled="clearing !== null"
                  @select="requestAttachmentClear(project)"
                >
                  <Trash2Icon />
                  {{ t("preferences.projectManagement.clearAttachments") }}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <template v-if="!isTemporaryWorkspace(project.id)">
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-action="edit-project"
                  @select="openProjectDialog(project)"
                >
                  <PencilIcon />
                  {{ t("preferences.projectManagement.edit") }}
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>
      </Item>
    </ItemGroup>

    <ProjectDialog
      v-model:open="isProjectDialogOpen"
      :project="editingProject"
      @saved="measure"
      @deleted="measure"
    />

    <AlertDialog v-model:open="isAttachmentConfirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{
              t("preferences.projectManagement.clearAttachmentsTitle", {
                name: displayName(pendingAttachmentClear),
              })
            }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("preferences.projectManagement.clearAttachmentsDescription", {
                size: size(
                  pendingAttachmentClear
                    ? usage.get(pendingAttachmentClear.id)?.attachments
                    : 0,
                ),
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction
            data-action="confirm-clear-attachments"
            variant="destructive"
            @click="confirmAttachmentClear"
          >
            {{ t("preferences.projectManagement.clearAttachmentsAction") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
