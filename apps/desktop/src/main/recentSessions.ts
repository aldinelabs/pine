import type { PineAttachment } from "../shared/attachments";
import type { PineProject } from "../shared/projects";
import type { ProjectSessionSearchResult } from "../shared/sessions";
import type { ProjectDataPaths } from "./projects/projectRepository";
import { ProjectSessionService } from "./sessions";

export const ALL_RECENT_SESSIONS_LIMIT = 100;

interface RecentSessionSources {
  dataPaths(projectId: string): ProjectDataPaths;
  /** An index a window already holds open for the project, if any. */
  openSessionService(projectId: string): ProjectSessionService | undefined;
}

/** Runs `task` on the project's open session index, or a temporary one. */
async function withSessionService<T>(
  projectId: string,
  sources: RecentSessionSources,
  task: (service: ProjectSessionService) => Promise<T>,
): Promise<T> {
  const open = sources.openSessionService(projectId);
  let service = open;
  if (!service) {
    const dataPaths = sources.dataPaths(projectId);
    service = await ProjectSessionService.create({
      cacheRoot: dataPaths.cacheRoot,
      cwd: dataPaths.projectRoot,
      sessionsRoot: dataPaths.sessionsRoot,
    });
  }
  try {
    return await task(service);
  } finally {
    if (!open) await service.dispose();
  }
}

/** A session's attachment, even when its project is not open in the window. */
export function attachmentForProjectSession(
  projectId: string,
  sessionId: string,
  sources: RecentSessionSources,
): Promise<PineAttachment> {
  return withSessionService(projectId, sources, (service) =>
    service.attachmentForSession(sessionId),
  );
}

async function recentSessionsOf(
  project: PineProject,
  sources: RecentSessionSources,
): Promise<ProjectSessionSearchResult[]> {
  return withSessionService(project.id, sources, async (service) => {
    const sessions = await service.search("");
    return sessions.map((session) => ({ ...session, projectId: project.id }));
  });
}

/** The newest sessions across every project, newest first. */
export async function listAllRecentSessions(
  projects: readonly PineProject[],
  sources: RecentSessionSources,
  limit = ALL_RECENT_SESSIONS_LIMIT,
): Promise<ProjectSessionSearchResult[]> {
  const lists = await Promise.all(
    // One unreadable project must not hide the others.
    projects.map((project) =>
      recentSessionsOf(project, sources).catch(() => []),
    ),
  );
  return lists
    .flat()
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    )
    .slice(0, limit);
}
