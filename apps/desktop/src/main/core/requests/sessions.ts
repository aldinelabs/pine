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
  type RenameSessionResult,
  type ResumeSessionResult,
  type SearchAllSessionsResult,
  type SearchSessionsResult,
} from "../../../shared/sessions";
import {
  attachmentForProjectSession,
  listAllRecentSessions,
  searchAllSessions,
} from "../../recentSessions";
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

export function registerSessionRequests(core: PineCore): void {
  const { repository, runtimes } = core;
  /** Reads sessions of projects no interface has open. */
  const library = {
    dataPaths: (projectId: string) => repository.dataPaths(projectId),
    openSessionService: (projectId: string) =>
      runtimes.openSessionService(projectId),
  };

  core.handle(
    LIST_ALL_RECENT_SESSIONS_CHANNEL,
    async (): Promise<ListAllRecentSessionsResult> => ({
      sessions: await listAllRecentSessions(await repository.list(), library),
    }),
  );

  core.handle(
    SEARCH_ALL_SESSIONS_CHANNEL,
    async (_context, request: unknown): Promise<SearchAllSessionsResult> => {
      const { query } = SearchAllSessionsRequestSchema.parse(request);
      return {
        sessions: await searchAllSessions(
          await repository.list(),
          query,
          library,
        ),
      };
    },
  );

  core.handle(
    SEARCH_SESSIONS_CHANNEL,
    async (context, request: unknown): Promise<SearchSessionsResult> => {
      const { projectId, query } = SearchSessionsRequestSchema.parse(request);
      return {
        sessions: await runtimes.search(context.clientId, projectId, query),
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
      return runtimes.resume(context.clientId, projectId, sessionId);
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
    async (context, request: unknown): Promise<PromptSessionResult> =>
      runtimes.prompt(
        context.clientId,
        PromptSessionRequestSchema.parse(request),
      ),
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
