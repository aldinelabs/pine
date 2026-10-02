<script setup lang="ts">
import {
  FolderKanban,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { handleError } from "@/app/errors/errorHandler";
import { PineCharacter, PineLogo } from "@/components/pine";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import WindowTitleBar from "@/components/window/WindowTitleBar.vue";
import { ROUTE_NAMES } from "@/router/routes";
import type { PineProject } from "@/shared/projects";
import { PROJECT_LIST_WINDOW_SIZE } from "@/shared/window";
import { useProjectStore } from "@/stores/project";

const { t } = useI18n();
const router = useRouter();
const projectStore = useProjectStore();
const { isLoadingProjects, isOpeningProject, isSavingProject, projects } =
  storeToRefs(projectStore);
const isProjectDialogOpen = ref(false);
const isDeleteDialogOpen = ref(false);
const editingProject = ref<PineProject | null>(null);
const deletingProject = ref<PineProject | null>(null);
const openingProjectId = ref<string | null>(null);
const searchQuery = ref("");
const isMacOSPlatform = computed(() => window.pine?.platform === "darwin");
const isWindowsPlatform = computed(() => window.pine?.platform === "win32");
const isProjectOpening = computed(() => openingProjectId.value !== null);

const filteredProjects = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return projects.value;

  return projects.value.filter((project) =>
    project.name.toLocaleLowerCase().includes(query),
  );
});
const isSearching = computed(() => searchQuery.value.trim().length > 0);

async function openProject(project: PineProject): Promise<void> {
  if (isOpeningProject.value) return;

  openingProjectId.value = project.id;
  try {
    const result = await projectStore.openProject(project.id);
    if (!result.opened) return;

    await router.push({
      name: ROUTE_NAMES.project,
      params: { projectId: project.id },
    });
  } catch (error) {
    handleError(error, {
      id: `project.open.${project.id}`,
      title: t("errors.projectOpen.title"),
      description: t("errors.projectOpen.description"),
    });
  } finally {
    openingProjectId.value = null;
  }
}

function projectLocation(project: PineProject): string {
  return (
    project.folders.find((folder) => folder.id === project.defaultFolderId)
      ?.path ??
    project.folders[0]?.path ??
    ""
  );
}

function createProject(): void {
  editingProject.value = null;
  isProjectDialogOpen.value = true;
}

function editProject(project: PineProject): void {
  editingProject.value = project;
  isProjectDialogOpen.value = true;
}

function requestProjectDeletion(project: PineProject): void {
  deletingProject.value = project;
  isDeleteDialogOpen.value = true;
}

function deleteDialogOpenChanged(open: boolean): void {
  isDeleteDialogOpen.value = open;
  if (open) return;

  queueMicrotask(() => {
    if (!isDeleteDialogOpen.value && !isSavingProject.value) {
      deletingProject.value = null;
    }
  });
}

async function projectSaved(project: PineProject): Promise<void> {
  const wasCreating = editingProject.value === null;
  editingProject.value = null;
  if (wasCreating) await openProject(project);
}

async function deleteProject(): Promise<void> {
  const project = deletingProject.value;
  if (!project) return;

  isDeleteDialogOpen.value = false;
  try {
    await projectStore.deleteProject(project.id);
  } catch (error) {
    handleError(error, {
      id: `project.delete.${project.id}`,
      title: t("errors.projectDelete.title"),
      description: t("errors.projectDelete.description"),
    });
  } finally {
    deletingProject.value = null;
  }
}

onMounted(() => {
  void window.pine?.setWindowLayout?.("projects");
  projectStore.loadProjects().catch((error: unknown) => {
    handleError(error, {
      id: "project.list",
      title: t("errors.projectList.title"),
      description: t("errors.projectList.description"),
    });
  });
});
</script>

<template>
  <section
    class="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
    :aria-busy="isProjectOpening ? 'true' : undefined"
    :inert="isProjectOpening"
  >
    <!-- Sized to the list window rather than the viewport, so the window
         animating to or from a project never re-seeds the grid. -->
    <FlickeringGrid
      aria-hidden="true"
      class="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 [mask-image:radial-gradient(ellipse_at_center,white_0%,transparent_76%)]"
      :style="{
        opacity: 0.7,
        width: `${PROJECT_LIST_WINDOW_SIZE.width}px`,
        height: `${PROJECT_LIST_WINDOW_SIZE.height}px`,
      }"
      :width="PROJECT_LIST_WINDOW_SIZE.width"
      :height="PROJECT_LIST_WINDOW_SIZE.height"
      :flicker-chance="0.1"
      :grid-gap="6"
      color="oklch(0.56 0.09 107.3)"
      :max-opacity="0.42"
      :square-size="4"
    />

    <WindowTitleBar>
      <template #leading>
        <span
          v-if="isWindowsPlatform"
          data-slot="window-titlebar-logo-slot"
          class="window-titlebar-icon-slot"
        >
          <PineLogo
            data-testid="windows-titlebar-logo"
            aria-hidden="true"
            class="pointer-events-none size-4 fill-current text-foreground select-none"
          />
        </span>
        <PineLogo
          v-else-if="isMacOSPlatform"
          data-testid="macos-titlebar-logo"
          aria-hidden="true"
          class="pointer-events-none ml-2 size-5 shrink-0 fill-current text-muted-foreground select-none"
        />
        <InputGroup
          v-if="isWindowsPlatform"
          class="h-8 w-40 transition-[width] duration-200 focus-within:w-56"
        >
          <InputGroupInput
            v-model="searchQuery"
            data-testid="project-search"
            type="search"
            :disabled="isLoadingProjects || isProjectOpening"
            :aria-label="t('projects.searchLabel')"
            :placeholder="t('projects.searchPlaceholder')"
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
      </template>
      <template #trailing>
        <InputGroup
          v-if="!isWindowsPlatform"
          class="h-8 w-40 transition-[width] duration-200 focus-within:w-56"
        >
          <InputGroupInput
            v-model="searchQuery"
            data-testid="project-search"
            type="search"
            :disabled="isLoadingProjects || isProjectOpening"
            :aria-label="t('projects.searchLabel')"
            :placeholder="t('projects.searchPlaceholder')"
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
      </template>
    </WindowTitleBar>

    <div
      class="relative z-10 mx-auto flex h-0 min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden px-6 pb-10 [padding-top:calc(var(--window-titlebar-height)+2rem)]"
    >
      <div
        data-testid="project-list-container"
        class="mx-auto my-auto flex max-h-full min-h-0 w-full max-w-lg flex-col gap-6 overflow-hidden"
      >
        <header
          class="flex shrink-0 flex-col items-center gap-2 pt-2 text-center"
        >
          <PineCharacter decorative size="lg" />
          <h1 class="text-lg font-semibold">
            {{ t("projects.welcomeTitle") }}
          </h1>
        </header>

        <div class="flex min-h-0 flex-col gap-2.5 overflow-hidden">
          <ItemGroup v-if="!isSearching" class="shrink-0">
            <Item
              as="button"
              data-testid="create-project-card"
              type="button"
              variant="muted"
              size="sm"
              class="min-h-14 cursor-pointer text-left hover:bg-muted"
              :disabled="isProjectOpening"
              @click="createProject"
            >
              <ItemMedia variant="icon">
                <Plus />
              </ItemMedia>
              <ItemContent class="min-w-0">
                <ItemTitle>{{ t("projects.createAction") }}</ItemTitle>
              </ItemContent>
            </Item>
          </ItemGroup>

          <ItemGroup
            v-if="filteredProjects.length > 0"
            data-testid="project-list-scroll"
            class="scroll-fade min-h-0 overflow-y-auto pr-1"
          >
            <div
              v-for="project in filteredProjects"
              :key="project.id"
              role="listitem"
              class="relative shrink-0"
            >
              <Item
                as="button"
                data-testid="project-card"
                type="button"
                variant="outline"
                size="sm"
                class="min-h-16 cursor-pointer bg-background pr-14 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                :disabled="isProjectOpening"
                :aria-busy="
                  isProjectOpening && openingProjectId === project.id
                    ? 'true'
                    : undefined
                "
                @click="openProject(project)"
              >
                <ItemMedia variant="icon">
                  <Loader2
                    v-if="isProjectOpening && openingProjectId === project.id"
                    class="animate-spin"
                  />
                  <FolderKanban v-else />
                </ItemMedia>
                <ItemContent class="min-w-0">
                  <ItemTitle class="truncate">{{ project.name }}</ItemTitle>
                  <ItemDescription class="truncate">
                    {{ projectLocation(project) }}
                  </ItemDescription>
                </ItemContent>
              </Item>

              <ItemActions class="absolute right-3 top-1/2 -translate-y-1/2">
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :disabled="isProjectOpening"
                      :aria-label="
                        t('projects.projectActions', { name: project.name })
                      "
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem @select="editProject(project)">
                        <Pencil />
                        {{ t("common.edit") }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        @select="requestProjectDeletion(project)"
                      >
                        <Trash2 />
                        {{ t("common.delete") }}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </div>
          </ItemGroup>
        </div>
      </div>
    </div>

    <ProjectDialog
      v-model:open="isProjectDialogOpen"
      :project="editingProject"
      @saved="projectSaved"
    />

    <AlertDialog
      :open="isDeleteDialogOpen"
      @update:open="deleteDialogOpenChanged"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("projects.deleteTitle") }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("projects.deleteDescription", {
                name: deletingProject?.name ?? "",
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            :disabled="isSavingProject"
            @click="deleteProject"
          >
            {{ t("common.delete") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
