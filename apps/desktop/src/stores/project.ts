import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import {
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type CreateProjectRequest,
  type OpenProjectResult,
  type PineProject,
  type PineSessionGroup,
  type UpdateProjectRequest,
} from "@/shared/projects";
import { useContentTabsStore } from "./contentTabs";
import { useSessionStore } from "./session";

/**
 * The window's projects. A window holds the runtime of every project one of
 * its tabs belongs to; `activeProject` follows the active tab, so the
 * sidebars and accent colour switch with it.
 */
export const useProjectStore = defineStore("project", () => {
  const contentTabsStore = useContentTabsStore();
  const sessionStore = useSessionStore();
  const projects = shallowRef<PineProject[]>([]);
  /** Projects whose runtime this window holds. */
  const openProjectIds = ref<ReadonlySet<string>>(new Set());
  /** The project the active tab belongs to (or a draft's send target). */
  const currentProjectId = ref<string>(TEMPORARY_WORKSPACE_PROJECT_ID);
  const isLoadingProjects = ref(false);
  const isSavingProject = ref(false);
  const pendingOpens = new Map<string, Promise<OpenProjectResult>>();

  const activeProject = computed(
    () =>
      projects.value.find((project) => project.id === currentProjectId.value) ??
      null,
  );

  function projectById(id: string | null | undefined): PineProject | null {
    return projects.value.find((project) => project.id === id) ?? null;
  }

  function isOpen(id: string): boolean {
    return openProjectIds.value.has(id);
  }

  function setOpen(id: string, open: boolean): void {
    const next = new Set(openProjectIds.value);
    if (open) next.add(id);
    else next.delete(id);
    openProjectIds.value = next;
  }

  function upsertProject(project: PineProject): void {
    projects.value = [
      project,
      ...projects.value.filter((candidate) => candidate.id !== project.id),
    ].sort((left, right) => {
      if (left.id === TEMPORARY_WORKSPACE_PROJECT_ID) return -1;
      if (right.id === TEMPORARY_WORKSPACE_PROJECT_ID) return 1;
      const leftTime = Date.parse(left.lastOpenedAt ?? left.updatedAt);
      const rightTime = Date.parse(right.lastOpenedAt ?? right.updatedAt);
      return rightTime - leftTime;
    });
  }

  /** Refresh a project in place, so opening one does not reorder menus. */
  function replaceProject(project: PineProject): void {
    if (!projects.value.some((candidate) => candidate.id === project.id)) {
      upsertProject(project);
      return;
    }
    projects.value = projects.value.map((candidate) =>
      candidate.id === project.id ? project : candidate,
    );
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

  /**
   * Make sure this window holds the project's runtime. Resolves `opened:
   * false` when another window already owns it; main focuses that window.
   */
  function ensureOpen(id: string): Promise<OpenProjectResult> {
    const known = projectById(id);
    if (known && isOpen(id))
      return Promise.resolve({ opened: true, project: known });
    const pending = pendingOpens.get(id);
    if (pending) return pending;

    const opening = window.pine
      .openProject({ id })
      .then((result) => {
        replaceProject(result.project);
        if (result.opened) setOpen(id, true);
        return result;
      })
      .finally(() => pendingOpens.delete(id));
    pendingOpens.set(id, opening);
    return opening;
  }

  /** Release a project runtime no tab of this window uses any more. */
  async function closeProject(id: string): Promise<void> {
    if (!isOpen(id)) return;
    setOpen(id, false);
    sessionStore.forgetProject(id);
    await window.pine.closeProject({ id });
  }

  async function updateProject(
    request: UpdateProjectRequest,
  ): Promise<PineProject> {
    isSavingProject.value = true;
    try {
      const project = (await window.pine.updateProject(request)).project;
      upsertProject(project);
      // Main restarts an open project's runtime with the new settings, which
      // ends its live sessions; their views resume from history.
      if (isOpen(project.id)) sessionStore.forgetProject(project.id);
      return project;
    } finally {
      isSavingProject.value = false;
    }
  }

  async function updateSessionGroups(
    projectId: string,
    sessionGroups: PineSessionGroup[],
  ): Promise<PineProject> {
    isSavingProject.value = true;
    try {
      const updated = (
        await window.pine.updateProjectSessionGroups({
          id: projectId,
          sessionGroups,
        })
      ).project;
      upsertProject(updated);
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
      setOpen(id, false);
      sessionStore.forgetProject(id);
      contentTabsStore.removeProject(id);
    } finally {
      isSavingProject.value = false;
    }
  }

  function setCurrentProject(id: string): void {
    currentProjectId.value = id;
  }

  return {
    activeProject,
    closeProject,
    createProject,
    currentProjectId,
    deleteProject,
    ensureOpen,
    isLoadingProjects,
    isOpen,
    isSavingProject,
    loadProjects,
    openProjectIds,
    projectById,
    projects,
    setCurrentProject,
    updateProject,
    updateSessionGroups,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}
