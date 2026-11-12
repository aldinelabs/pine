import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  CLEAR_PROJECT_STORAGE_CHANNEL,
  CLOSE_PROJECT_CHANNEL,
  CREATE_PROJECT_CHANNEL,
  DELETE_PROJECT_CHANNEL,
  LIST_PROJECTS_CHANNEL,
  OPEN_PROJECT_CHANNEL,
  PROJECT_STORAGE_CHANNEL,
  UPDATE_PROJECT_CHANNEL,
  UPDATE_PROJECT_SESSION_GROUPS_CHANNEL,
  isTemporaryWorkspace,
  type DeleteProjectResult,
  type ListProjectsResult,
  type OpenProjectResult,
  type AgentProjectFolder,
  type PineProject,
  type ProjectFolderInput,
  type ProjectHostOperation,
  type ProjectHostResult,
  type ProjectMutationInput,
  type ProjectResult,
  type ProjectStorageResult,
  type ProjectStorageUsage,
} from "../../../shared/projects";
import { isVirtualClient } from "../../../shared/webControl";
import {
  clearProjectStorage,
  measureProjectStorage,
} from "../../projects/projectStorage";
import type { PineCore } from "../pineCore";
import {
  ClearProjectStorageRequestSchema,
  ProjectIdRequestSchema,
  ProjectMutationSchema,
  UpdateProjectRequestSchema,
  UpdateProjectSessionGroupsRequestSchema,
} from "../requestSchemas";

/**
 * Saves a project's settings and restarts its runtime with them, which ends
 * its live sessions; `clientIds` are told so their views resume from history.
 */
async function applyProjectUpdate(
  core: PineCore,
  id: string,
  input: ProjectMutationInput,
  clientIds: readonly number[],
): Promise<PineProject> {
  const { repository, runtimes } = core;
  const project = await repository.update(id, input);
  const sessionIds = [...new Set(runtimes.liveSessionIdsOf(id))];
  await runtimes.refresh(project, repository.dataPaths(id));
  for (const clientId of new Set(clientIds))
    for (const sessionId of sessionIds)
      core.sendSessionEvent(clientId, {
        type: "session-reset",
        sessionId,
        projectId: id,
      });
  return project;
}

const AgentProjectFolderSchema = z.object({
  path: z.string().trim().min(1).max(4_096),
  access: z.enum(["read-only", "read-write"]),
});

const ProjectHostOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    name: z.string().trim().min(1).max(100),
    folders: z.array(AgentProjectFolderSchema).min(1).max(50),
  }),
  z.object({
    op: z.literal("update"),
    projectId: z.uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    addFolders: z.array(AgentProjectFolderSchema).max(50).optional(),
    removeFolderPaths: z.array(z.string().trim().min(1)).max(50).optional(),
    defaultFolderPath: z.string().trim().min(1).optional(),
  }),
  z.object({ op: z.literal("delete"), projectId: z.uuid() }),
]);

/** Paths compare as the folder they name, ignoring a trailing separator. */
function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function agentFolder(folder: AgentProjectFolder): ProjectFolderInput {
  if (!path.isAbsolute(folder.path))
    throw new Error(`${folder.path} is not an absolute path.`);
  const resolved = path.resolve(folder.path);
  return {
    id: randomUUID(),
    access: folder.access,
    name: path.basename(resolved) || resolved,
    path: resolved,
  };
}

/** The first read-write folder, which a project needs as its default. */
function defaultFolderOf(
  folders: readonly ProjectFolderInput[],
  requestedPath?: string,
): string {
  const folder = requestedPath
    ? folders.find((candidate) => samePath(candidate.path, requestedPath))
    : folders.find((candidate) => candidate.access === "read-write");
  if (!folder)
    throw new Error(
      requestedPath
        ? `${requestedPath} is not one of the project's folders.`
        : "A project needs at least one read-write folder.",
    );
  if (folder.access !== "read-write")
    throw new Error("The default folder must have read-write access.");
  return folder.id;
}

/**
 * Answers the project tools of `requester`, a live session in the window
 * `ownerId`. The agent asked the user before each operation; main still
 * refuses what would end other running work or the asking session itself.
 */
export async function answerProjectOperation(
  core: PineCore,
  requester: { sessionId: string; ownerId: number },
  operation: ProjectHostOperation,
): Promise<ProjectHostResult> {
  const parsed = ProjectHostOperationSchema.parse(operation);
  const { repository, runtimes } = core;
  if (parsed.op === "create") {
    const folders = parsed.folders.map(agentFolder);
    const project = await repository.create(
      ProjectMutationSchema.parse({
        name: parsed.name,
        folders,
        defaultFolderId: defaultFolderOf(folders),
      }),
    );
    core.notifyLibraryChanged("projects");
    return { op: "create", projectId: project.id, projectName: project.name };
  }

  if (isTemporaryWorkspace(parsed.projectId))
    throw new Error("No Project cannot be changed or deleted.");
  const project = await repository.get(parsed.projectId);
  const ownProject =
    runtimes.projectOfLiveSession(requester.sessionId)?.id === project.id;
  // Saving restarts the project's sessions, as Edit Project does.
  if (core.projectHasRunningWork(project.id, requester.sessionId))
    throw new Error(
      `Another session of ${project.name} is still working; try again once it finishes.`,
    );

  if (parsed.op === "delete") {
    if (ownProject)
      throw new Error("A session cannot delete the project it runs in.");
    await runtimes.closeEverywhere(project.id);
    await repository.delete(project.id);
    core.notifyLibraryChanged("projects");
    return { op: "delete", projectName: project.name };
  }

  const removed = parsed.removeFolderPaths ?? [];
  for (const removedPath of removed)
    if (!project.folders.some((folder) => samePath(folder.path, removedPath)))
      throw new Error(`${removedPath} is not one of the project's folders.`);
  const kept: ProjectFolderInput[] = project.folders
    .filter(
      (folder) =>
        !removed.some((removedPath) => samePath(folder.path, removedPath)),
    )
    .map(({ access, id, name, path: folderPath }) => ({
      access,
      id,
      name,
      path: folderPath,
    }));
  const added = (parsed.addFolders ?? [])
    .filter(
      (folder) =>
        !kept.some((existing) => samePath(existing.path, folder.path)),
    )
    .map(agentFolder);
  const folders = [...kept, ...added];
  const keepsDefault = kept.some(
    (folder) => folder.id === project.defaultFolderId,
  );
  const input = ProjectMutationSchema.parse({
    name: parsed.name ?? project.name,
    folders,
    defaultFolderId:
      parsed.defaultFolderPath || !keepsDefault
        ? defaultFolderOf(folders, parsed.defaultFolderPath)
        : project.defaultFolderId,
    projectColorTheme: project.projectColorTheme,
    projectIcon: project.projectIcon,
  });
  const apply = async () => {
    await applyProjectUpdate(
      core,
      project.id,
      input,
      runtimes.clientsOfProject(project.id),
    );
    core.notifyLibraryChanged("projects");
  };
  if (ownProject) {
    core.scheduleAfterReply(requester.sessionId, apply);
    return {
      op: "update",
      projectId: project.id,
      projectName: input.name,
      applied: "after-reply",
    };
  }
  await apply();
  return {
    op: "update",
    projectId: project.id,
    projectName: input.name,
    applied: "now",
  };
}

export function registerProjectRequests(core: PineCore): void {
  const { repository, runtimes } = core;

  core.handle(LIST_PROJECTS_CHANNEL, async (): Promise<ListProjectsResult> => ({
    projects: await repository.list(),
  }));

  core.handle(
    CREATE_PROJECT_CHANNEL,
    async (context, request: unknown): Promise<ProjectResult> => {
      const input = ProjectMutationSchema.parse(request);
      const project = await repository.create(input);
      core.notifyLibraryChanged("projects", context.clientId);
      return { project };
    },
  );

  core.handle(
    CLOSE_PROJECT_CHANNEL,
    async (context, request: unknown): Promise<void> => {
      const { id } = ProjectIdRequestSchema.parse(request);
      // Presented-file grants belong to the window rather than one project, so
      // they stay until the window itself goes away.
      await runtimes.close(context.clientId, id);
    },
  );

  core.handle(
    OPEN_PROJECT_CHANNEL,
    async (context, request: unknown): Promise<OpenProjectResult> => {
      const { id } = ProjectIdRequestSchema.parse(request);
      // Opening again must not restart a runtime the client already holds.
      if (runtimes.isOpen(context.clientId, id)) {
        return { opened: true, project: await repository.open(id) };
      }
      const holders = runtimes
        .clientsOfProject(id)
        .filter((clientId) => clientId !== context.clientId);
      // Every window needs the temporary workspace for new drafts, so it is the
      // one project several windows may hold; its sessions stay single-window.
      const otherHolders = isTemporaryWorkspace(id) ? [] : holders;
      // A window hands the project to the window that already holds it.
      if (
        context.source === "desktop" &&
        otherHolders.some((clientId) => core.host.focusClient(clientId))
      ) {
        return { opened: false, project: await repository.open(id) };
      }
      // The browser interface attaches beside windows rather than taking over,
      // and a window attaches beside an interface that is not a window, such
      // as the browser or WeChat, so the sessions it runs keep going.
      if (context.source === "web" || holders.some(isVirtualClient)) {
        const project = await repository.open(id);
        await runtimes.share(
          context.clientId,
          project,
          repository.dataPaths(id),
        );
        return { opened: true, project };
      }
      // Holders left without a window, such as a crashed renderer. An interface
      // that is not a window is never one of them.
      for (const clientId of otherHolders)
        if (!isVirtualClient(clientId)) await runtimes.dispose(clientId);

      const pendingKey = isTemporaryWorkspace(id)
        ? `${id}:${context.clientId}`
        : id;
      const pending = core.pendingProjectOpens.get(pendingKey);
      if (pending) {
        if (
          pending.clientId !== context.clientId &&
          core.host.focusClient(pending.clientId)
        ) {
          return { opened: false, project: await pending.promise };
        }
        return { opened: true, project: await pending.promise };
      }

      const opening = (async (): Promise<PineProject> => {
        const project = await repository.open(id);
        await runtimes.open(
          context.clientId,
          project,
          repository.dataPaths(id),
        );
        return project;
      })();
      core.pendingProjectOpens.set(pendingKey, {
        promise: opening,
        clientId: context.clientId,
      });
      try {
        return { opened: true, project: await opening };
      } finally {
        if (core.pendingProjectOpens.get(pendingKey)?.promise === opening) {
          core.pendingProjectOpens.delete(pendingKey);
        }
      }
    },
  );

  core.handle(
    UPDATE_PROJECT_CHANNEL,
    async (context, request: unknown): Promise<ProjectResult> => {
      const parsed = UpdateProjectRequestSchema.parse(request);
      const { id } = parsed;
      const input = {
        defaultFolderId: parsed.defaultFolderId,
        folders: parsed.folders,
        name: parsed.name,
        projectColorTheme: parsed.projectColorTheme,
        projectIcon: parsed.projectIcon,
      };
      const project = await applyProjectUpdate(core, id, input, [
        context.clientId,
      ]);
      core.notifyLibraryChanged("projects", context.clientId);
      return { project };
    },
  );

  core.handle(
    UPDATE_PROJECT_SESSION_GROUPS_CHANNEL,
    async (context, request: unknown): Promise<ProjectResult> => {
      const { id, sessionGroups } =
        UpdateProjectSessionGroupsRequestSchema.parse(request);
      const project = await repository.updateSessionGroups(id, sessionGroups);
      core.notifyLibraryChanged("projects", context.clientId);
      return { project };
    },
  );

  core.handle(
    DELETE_PROJECT_CHANNEL,
    async (context, request: unknown): Promise<DeleteProjectResult> => {
      const { id } = ProjectIdRequestSchema.parse(request);
      await runtimes.closeEverywhere(id);
      const deleted = await repository.delete(id);
      core.notifyLibraryChanged("projects", context.clientId);
      return { deleted };
    },
  );

  core.handle(
    PROJECT_STORAGE_CHANNEL,
    async (): Promise<ProjectStorageResult> => {
      const projects = await repository.list();
      return {
        usage: await Promise.all(
          projects.map((project) =>
            measureProjectStorage(project.id, repository.dataPaths(project.id)),
          ),
        ),
      };
    },
  );

  core.handle(
    CLEAR_PROJECT_STORAGE_CHANNEL,
    async (_context, request: unknown): Promise<ProjectStorageUsage> => {
      const { id, kind } = ClearProjectStorageRequestSchema.parse(request);
      await repository.get(id);
      if (kind === "temporary" && core.projectHasRunningWork(id)) {
        throw new Error(
          "A session of this project is still running; try again once it finishes.",
        );
      }
      const dataPaths = repository.dataPaths(id);
      await clearProjectStorage(dataPaths, kind);
      return measureProjectStorage(id, dataPaths);
    },
  );
}
