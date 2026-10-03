import type { PineProject } from "@/shared/projects";

/**
 * Projects whose name contains the query, names that start with it first.
 * An empty query keeps every project in its usual order.
 */
export function projectNameMatches(
  projects: readonly PineProject[],
  query: string,
  displayName: (project: PineProject) => string,
): PineProject[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...projects];
  const prefix: PineProject[] = [];
  const contains: PineProject[] = [];
  for (const project of projects) {
    const name = displayName(project).toLocaleLowerCase();
    if (name.startsWith(needle)) prefix.push(project);
    else if (name.includes(needle)) contains.push(project);
  }
  return [...prefix, ...contains];
}
