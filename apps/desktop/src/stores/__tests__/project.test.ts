import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PineProject } from "@/shared/projects";
import { useProjectStore } from "../project";
import { useContentTabsStore } from "../contentTabs";
import { useSessionStore } from "../session";

const project: PineProject = {
  createdAt: "2026-08-19T12:00:00.000Z",
  defaultFolderId: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
  folders: [
    {
      access: "read-write",
      id: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
      isAvailable: true,
      name: "pine",
      path: "/projects/pine",
    },
  ],
  id: "9ab0b15f-331f-4aa6-8056-cd2be3bf7414",
  name: "pine",
  schemaVersion: 1,
  updatedAt: "2026-08-19T12:00:00.000Z",
};

describe("project store", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  it("loads the project library", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        listProjects: vi.fn().mockResolvedValue({ projects: [project] }),
      },
    });
    const store = useProjectStore();

    await store.loadProjects();
    expect(store.projects).toEqual([project]);
    expect(store.isLoadingProjects).toBe(false);
  });

  it("follows the current project rather than the last opened one", async () => {
    const other = { ...project, id: "1ab0b15f-331f-4aa6-8056-cd2be3bf7414" };
    const openProject = vi.fn(({ id }: { id: string }) =>
      Promise.resolve({
        opened: true,
        project: id === other.id ? other : project,
      }),
    );
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        listProjects: vi.fn().mockResolvedValue({ projects: [project, other] }),
        openProject,
      },
    });
    const store = useProjectStore();
    await store.loadProjects();

    await store.ensureOpen(project.id);
    await store.ensureOpen(other.id);
    store.setCurrentProject(project.id);

    expect(store.activeProject).toEqual(project);
    expect(store.isOpen(project.id)).toBe(true);
    expect(store.isOpen(other.id)).toBe(true);
  });

  it("opens each project once, even while a request is in flight", async () => {
    const openProject = vi.fn().mockResolvedValue({ opened: true, project });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openProject },
    });
    const store = useProjectStore();

    await Promise.all([
      store.ensureOpen(project.id),
      store.ensureOpen(project.id),
    ]);
    await store.ensureOpen(project.id);
    expect(openProject).toHaveBeenCalledTimes(1);
  });

  it("does not mark a project open when another window owns it", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        openProject: vi.fn().mockResolvedValue({ opened: false, project }),
      },
    });
    const store = useProjectStore();

    await expect(store.ensureOpen(project.id)).resolves.toMatchObject({
      opened: false,
    });
    expect(store.isOpen(project.id)).toBe(false);
  });

  it("does not reorder the project library while opening a project", async () => {
    const olderProject = {
      ...project,
      id: "1ab0b15f-331f-4aa6-8056-cd2be3bf7414",
      name: "older",
      lastOpenedAt: "2026-08-19T12:00:00.000Z",
    } satisfies PineProject;
    const openedProject = {
      ...project,
      lastOpenedAt: "2026-08-20T12:00:00.000Z",
    } satisfies PineProject;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        listProjects: vi
          .fn()
          .mockResolvedValue({ projects: [olderProject, project] }),
        openProject: vi
          .fn()
          .mockResolvedValue({ opened: true, project: openedProject }),
      },
    });
    const store = useProjectStore();

    await store.loadProjects();
    await store.ensureOpen(project.id);

    expect(store.projects.map(({ id }) => id)).toEqual([
      olderProject.id,
      project.id,
    ]);
    expect(store.projectById(project.id)?.lastOpenedAt).toBe(
      openedProject.lastOpenedAt,
    );
  });

  it("closes one project and forgets its sessions", async () => {
    const closeProject = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        closeProject,
        openProject: vi.fn().mockResolvedValue({ opened: true, project }),
      },
    });
    const store = useProjectStore();
    const forgetProject = vi.spyOn(useSessionStore(), "forgetProject");
    await store.ensureOpen(project.id);

    await store.closeProject(project.id);

    expect(closeProject).toHaveBeenCalledWith({ id: project.id });
    expect(store.isOpen(project.id)).toBe(false);
    expect(forgetProject).toHaveBeenCalledWith(project.id);
  });

  it("deletes a project and closes its tabs", async () => {
    const deleteProject = vi.fn().mockResolvedValue({ deleted: true });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        deleteProject,
        listProjects: vi.fn().mockResolvedValue({ projects: [project] }),
      },
    });
    const store = useProjectStore();
    await store.loadProjects();
    const tabs = useContentTabsStore();
    tabs.openFile({
      projectId: project.id,
      folderId: project.defaultFolderId,
      relativePath: "README.md",
    });

    await store.deleteProject(project.id);

    expect(deleteProject).toHaveBeenCalledWith({ id: project.id });
    expect(store.projects).toEqual([]);
    expect(tabs.tabs.some((tab) => tab.projectId === project.id)).toBe(false);
    expect(store.isSavingProject).toBe(false);
  });

  it("updates one project's session groups without touching tabs", async () => {
    const updatedProject = {
      ...project,
      sessionGroups: [
        {
          id: "4a1e4bf2-571b-4b48-9f7f-f7cf3dd6c01f",
          name: "Planning",
          sessionIds: ["019cfe51-7166-79b9-a5b9-c652fcca9eab"],
        },
      ],
    };
    const updateProjectSessionGroups = vi
      .fn()
      .mockResolvedValue({ project: updatedProject });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { updateProjectSessionGroups },
    });
    const store = useProjectStore();
    const tabs = useContentTabsStore();
    const file = tabs.openFile({
      projectId: project.id,
      folderId: project.defaultFolderId,
      relativePath: "README.md",
    });

    await store.updateSessionGroups(
      project.id,
      updatedProject.sessionGroups ?? [],
    );

    expect(updateProjectSessionGroups).toHaveBeenCalledWith({
      id: project.id,
      sessionGroups: updatedProject.sessionGroups,
    });
    expect(store.projectById(project.id)?.sessionGroups).toEqual(
      updatedProject.sessionGroups,
    );
    expect(tabs.tabs).toContainEqual(file);
  });
});
