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
  type PineProject,
  type ProjectResult,
  type ProjectStorageResult,
  type ProjectStorageUsage,
} from "../../../shared/projects";
import { WEB_CLIENT_ID } from "../../../shared/webControl";
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
      // Every window needs the temporary workspace for new drafts, so it is the
      // one project several windows may hold; its sessions stay single-window.
      const otherHolders = isTemporaryWorkspace(id)
        ? []
        : runtimes
            .clientsOfProject(id)
            .filter((clientId) => clientId !== context.clientId);
      // A window hands the project to the window that already holds it.
      if (
        context.source === "desktop" &&
        otherHolders.some((clientId) => core.host.focusClient(clientId))
      ) {
        return { opened: false, project: await repository.open(id) };
      }
      // The browser interface attaches beside windows rather than taking over.
      if (context.source === "web" || runtimes.isOpen(WEB_CLIENT_ID, id)) {
        const project = await repository.open(id);
        await runtimes.share(
          context.clientId,
          project,
          repository.dataPaths(id),
        );
        return { opened: true, project };
      }
      // Holders left without a window, such as a crashed renderer.
      for (const clientId of otherHolders) await runtimes.dispose(clientId);

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
      const project = await repository.update(id, input);
      const sessionIds = [...new Set(runtimes.liveSessionIdsOf(id))];
      await runtimes.refresh(project, repository.dataPaths(id));
      for (const sessionId of sessionIds)
        core.sendSessionEvent(context.clientId, {
          type: "session-reset",
          sessionId,
          projectId: id,
        });
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
