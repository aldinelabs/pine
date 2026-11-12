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
  approvalModeWithin,
} from "../../../shared/agent";
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
} from "../../../shared/sessions";
import { z } from "zod";
import {
  ALL_PROJECTS_SEARCH_LIMIT,
  attachmentForProjectSession,
  listAllRecentSessions,
  searchAllSessions,
} from "../../recentSessions";
import type {
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

/** Marks the sessions that are automation runs, as the sidebar shows them. */
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
    return run ? { ...session, automationRun: run } : session;
  });
}

/** Reads sessions of projects no interface has open. */
function sessionLibrary(core: PineCore) {
  return {
    dataPaths: (projectId: string) => core.repository.dataPaths(projectId),
    openSessionService: (projectId: string) =>
      core.runtimes.openSessionService(projectId),
  };
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
    message: z.string().trim().min(1).max(100_000),
    approvalMode: z.enum([
      "let-me-review",
      "auto-approve",
      "autonomous",
      "YOLO",
    ]),
    locale: z.enum(["en-US", "zh-CN"]),
  }),
]);

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

  const callerMode = runtimes.approvalModeOfLiveSession(requester.sessionId);
  if (!callerMode) throw new Error("The asking session is no longer open.");
  if (!approvalModeWithin(parsed.approvalMode, callerMode))
    throw new Error(
      `A session in ${callerMode} cannot start one in ${parsed.approvalMode}.`,
    );
  const projectId =
    parsed.projectId ?? runtimes.projectOfLiveSession(requester.sessionId)?.id;
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error("That project does not exist.");
  const projectOwner = runtimes.ownerOfProject(project.id);
  if (projectOwner !== undefined && projectOwner !== requester.ownerId)
    throw new Error("That project is open in another Pine window.");
  if (!runtimes.isOpen(requester.ownerId, project.id))
    await runtimes.share(
      requester.ownerId,
      await repository.open(project.id),
      repository.dataPaths(project.id),
    );
  const result = await runtimes.prompt(
    requester.ownerId,
    {
      locale: parsed.locale,
      message: parsed.message,
      target: { kind: "new", projectId: project.id },
      approvalMode: parsed.approvalMode,
    },
    { focus: false },
  );
  core.notifyLibraryChanged("sessions", requester.ownerId);
  return {
    op: "start",
    sessionId: result.session.id,
    projectId: project.id,
    projectName: projectName(project),
    approvalMode: parsed.approvalMode,
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
      const deleted = await runtimes.deleteSession(
        context.clientId,
        projectId,
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
