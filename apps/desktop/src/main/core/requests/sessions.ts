import { randomUUID } from "node:crypto";
import {
  ABORT_SESSION_CHANNEL,
  APPROVAL_RESPONSE_CHANNEL,
  COMPACT_SESSION_CHANNEL,
  DEQUEUE_STEERING_CHANNEL,
  PROMPT_SESSION_CHANNEL,
  SEND_STEERING_NOW_CHANNEL,
  QUESTIONNAIRE_RESPONSE_CHANNEL,
  SET_APPROVAL_MODE_CHANNEL,
  type AbortSessionResult,
  type CompactSessionResult,
  type DequeueSteeringResult,
  type PromptSessionResult,
  type RespondApprovalRequest,
  type SendSteeringNowResult,
  type RespondQuestionnaireRequest,
  type SetApprovalModeResult,
  type PineApprovalMode,
  approvalModeWithin,
} from "../../../shared/agent";
import { isVirtualClient } from "../../../shared/webControl";
import {
  LIST_BACKGROUND_TASKS_CHANNEL,
  READ_BACKGROUND_TASK_OUTPUT_CHANNEL,
  STOP_BACKGROUND_TASK_CHANNEL,
  type BackgroundTaskResult,
  type ListBackgroundTasksResult,
  type ReadBackgroundTaskOutputResult,
} from "../../../shared/backgroundTasks";
import {
  ATTACH_SESSION_CHANNEL,
  DELETE_SESSION_CHANNEL,
  LIST_ALL_RECENT_SESSIONS_CHANNEL,
  LOAD_SESSION_MESSAGES_CHANNEL,
  RENAME_SESSION_CHANNEL,
  RESUME_SESSION_CHANNEL,
  SEARCH_ALL_SESSIONS_CHANNEL,
  SEARCH_SESSIONS_CHANNEL,
  type AttachSessionResult,
  type DeleteSessionResult,
  type ListAllRecentSessionsResult,
  type LoadSessionMessagesResult,
  type PineSessionSummary,
  type RenameSessionResult,
  type ResumeSessionResult,
  type SearchAllSessionsResult,
  type SearchSessionsResult,
  relayTitle,
} from "../../../shared/sessions";
import { z } from "zod";
import {
  ALL_PROJECTS_SEARCH_LIMIT,
  attachmentForProjectSession,
  listAllRecentSessions,
  listProjectSessions,
  searchAllSessions,
} from "../../recentSessions";
import {
  childrenOf,
  deleteSessionWithChildren,
  isRelative,
  messageText,
  parentOf,
  relativesOf,
} from "../subSessions";
import type {
  AgentHostRelative,
  AgentHostSessionTree,
  AgentHostTreeSession,
  SessionHostOperation,
  SessionHostResult,
} from "../../../shared/sessions";
import {
  isTemporaryWorkspace,
  type PineProject,
} from "../../../shared/projects";
import type { AutomationRunSession } from "../../../shared/automation";
import type { PineCore } from "../pineCore";
import {
  BackgroundTaskRequestSchema,
  DequeueSteeringRequestSchema,
  SendSteeringNowRequestSchema,
  LoadSessionMessagesRequestSchema,
  ProjectSessionRequestSchema,
  PromptSessionRequestSchema,
  RenameSessionRequestSchema,
  RespondApprovalRequestSchema,
  RespondQuestionnaireRequestSchema,
  SearchAllSessionsRequestSchema,
  SearchSessionsRequestSchema,
  SessionIdRequestSchema,
  SetApprovalModeRequestSchema,
} from "../requestSchemas";

/**
 * Marks the sessions that are automation runs, and those started or used
 * from WeChat, as the sidebar shows them.
 */
async function withAutomationRuns<
  T extends PineSessionSummary & { projectId?: string },
>(core: PineCore, sessions: T[], projectId?: string): Promise<T[]> {
  const runs = new Map<string, Map<string, AutomationRunSession>>();
  for (const id of new Set(
    sessions.map((session) => session.projectId ?? projectId),
  )) {
    if (id) runs.set(id, await core.automations.runSessions(id));
  }
  return sessions.map((session) => {
    const run = runs.get(session.projectId ?? projectId ?? "")?.get(session.id);
    const origin = core.wechat.originOf(session.id);
    if (!run && !origin) return session;
    return {
      ...session,
      ...(run ? { automationRun: run } : {}),
      ...(origin ? { origin } : {}),
    };
  });
}

/** Reads sessions of projects no interface has open. */
export function sessionLibrary(core: PineCore) {
  return {
    dataPaths: (projectId: string) => core.repository.dataPaths(projectId),
    openSessionService: (projectId: string) =>
      core.runtimes.openSessionService(projectId),
  };
}

export interface BackgroundSessionInput {
  /** The client that holds and controls the new session. */
  ownerId: number;
  project: PineProject;
  /** The first prompt, final as sent (attachments already serialized). */
  message: string;
  approvalMode: PineApprovalMode;
  locale: "en-US" | "zh-CN";
  /** A title to give the session; a failed rename is ignored. */
  title?: string;
  /** Makes the new session a sub-session of this one. */
  parentSessionId?: string;
}

/**
 * Starts a session without focusing it: the owner shares the project if it
 * does not hold it yet, then prompts a new session as itself. The caller has
 * already checked the approval mode and chosen the owner.
 */
export async function startBackgroundSession(
  core: PineCore,
  input: BackgroundSessionInput,
): Promise<PromptSessionResult> {
  const { repository, runtimes } = core;
  const { ownerId, project, parentSessionId } = input;
  if (!runtimes.isOpen(ownerId, project.id))
    await runtimes.share(
      ownerId,
      await repository.open(project.id),
      repository.dataPaths(project.id),
    );
  const result = await runtimes.prompt(
    ownerId,
    {
      locale: input.locale,
      message: input.message,
      target: { kind: "new", projectId: project.id },
      approvalMode: input.approvalMode,
    },
    { focus: false, ...(parentSessionId ? { parentSessionId } : {}) },
  );
  if (input.title)
    await runtimes
      .renameSession(
        ownerId,
        project.id,
        result.session.id,
        input.title,
        "agent",
      )
      .catch(() => undefined);
  if (parentSessionId) {
    await repository.updateSessionParents(project.id, (parents) => ({
      ...parents,
      [result.session.id]: parentSessionId,
    }));
    core.notifyLibraryChanged("projects");
  }
  core.notifyLibraryChanged("sessions", ownerId);
  return result;
}

const SessionHostOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("search"),
    query: z.string().max(500),
    projectId: z.uuid().optional(),
    limit: z.number().int().min(1).max(ALL_PROJECTS_SEARCH_LIMIT),
  }),
  z.object({
    op: z.literal("start"),
    projectId: z.uuid().optional(),
    relation: z.enum(["child", "sibling"]),
    title: z.string().trim().min(1).max(200).optional(),
    message: z.string().trim().min(1).max(100_000),
    approvalMode: z.enum([
      "let-me-review",
      "auto-approve",
      "autonomous",
      "YOLO",
    ]),
    locale: z.enum(["en-US", "zh-CN"]),
  }),
  z.object({
    op: z.literal("tree"),
    projectId: z.uuid().optional(),
    limit: z.number().int().min(1).max(ALL_PROJECTS_SEARCH_LIMIT),
  }),
  z.object({
    op: z.literal("organize"),
    projectId: z.uuid(),
    revision: z.string().min(1),
    operations: z
      .array(
        z.discriminatedUnion("op", [
          z.object({
            op: z.literal("create-folder"),
            name: z.string().trim().min(1).max(100),
          }),
          z.object({
            op: z.literal("rename-folder"),
            folderId: z.string().min(1),
            name: z.string().trim().min(1).max(100),
          }),
          z.object({
            op: z.literal("delete-folder"),
            folderId: z.string().min(1),
          }),
          z.object({
            op: z.literal("move"),
            sessionId: z.uuid(),
            folderId: z.string().min(1).nullable(),
          }),
          z.object({
            op: z.literal("rename-session"),
            sessionId: z.uuid(),
            name: z.string().trim().min(1).max(200),
          }),
        ]),
      )
      .min(1)
      .max(100),
  }),
  z.object({
    op: z.literal("describe"),
    projectId: z.uuid(),
    sessionId: z.uuid(),
  }),
  z.object({
    op: z.literal("delete"),
    projectId: z.uuid(),
    sessionId: z.uuid(),
  }),
  z.object({ op: z.literal("relatives") }),
  z.object({
    op: z.literal("read"),
    sessionId: z.uuid(),
    limit: z.number().int().min(1).max(50),
    before: z.string().min(1).max(200).optional(),
  }),
  z.object({
    op: z.literal("send"),
    sessionId: z.uuid(),
    message: z.string().trim().min(1).max(100_000),
    locale: z.enum(["en-US", "zh-CN"]),
  }),
]);

/** A folder created earlier in the same call is named `new:1`, `new:2`, … */
const NEW_FOLDER_REFERENCE = /^new:(\d+)$/;

/** Makes sure the window holds the project, sharing it if no one does. */
async function holdProject(
  core: PineCore,
  requester: { ownerId: number },
  project: PineProject,
): Promise<number> {
  const { repository, runtimes } = core;
  const owner = runtimes.ownerOfProject(project.id) ?? requester.ownerId;
  if (!runtimes.isOpen(owner, project.id))
    await runtimes.share(
      owner,
      await repository.open(project.id),
      repository.dataPaths(project.id),
    );
  return owner;
}

async function sessionTree(
  core: PineCore,
  requester: { sessionId: string },
  project: PineProject,
  limit: number,
  name: string,
): Promise<AgentHostSessionTree> {
  const sessions = await listProjectSessions(project, sessionLibrary(core));
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const describe = (id: string): AgentHostTreeSession => {
    const session = byId.get(id);
    return {
      id,
      ...(session?.name ? { title: session.name } : {}),
      ...(session ? { updatedAt: session.updatedAt } : {}),
      ...(id === requester.sessionId ? { current: true as const } : {}),
    };
  };
  const groups = project.sessionGroups ?? [];
  const filed = new Set(groups.flatMap((group) => group.sessionIds));
  // A sub-session sits under its parent rather than in or outside folders.
  const unfiled = sessions.filter(
    (session) => !filed.has(session.id) && !parentOf(project, session.id),
  );
  return {
    projectId: project.id,
    projectName: name,
    revision: project.updatedAt,
    folders: groups.map((group) => ({
      id: group.id,
      name: group.name,
      // A deleted session can linger in a folder; it is not shown there.
      sessions: group.sessionIds.filter((id) => byId.has(id)).map(describe),
    })),
    unfiled: unfiled.slice(0, limit).map((session) => describe(session.id)),
    moreUnfiled: Math.max(unfiled.length - limit, 0),
  };
}

/**
 * Answers the session tools of `requester`, a live session in the window
 * `ownerId`. A started session belongs to that window, runs in the
 * background without taking its focus, and never has a less supervised
 * approval mode than the session that started it.
 */
export async function answerSessionOperation(
  core: PineCore,
  requester: { sessionId: string; ownerId: number },
  operation: SessionHostOperation,
): Promise<SessionHostResult> {
  const parsed = SessionHostOperationSchema.parse(operation);
  const { repository, runtimes } = core;
  const projects = await repository.list();
  const projectName = (project: PineProject) =>
    isTemporaryWorkspace(project.id) ? "No Project" : project.name;
  if (parsed.op === "search") {
    const scope = parsed.projectId
      ? projects.filter((project) => project.id === parsed.projectId)
      : projects;
    if (parsed.projectId && scope.length === 0)
      throw new Error("That project does not exist.");
    const names = new Map(
      projects.map((project) => [project.id, projectName(project)]),
    );
    const sessions = await withAutomationRuns(
      core,
      await searchAllSessions(
        scope,
        parsed.query,
        sessionLibrary(core),
        parsed.limit,
      ),
    );
    return {
      op: "search",
      sessions: sessions.map((session) => ({
        id: session.id,
        projectId: session.projectId,
        projectName: names.get(session.projectId) ?? session.projectId,
        ...(session.name ? { title: session.name } : {}),
        ...((session.snippet ?? session.preview)
          ? {
              // The highlight markers are for the sidebar, not the model.
              snippet: (session.snippet ?? session.preview ?? "").replace(
                /[\u0001\u0002]/g,
                "",
              ),
            }
          : {}),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        ...(session.id === requester.sessionId
          ? { current: true as const }
          : {}),
        ...(session.automationRun ? { automationRun: true as const } : {}),
      })),
    };
  }

  if (parsed.op === "tree") {
    const projectId =
      parsed.projectId ??
      runtimes.projectOfLiveSession(requester.sessionId)?.id;
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new Error("That project does not exist.");
    return {
      op: "tree",
      tree: await sessionTree(
        core,
        requester,
        project,
        parsed.limit,
        projectName(project),
      ),
    };
  }

  if (parsed.op === "organize") {
    const project = projects.find(
      (candidate) => candidate.id === parsed.projectId,
    );
    if (!project) throw new Error("That project does not exist.");
    if (project.updatedAt !== parsed.revision)
      throw new Error(
        "The project's sessions changed since that tree was read. Read the tree again and redo the edits.",
      );
    const known = new Set(
      (await listProjectSessions(project, sessionLibrary(core))).map(
        (session) => session.id,
      ),
    );
    let groups = (project.sessionGroups ?? []).map((group) => ({
      ...group,
      sessionIds: [...group.sessionIds],
    }));
    const created: string[] = [];
    const renames: { sessionId: string; name: string }[] = [];
    const folderId = (reference: string): string => {
      const match = NEW_FOLDER_REFERENCE.exec(reference);
      const id = match ? created[Number(match[1]) - 1] : reference;
      if (!id || !groups.some((group) => group.id === id))
        throw new Error(`No folder ${reference} in ${project.name}.`);
      return id;
    };
    const session = (id: string): string => {
      if (!known.has(id))
        throw new Error(`No session ${id} in ${projectName(project)}.`);
      return id;
    };
    for (const edit of parsed.operations) {
      if (edit.op === "create-folder") {
        const id = randomUUID();
        groups.push({ id, name: edit.name, sessionIds: [] });
        created.push(id);
      } else if (edit.op === "rename-folder") {
        const id = folderId(edit.folderId);
        groups = groups.map((group) =>
          group.id === id ? { ...group, name: edit.name } : group,
        );
      } else if (edit.op === "delete-folder") {
        const id = folderId(edit.folderId);
        groups = groups.filter((group) => group.id !== id);
      } else if (edit.op === "move") {
        const id = session(edit.sessionId);
        if (parentOf(project, id))
          throw new Error(
            `Session ${id} is a sub-session; it stays under the session that started it.`,
          );
        const target = edit.folderId === null ? null : folderId(edit.folderId);
        groups = groups.map((group) => ({
          ...group,
          sessionIds: group.sessionIds.filter((filed) => filed !== id),
        }));
        groups.find((group) => group.id === target)?.sessionIds.push(id);
      } else {
        renames.push({ sessionId: session(edit.sessionId), name: edit.name });
      }
    }
    let updated = project;
    if (parsed.operations.some((edit) => edit.op !== "rename-session")) {
      updated = await repository.updateSessionGroups(project.id, groups);
      core.notifyLibraryChanged("projects");
    }
    if (renames.length) {
      const owner = await holdProject(core, requester, project);
      for (const rename of renames)
        await runtimes.renameSession(
          owner,
          project.id,
          rename.sessionId,
          rename.name,
          "agent",
        );
      core.notifyLibraryChanged("sessions");
    }
    return {
      op: "organize",
      tree: await sessionTree(
        core,
        requester,
        updated,
        ALL_PROJECTS_SEARCH_LIMIT,
        projectName(updated),
      ),
      createdFolderIds: created,
    };
  }

  if (parsed.op === "describe" || parsed.op === "delete") {
    const project = projects.find(
      (candidate) => candidate.id === parsed.projectId,
    );
    if (!project) throw new Error("That project does not exist.");
    const known = (
      await withAutomationRuns(
        core,
        await listProjectSessions(project, sessionLibrary(core)),
      )
    ).find((session) => session.id === parsed.sessionId);
    if (!known)
      throw new Error(
        `No session ${parsed.sessionId} in ${projectName(project)}.`,
      );
    const open = runtimes.liveSessionIdsOf(project.id).includes(known.id);
    if (parsed.op === "describe")
      return {
        op: "describe",
        session: {
          id: known.id,
          projectId: project.id,
          projectName: projectName(project),
          ...(known.name ? { title: known.name } : {}),
          ...(known.preview ? { snippet: known.preview } : {}),
          createdAt: known.createdAt,
          updatedAt: known.updatedAt,
          messageCount: known.messageCount,
          ...(known.id === requester.sessionId
            ? { current: true as const }
            : {}),
          ...(known.automationRun ? { automationRun: true as const } : {}),
        },
        ...(open ? { open: true as const } : {}),
        subSessionCount: childrenOf(project, known.id).length,
      };
    if (parsed.sessionId === requester.sessionId)
      throw new Error("A session cannot delete itself.");
    const children = childrenOf(project, parsed.sessionId);
    if (children.includes(requester.sessionId))
      throw new Error("A session cannot delete the session that started it.");
    const owner = await holdProject(core, requester, project);
    const deleted = await deleteSessionWithChildren(
      core,
      owner,
      project,
      parsed.sessionId,
    );
    const groups = project.sessionGroups ?? [];
    if (groups.some((group) => group.sessionIds.includes(parsed.sessionId))) {
      await repository.updateSessionGroups(
        project.id,
        groups.map((group) => ({
          ...group,
          sessionIds: group.sessionIds.filter((id) => id !== parsed.sessionId),
        })),
      );
      core.notifyLibraryChanged("projects");
    }
    core.notifyLibraryChanged("sessions");
    return { op: "delete", deleted };
  }

  if (
    parsed.op === "relatives" ||
    parsed.op === "read" ||
    parsed.op === "send"
  ) {
    const own = runtimes.projectOfLiveSession(requester.sessionId);
    if (!own) throw new Error("The asking session is no longer open.");
    const project = await repository.get(own.id);
    const sessions = await listProjectSessions(project, sessionLibrary(core));
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const describe = (id: string): AgentHostRelative => {
      const session = byId.get(id);
      return {
        id,
        ...(session?.name ? { title: session.name } : {}),
        state: core.sessionActivity(id),
        ...(session ? { updatedAt: session.updatedAt } : {}),
      };
    };
    if (parsed.op === "relatives") {
      const { parent, children, siblings } = relativesOf(
        project,
        requester.sessionId,
      );
      return {
        op: "relatives",
        ...(parent ? { parent: describe(parent) } : {}),
        children: children.filter((id) => byId.has(id)).map(describe),
        siblings: siblings.filter((id) => byId.has(id)).map(describe),
      };
    }
    if (
      !isRelative(project, requester.sessionId, parsed.sessionId) ||
      !byId.has(parsed.sessionId)
    )
      throw new Error(
        "That session is not this session's parent, sub-session or sibling. Call ui_session_relatives for the ones it can reach.",
      );
    const owner = await holdProject(core, requester, project);
    if (parsed.op === "read") {
      const page = await runtimes.loadMessages(
        owner,
        project.id,
        parsed.sessionId,
        parsed.before,
        parsed.limit,
      );
      return {
        op: "read",
        sessionId: parsed.sessionId,
        ...(byId.get(parsed.sessionId)?.name
          ? { title: byId.get(parsed.sessionId)?.name }
          : {}),
        messages: page.messages
          .map((message) => ({
            role: message.role,
            createdAt: message.createdAt,
            text: messageText(message.blocks),
          }))
          .filter((message) => message.text),
        ...(page.hasMore && page.nextBefore
          ? { olderCursor: page.nextBefore }
          : {}),
      };
    }
    const refusal = await core.wechat.relayRefusal(
      requester.sessionId,
      parsed.sessionId,
      project.id,
    );
    if (refusal) throw new Error(refusal);
    const running = core.sessionActivity(parsed.sessionId) !== "idle";
    const name = byId.get(requester.sessionId)?.name;
    const sender = name ? relayTitle(name) : undefined;
    await runtimes.prompt(
      owner,
      {
        locale: parsed.locale,
        message: `[Message from session ${sender ? `"${sender}" ` : ""}(${requester.sessionId})]\n\n${parsed.message}`,
        target: {
          kind: "session",
          projectId: project.id,
          sessionId: parsed.sessionId,
        },
        ...(running ? { streamingBehavior: "steer" as const } : {}),
      },
      { focus: false },
    );
    core.notifyLibraryChanged("sessions");
    return { op: "send", delivered: running ? "steer" : "turn" };
  }

  const callerMode = runtimes.approvalModeOfLiveSession(requester.sessionId);
  if (!callerMode) throw new Error("The asking session is no longer open.");
  if (!approvalModeWithin(parsed.approvalMode, callerMode))
    throw new Error(
      `A session in ${callerMode} cannot start one in ${parsed.approvalMode}.`,
    );
  const ownProjectId = runtimes.projectOfLiveSession(requester.sessionId)?.id;
  const projectId = parsed.projectId ?? ownProjectId;
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error("That project does not exist.");
  const own = projects.find((candidate) => candidate.id === ownProjectId);
  const callerParent = own && parentOf(own, requester.sessionId);
  if (parsed.relation === "child" && callerParent)
    throw new Error(
      "This session is a sub-session, and sub-sessions go one level deep. Start a sibling instead.",
    );
  // A sibling of a sub-session is another sub-session of the same parent.
  const parentSessionId =
    parsed.relation === "child" ? requester.sessionId : callerParent;
  if (parentSessionId && project.id !== ownProjectId)
    throw new Error("A sub-session runs in its parent's project.");
  // A window may not start sessions in a project another window shows. An
  // interface that is not a window, such as WeChat, starts the session as the
  // window sharing its runtime, so that window keeps notifying for it.
  // Each window keeps its own temporary workspace, so only windows sharing the
  // requester's runtime count there.
  let ownerId = requester.ownerId;
  if (!isVirtualClient(requester.ownerId)) {
    const holders = isTemporaryWorkspace(project.id)
      ? runtimes.clientsSharingRuntime(requester.ownerId, project.id)
      : runtimes.clientsOfProject(project.id);
    if (holders.some((id) => !isVirtualClient(id) && id !== requester.ownerId))
      throw new Error("That project is open in another Pine window.");
  } else {
    if (!runtimes.isOpen(requester.ownerId, project.id))
      await runtimes.share(
        requester.ownerId,
        await repository.open(project.id),
        repository.dataPaths(project.id),
      );
    ownerId =
      runtimes
        .clientsSharingRuntime(requester.ownerId, project.id)
        .find((id) => !isVirtualClient(id)) ?? requester.ownerId;
  }
  const result = await startBackgroundSession(core, {
    ownerId,
    project,
    message: parentSessionId
      ? `[Sub-session of ${parentSessionId}. Pine reports your reply to that session each time you finish a turn, so end with what it needs to know.]\n\n${parsed.message}`
      : parsed.message,
    approvalMode: parsed.approvalMode,
    locale: parsed.locale,
    ...(parsed.title ? { title: parsed.title } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
  });
  return {
    op: "start",
    sessionId: result.session.id,
    projectId: project.id,
    projectName: projectName(project),
    approvalMode: parsed.approvalMode,
    ...(parentSessionId ? { parentSessionId } : {}),
  };
}

export function registerSessionRequests(core: PineCore): void {
  const { repository, runtimes } = core;
  const library = sessionLibrary(core);

  core.handle(
    LIST_ALL_RECENT_SESSIONS_CHANNEL,
    async (): Promise<ListAllRecentSessionsResult> => ({
      sessions: await withAutomationRuns(
        core,
        await listAllRecentSessions(await repository.list(), library),
      ),
    }),
  );

  core.handle(
    SEARCH_ALL_SESSIONS_CHANNEL,
    async (_context, request: unknown): Promise<SearchAllSessionsResult> => {
      const { query } = SearchAllSessionsRequestSchema.parse(request);
      return {
        sessions: await withAutomationRuns(
          core,
          await searchAllSessions(await repository.list(), query, library),
        ),
      };
    },
  );

  core.handle(
    SEARCH_SESSIONS_CHANNEL,
    async (context, request: unknown): Promise<SearchSessionsResult> => {
      const { projectId, query } = SearchSessionsRequestSchema.parse(request);
      return {
        sessions: await withAutomationRuns(
          core,
          await runtimes.search(context.clientId, projectId, query),
          projectId,
        ),
      };
    },
  );

  core.handle(
    ATTACH_SESSION_CHANNEL,
    async (context, request: unknown): Promise<AttachSessionResult> => {
      const { projectId, sessionId } =
        ProjectSessionRequestSchema.parse(request);
      // A session dragged in from another project may not be open here.
      const attachment = runtimes.isOpen(context.clientId, projectId)
        ? await runtimes.attachmentForSession(
            context.clientId,
            projectId,
            sessionId,
          )
        : await attachmentForProjectSession(projectId, sessionId, library);
      core.rememberAttachments(context.clientId, [attachment.path]);
      return { attachment };
    },
  );

  core.handle(
    RESUME_SESSION_CHANNEL,
    async (context, request: unknown): Promise<ResumeSessionResult> => {
      const { projectId, sessionId } =
        ProjectSessionRequestSchema.parse(request);
      const result = await runtimes.resume(
        context.clientId,
        projectId,
        sessionId,
      );
      const [session] = await withAutomationRuns(
        core,
        [result.session],
        projectId,
      );
      return { ...result, session };
    },
  );

  core.handle(
    DELETE_SESSION_CHANNEL,
    async (context, request: unknown): Promise<DeleteSessionResult> => {
      const { projectId, sessionId } =
        ProjectSessionRequestSchema.parse(request);
      const deleted = await deleteSessionWithChildren(
        core,
        context.clientId,
        await repository.get(projectId),
        sessionId,
      );
      core.notifyLibraryChanged("sessions", context.clientId);
      return { deleted };
    },
  );

  core.handle(
    RENAME_SESSION_CHANNEL,
    async (context, request: unknown): Promise<RenameSessionResult> => {
      const { name, projectId, sessionId } =
        RenameSessionRequestSchema.parse(request);
      const session = await runtimes.renameSession(
        context.clientId,
        projectId,
        sessionId,
        name,
      );
      core.notifyLibraryChanged("sessions", context.clientId);
      return { session };
    },
  );

  core.handle(
    LOAD_SESSION_MESSAGES_CHANNEL,
    async (context, request: unknown): Promise<LoadSessionMessagesResult> => {
      const { before, includeOutline, limit, projectId, sessionId } =
        LoadSessionMessagesRequestSchema.parse(request);
      return runtimes.loadMessages(
        context.clientId,
        projectId,
        sessionId,
        before,
        limit,
        includeOutline,
      );
    },
  );

  core.handle(
    PROMPT_SESSION_CHANNEL,
    async (context, request: unknown): Promise<PromptSessionResult> => {
      const parsed = PromptSessionRequestSchema.parse(request);
      // Writing in a finished run makes it an ordinary session; a running
      // one still belongs to its automation.
      if (parsed.target.kind === "session")
        await core.automations.claimRunSession(
          parsed.target.projectId,
          parsed.target.sessionId,
        );
      return runtimes.prompt(context.clientId, parsed);
    },
  );

  core.handle(
    ABORT_SESSION_CHANNEL,
    async (context, request: unknown): Promise<AbortSessionResult> =>
      runtimes.abort(
        context.clientId,
        SessionIdRequestSchema.parse(request).sessionId,
      ),
  );

  core.handle(
    LIST_BACKGROUND_TASKS_CHANNEL,
    async (context, request: unknown): Promise<ListBackgroundTasksResult> =>
      runtimes.listBackgroundTasks(
        context.clientId,
        SessionIdRequestSchema.parse(request).sessionId,
      ),
  );

  core.handle(
    STOP_BACKGROUND_TASK_CHANNEL,
    async (context, request: unknown): Promise<BackgroundTaskResult> =>
      runtimes.stopBackgroundTask(
        context.clientId,
        BackgroundTaskRequestSchema.parse(request),
      ),
  );

  core.handle(
    READ_BACKGROUND_TASK_OUTPUT_CHANNEL,
    async (
      context,
      request: unknown,
    ): Promise<ReadBackgroundTaskOutputResult> =>
      runtimes.readBackgroundTaskOutput(
        context.clientId,
        BackgroundTaskRequestSchema.parse(request),
      ),
  );

  core.handle(
    COMPACT_SESSION_CHANNEL,
    async (context, request: unknown): Promise<CompactSessionResult> =>
      runtimes.compact(
        context.clientId,
        SessionIdRequestSchema.parse(request).sessionId,
      ),
  );

  core.handle(
    DEQUEUE_STEERING_CHANNEL,
    async (context, request: unknown): Promise<DequeueSteeringResult> => {
      const { message, sessionId } =
        DequeueSteeringRequestSchema.parse(request);
      return runtimes.dequeueSteering(context.clientId, message, sessionId);
    },
  );

  core.handle(
    SEND_STEERING_NOW_CHANNEL,
    async (context, request: unknown): Promise<SendSteeringNowResult> => {
      const { message, sessionId } =
        SendSteeringNowRequestSchema.parse(request);
      return runtimes.sendSteeringNow(context.clientId, message, sessionId);
    },
  );

  core.handle(
    SET_APPROVAL_MODE_CHANNEL,
    async (context, request: unknown): Promise<SetApprovalModeResult> => {
      const { approvalMode, sessionId } =
        SetApprovalModeRequestSchema.parse(request);
      return runtimes.setApprovalMode(
        context.clientId,
        approvalMode,
        sessionId,
      );
    },
  );

  core.handle(
    APPROVAL_RESPONSE_CHANNEL,
    (context, request: unknown): { accepted: boolean } =>
      runtimes.respondApproval(
        context.clientId,
        RespondApprovalRequestSchema.parse(
          request,
        ) satisfies RespondApprovalRequest,
      ),
  );

  core.handle(
    QUESTIONNAIRE_RESPONSE_CHANNEL,
    (context, request: unknown): { accepted: boolean } =>
      runtimes.respondQuestionnaire(
        context.clientId,
        RespondQuestionnaireRequestSchema.parse(
          request,
        ) satisfies RespondQuestionnaireRequest,
      ),
  );
}
