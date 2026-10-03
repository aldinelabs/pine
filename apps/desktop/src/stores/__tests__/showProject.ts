import type { PineProject } from "@/shared/projects";
import { useProjectStore } from "../project";

/**
 * Make a project the window's current, open project, as switching to one of
 * its tabs does. `activeProject` is derived from the current tab's project,
 * so tests set that instead of assigning it.
 */
export function showProject(project: PineProject): void {
  const store = useProjectStore();
  store.projects = [
    project,
    ...store.projects.filter((candidate) => candidate.id !== project.id),
  ];
  store.openProjectIds = new Set([...store.openProjectIds, project.id]);
  store.setCurrentProject(project.id);
}
