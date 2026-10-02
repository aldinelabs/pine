import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import type {
  CreateProjectRequest,
  OpenProjectResult,
  PineProject,
  PineSessionGroup,
  UpdateProjectRequest,
} from "@/shared/projects";
import { useContentTabsStore } from "./contentTabs";
import { useBackgroundTasksStore } from "./backgroundTasks";
import { useSessionStore } from "./session";

export const useProjectStore = defineStore("project", () => {
  const contentTabsStore = useContentTabsStore();
  const sessionStore = useSessionStore();
  const backgroundTasksStore = useBackgroundTasksStore();
  const projects = shallowRef<PineProject[]>([]);
  const activeProject = shallowRef<PineProject | null>(null);
  const isLoadingProjects = ref(false);
  const isOpeningProject = ref(false);
  const isSavingProject = ref(false);

  function upsertProject(project: PineProject): void {
    projects.value = [
      project,
      ...projects.value.filter((candidate) => candidate.id !== project.id),
    ].sort((left, right) => {
      const leftTime = Date.parse(left.lastOpenedAt ?? left.updatedAt);
      const rightTime = Date.parse(right.lastOpenedAt ?? right.updatedAt);
      return rightTime - leftTime;
    });
  }

  async function loadProjects(): Promise<void> {
    if (isLoadingProjects.value) return;
    isLoadingProjects.value = true;
    try {
      projects.value = (await window.pine.listProjects()).projects;
    } finally {
      isLoadingProjects.value = false;
    }
  }

  async function createProject(
    request: CreateProjectRequest,
  ): Promise<PineProject> {
    isSavingProject.value = true;
    try {
      const project = (await window.pine.createProject(request)).project;
      upsertProject(project);
      return project;
    } finally {
      isSavingProject.value = false;
    }
  }

  async function openProject(id: string): Promise<OpenProjectResult> {
    if (isOpeningProject.value) {
      throw new Error("Another project is already opening.");
    }
    isOpeningProject.value = true;
    try {
      const result = await window.pine.openProject({ id });
      if (!result.opened) return result;

      const { project } = result;
      sessionStore.reset();
      backgroundTasksStore.reset();
      contentTabsStore.restore(project.id);
      activeProject.value = project;
      return result;
    } finally {
      isOpeningProject.value = false;
    }
  }

  async function updateProject(
    request: UpdateProjectRequest,
  ): Promise<PineProject> {
    isSavingProject.value = true;
    try {
      const project = (await window.pine.updateProject(request)).project;
      upsertProject(project);
      if (activeProject.value?.id === project.id) {
        activeProject.value = project;
        sessionStore.reset();
        backgroundTasksStore.reset();
        contentTabsStore.restore(project.id);
      }
      return project;
    } finally {
      isSavingProject.value = false;
    }
  }

  async function updateSessionGroups(
    sessionGroups: PineSessionGroup[],
  ): Promise<PineProject> {
    const project = activeProject.value;
    if (!project) throw new Error("No project is open.");

    isSavingProject.value = true;
    try {
      const updated = (
        await window.pine.updateProjectSessionGroups({
          id: project.id,
          sessionGroups,
        })
      ).project;
      upsertProject(updated);
      if (activeProject.value?.id === updated.id) {
        activeProject.value = updated;
      }
      return updated;
    } finally {
      isSavingProject.value = false;
    }
  }

  async function deleteProject(id: string): Promise<void> {
    isSavingProject.value = true;
    try {
      await window.pine.deleteProject({ id });
      projects.value = projects.value.filter((project) => project.id !== id);
      if (activeProject.value?.id === id) {
        activeProject.value = null;
        sessionStore.reset();
        backgroundTasksStore.reset();
        contentTabsStore.reset();
      }
    } finally {
      isSavingProject.value = false;
    }
  }

  async function closeProject(): Promise<void> {
    await window.pine.closeProject();
    activeProject.value = null;
    sessionStore.reset();
    backgroundTasksStore.reset();
    contentTabsStore.reset();
  }

  return {
    activeProject,
    closeProject,
    createProject,
    deleteProject,
    isLoadingProjects,
    isOpeningProject,
    isSavingProject,
    loadProjects,
    openProject,
    projects,
    updateProject,
    updateSessionGroups,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}
