import type { PineAgentEvent } from "../shared/agent";
import {
  ABORT_SIDE_CHAT_CHANNEL,
  CLOSE_SIDE_CHAT_CHANNEL,
  DELETE_SIDE_CHAT_CHANNEL,
  LIST_SIDE_CHATS_CHANNEL,
  OPEN_SIDE_CHAT_CHANNEL,
  PROMPT_SIDE_CHAT_CHANNEL,
  SIDE_CHAT_EVENT_CHANNEL,
} from "../shared/sideChats";
import {
  AUTOMATIONS_CHANGED_CHANNEL,
  AUTOMATIONS_REVEAL_CHANNEL,
  CHECK_AUTOMATION_CHANNEL,
  DELETE_AUTOMATION_CHANNEL,
  SAVE_AUTOMATION_CHANNEL,
  DELETE_AUTOMATION_SECRET_CHANNEL,
  GET_AUTOMATION_CHANNEL,
  GET_AUTOMATION_RUN_CHANNEL,
  KEEP_AUTOMATION_RUN_CHANNEL,
  LIST_AUTOMATION_APPROVALS_CHANNEL,
  LIST_AUTOMATION_RUNS_CHANNEL,
  LIST_AUTOMATION_SECRETS_CHANNEL,
  LIST_AUTOMATIONS_CHANNEL,
  MARK_AUTOMATION_RUNS_READ_CHANNEL,
  RESPOND_AUTOMATION_APPROVAL_CHANNEL,
  RUN_AUTOMATION_NOW_CHANNEL,
  SET_AUTOMATION_ENABLED_CHANNEL,
  SET_AUTOMATION_SECRET_CHANNEL,
  type AutomationRevealEvent,
  type AutomationsChangedEvent,
  type PineAutomationsApi,
} from "../shared/automation";
// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import {
  LIST_BACKGROUND_TASKS_CHANNEL,
  READ_BACKGROUND_TASK_OUTPUT_CHANNEL,
  STOP_BACKGROUND_TASK_CHANNEL,
  type BackgroundTaskRequest,
  type BackgroundTaskResult,
  type ListBackgroundTasksResult,
  type ReadBackgroundTaskOutputResult,
} from "../shared/backgroundTasks";
import { GET_EXCHANGE_RATES_CHANNEL } from "../shared/currency";
import { WORKBENCH_STATE_RESPONSE_CHANNEL } from "../shared/workbench";
import {
  LIST_MCP_SERVERS_CHANNEL,
  SAVE_MCP_SERVER_CHANNEL,
  REMOVE_MCP_SERVER_CHANNEL,
} from "../shared/mcp";
import {
  ABORT_SESSION_CHANNEL,
  COMPACT_SESSION_CHANNEL,
  APPROVAL_RESPONSE_CHANNEL,
  QUESTIONNAIRE_RESPONSE_CHANNEL,
  DEQUEUE_STEERING_CHANNEL,
  SEND_STEERING_NOW_CHANNEL,
  PROMPT_SESSION_CHANNEL,
  SET_APPROVAL_MODE_CHANNEL,
  SESSION_EVENT_CHANNEL,
  type AbortSessionResult,
  type SessionControlRequest,
  type CompactSessionResult,
  type DequeueSteeringRequest,
  type DequeueSteeringResult,
  type SendSteeringNowRequest,
  type SendSteeringNowResult,
  type PineSessionEvent,
  type PromptSessionRequest,
  type PromptSessionResult,
  type RespondApprovalRequest,
  type RespondQuestionnaireRequest,
  type SetApprovalModeRequest,
  type SetApprovalModeResult,
  type SessionEventListener,
} from "../shared/agent";
import {
  GET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
  SET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
  GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  GET_DIAGNOSTIC_LOGGING_CHANNEL,
  SET_DIAGNOSTIC_LOGGING_CHANNEL,
  GET_ATTENTION_NOTIFICATIONS_CHANNEL,
  GET_COMPLETION_SIGNAL_CHANNEL,
  SET_ATTENTION_NOTIFICATIONS_CHANNEL,
  SET_COMPLETION_SIGNAL_CHANNEL,
  COMPLETION_SOUND_EVENT_CHANNEL,
  GET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  SET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  type PineAutoApprovalSettings,
  type PineCompletionSignalMode,
  type PineContextCompactionRoute,
  type PineContextCompactionStrategy,
  type SetAttentionNotificationsRequest,
  type SetAttentionNotificationsResult,
  type SetCompletionSignalRequest,
  type SetCompletionSignalResult,
  type SetContextCompactionRouteRequest,
  type SetContextCompactionRouteResult,
  type SetContextCompactionStrategyRequest,
  type SetContextCompactionStrategyResult,
  type SetDiagnosticLoggingRequest,
  type SetDiagnosticLoggingResult,
} from "../shared/preferences";
import {
  GET_APPROXIMATE_LOCATION_CHANNEL,
  SET_APPROXIMATE_LOCATION_CHANNEL,
  type SetApproximateLocationRequest,
  type SetApproximateLocationResult,
} from "../shared/approximateLocation";
import {
  INSPECT_ATTACHMENTS_CHANNEL,
  OPEN_ATTACHMENT_CHANNEL,
  PICK_ATTACHMENT_FOLDERS_CHANNEL,
  PICK_ATTACHMENTS_CHANNEL,
  SAVE_PASTED_ATTACHMENT_CHANNEL,
  type InspectAttachmentsRequest,
  type OpenAttachmentRequest,
  type OpenAttachmentResult,
  type PickAttachmentsResult,
  type SavePastedAttachmentRequest,
  type SavePastedAttachmentResult,
} from "../shared/attachments";
import {
  ADD_CUSTOM_MODEL_CHANNEL,
  CANCEL_PROVIDER_AUTH_CHANNEL,
  DELETE_CUSTOM_MODEL_CHANNEL,
  DELETE_CUSTOM_PROVIDER_CHANNEL,
  GET_MODEL_CATALOG_CHANNEL,
  REFRESH_MODEL_CATALOG_CHANNEL,
  LOGIN_PROVIDER_CHANNEL,
  LOOKUP_MODEL_METADATA_CHANNEL,
  LOGOUT_PROVIDER_CHANNEL,
  OPEN_PROVIDER_AUTH_URL_CHANNEL,
  PROVIDER_AUTH_EVENT_CHANNEL,
  RESPOND_PROVIDER_AUTH_CHANNEL,
  SELECT_MODEL_CHANNEL,
  SELECT_IMAGE_MODEL_CHANNEL,
  SELECT_VIDEO_MODEL_CHANNEL,
  SELECT_APPROVAL_MODEL_CHANNEL,
  SELECT_UTILITY_MODEL_CHANNEL,
  UPDATE_CUSTOM_MODEL_CHANNEL,
  UPDATE_CUSTOM_PROVIDER_CHANNEL,
  type DeleteCustomModelRequest,
  type DeleteCustomProviderRequest,
  type AddCustomModelRequest,
  type LoginProviderRequest,
  type LogoutProviderRequest,
  type LookupModelMetadataRequest,
  type PineModelCatalog,
  type PineModelMetadata,
  type PineProviderAuthEvent,
  type ProviderAuthEventListener,
  type ProviderAuthResponseRequest,
  type ProviderLoginResult,
  type UpdateCustomModelRequest,
  type UpdateCustomProviderRequest,
  type SelectModelRequest,
  type SelectImageModelRequest,
  type SelectVideoModelRequest,
  type SelectApprovalModelRequest,
  type SelectUtilityModelRequest,
} from "../shared/models";
import {
  CREATE_SKILL_CHANNEL,
  EDIT_SKILL_CHANNEL,
  LIST_SKILLS_CHANNEL,
  READ_SKILL_CHANNEL,
  REMOVE_SKILL_CHANNEL,
  SET_GLOBAL_SKILL_ENABLED_CHANNEL,
} from "../shared/skills";
import {
  CREATE_PROJECT_CHANNEL,
  CLOSE_PROJECT_CHANNEL,
  DELETE_PROJECT_CHANNEL,
  LIBRARY_CHANGED_CHANNEL,
  SESSIONS_DELETED_CHANNEL,
  LIST_PROJECTS_CHANNEL,
  OPEN_PROJECT_CHANNEL,
  PICK_PROJECT_FOLDERS_CHANNEL,
  UPDATE_PROJECT_CHANNEL,
  UPDATE_PROJECT_SESSION_GROUPS_CHANNEL,
  CLEAR_PROJECT_STORAGE_CHANNEL,
  PROJECT_STORAGE_CHANNEL,
  type ClearProjectStorageRequest,
  type ProjectStorageResult,
  type ProjectStorageUsage,
  type CreateProjectRequest,
  type DeleteProjectResult,
  type ListProjectsResult,
  type OpenProjectResult,
  type PineDesktopApi,
  type PineLibraryChange,
  type PickProjectFoldersRequest,
  type PickProjectFoldersResult,
  type ProjectIdRequest,
  type ProjectResult,
  type UpdateProjectRequest,
  type UpdateProjectSessionGroupsRequest,
} from "../shared/projects";
import {
  ATTACH_SESSION_CHANNEL,
  DELETE_SESSION_CHANNEL,
  EXPORT_SESSION_CHANNEL,
  LOAD_SESSION_MESSAGES_CHANNEL,
  RENAME_SESSION_CHANNEL,
  RESUME_SESSION_CHANNEL,
  SEARCH_SESSIONS_CHANNEL,
  LIST_ALL_RECENT_SESSIONS_CHANNEL,
  SEARCH_ALL_SESSIONS_CHANNEL,
  type AttachSessionRequest,
  type AttachSessionResult,
  type DeleteSessionRequest,
  type DeleteSessionResult,
  type ExportSessionRequest,
  type ExportSessionResult,
  type LoadSessionMessagesRequest,
  type LoadSessionMessagesResult,
  type RenameSessionRequest,
  type RenameSessionResult,
  type ResumeSessionRequest,
  type ResumeSessionResult,
  type SearchSessionsRequest,
  type SearchSessionsResult,
  type ListAllRecentSessionsResult,
  type SearchAllSessionsRequest,
  type SearchAllSessionsResult,
} from "../shared/sessions";
import {
  PROJECT_FILE_OPERATION_CHANNEL,
  PRESENTED_FILE_OPERATION_CHANNEL,
  PROJECT_FILE_ATTACHMENTS_CHANNEL,
  LIST_PROJECT_DIRECTORY_CHANNEL,
  START_PROJECT_FILE_DRAG_CHANNEL,
  READ_PROJECT_FILE_PREVIEW_CHANNEL,
  READ_PRESENTED_FILE_PREVIEW_CHANNEL,
  REOPEN_PRESENTED_TOOL_FILE_CHANNEL,
  PROJECT_FILES_CHANGED_CHANNEL,
  SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
  SET_WATCHED_FILE_PREVIEW_CHANNEL,
  FILE_PREVIEW_CHANGED_CHANNEL,
  type SetWatchedFilePreviewRequest,
  type FilePreviewChangedEvent,
  type ListProjectDirectoryRequest,
  type ListProjectDirectoryResult,
  type ReopenPresentedToolFileRequest,
  type ProjectFilesChangedEvent,
  type SetWatchedProjectDirectoriesRequest,
} from "../shared/projectFiles";
import {
  SET_SIDEBAR_GLASS_WIDTH_CHANNEL,
  SET_APP_LOCALE_CHANNEL,
  SET_SIDEBAR_VIBRANCY_CHANNEL,
  SET_THEME_SOURCE_CHANNEL,
  CLOSE_TAB_REQUESTED_CHANNEL,
  NEW_TAB_REQUESTED_CHANNEL,
  OPEN_PREFERENCES_SECTION_CHANNEL,
  TAKE_PENDING_PREFERENCES_SECTION_CHANNEL,
  CLOSE_WINDOW_CHANNEL,
  SET_WINDOW_BACKGROUND_CHANNEL,
  SET_WINDOW_LAYOUT_CHANNEL,
  PLAN_WINDOW_RESIZE_CHANNEL,
  COMMIT_WINDOW_RESIZE_CHANNEL,
  WINDOW_RESIZE_STARTED_CHANNEL,
  GET_APP_VERSION_CHANNEL,
  OPEN_EXTERNAL_URL_CHANNEL,
  type PineThemeSource,
  type PineWindowLayout,
  type PineWindowResizeRequest,
  type SetSidebarVibrancyRequest,
  type SetSidebarVibrancyResult,
} from "../shared/window";
import {
  GET_QUICK_COMPOSER_CHANNEL,
  HIDE_QUICK_COMPOSER_CHANNEL,
  PRESENT_QUICK_COMPOSER_HANDOFF_CHANNEL,
  DELIVER_QUICK_COMPOSER_CHANNEL,
  QUICK_COMPOSER_CONTEXT_CHANNEL,
  QUICK_COMPOSER_HIDDEN_CHANNEL,
  QUICK_COMPOSER_SHOWN_CHANNEL,
  REQUEST_QUICK_COMPOSER_PERMISSION_CHANNEL,
  SET_QUICK_COMPOSER_CHANNEL,
  SET_QUICK_COMPOSER_GLASS_CHANNEL,
  SET_QUICK_COMPOSER_PASS_THROUGH_CHANNEL,
  SUBMIT_QUICK_COMPOSER_CHANNEL,
  TAKE_QUICK_COMPOSER_HANDOFF_CHANNEL,
  type QuickComposerContext,
  type QuickComposerHandoff,
  type QuickComposerPermission,
  type QuickComposerRect,
  type QuickComposerShown,
  type SetQuickComposerRequest,
  type SetQuickComposerResult,
  type SubmitQuickComposerRequest,
} from "../shared/quickComposer";
import {
  CHECK_FOR_UPDATE_CHANNEL,
  DOWNLOAD_UPDATE_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  UPDATE_EVENT_CHANNEL,
  type DownloadUpdateResult,
  type InstallUpdateResult,
  type PineUpdateEvent,
  type UpdateCheckResult,
  type UpdateEventListener,
} from "../shared/updates";
import {
  GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL,
  SET_TINYFISH_API_KEY_CHANNEL,
  type SetTinyFishApiKeyRequest,
  type SetTinyFishApiKeyResult,
  type TinyFishCredentialStatus,
} from "../shared/tinyfish";
import {
  GET_USER_PROFILE_CHANNEL,
  SET_USER_PROFILE_CHANNEL,
  type PineUserProfile,
  type SetUserProfileResult,
} from "../shared/userProfile";

export interface PineTransport {
  platform: NodeJS.Platform;
  isQuickComposerHandoff: boolean;
  getPathForFile(file: File): string;
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
  send(channel: string, ...args: unknown[]): void;
  on<T>(channel: string, listener: (event: unknown, value: T) => void): void;
  removeListener<T>(
    channel: string,
    listener: (event: unknown, value: T) => void,
  ): void;
}

/** The same typed application API over Electron IPC or HTTP. */
function createAutomationsApi(transport: PineTransport): PineAutomationsApi {
  const listen =
    <T>(channel: string) =>
    (listener: (event: T) => void): (() => void) => {
      const handler = (_event: unknown, value: T) => listener(value);
      transport.on(channel, handler);
      return () => transport.removeListener(channel, handler);
    };
  return {
    list: (request) =>
      transport.invoke(LIST_AUTOMATIONS_CHANNEL, request ?? {}),
    get: (request) => transport.invoke(GET_AUTOMATION_CHANNEL, request),
    check: (request) => transport.invoke(CHECK_AUTOMATION_CHANNEL, request),
    save: (request) => transport.invoke(SAVE_AUTOMATION_CHANNEL, request),
    runs: (request) =>
      transport.invoke(LIST_AUTOMATION_RUNS_CHANNEL, request ?? {}),
    run: (request) => transport.invoke(GET_AUTOMATION_RUN_CHANNEL, request),
    setEnabled: (request) =>
      transport.invoke(SET_AUTOMATION_ENABLED_CHANNEL, request),
    runNow: (request) => transport.invoke(RUN_AUTOMATION_NOW_CHANNEL, request),
    delete: (request) => transport.invoke(DELETE_AUTOMATION_CHANNEL, request),
    markRunsRead: (request) =>
      transport.invoke(MARK_AUTOMATION_RUNS_READ_CHANNEL, request),
    keepRun: (request) =>
      transport.invoke(KEEP_AUTOMATION_RUN_CHANNEL, request),
    approvals: () => transport.invoke(LIST_AUTOMATION_APPROVALS_CHANNEL),
    respondApproval: (request) =>
      transport.invoke(RESPOND_AUTOMATION_APPROVAL_CHANNEL, request),
    secrets: (request) =>
      transport.invoke(LIST_AUTOMATION_SECRETS_CHANNEL, request),
    setSecret: (request) =>
      transport.invoke(SET_AUTOMATION_SECRET_CHANNEL, request),
    deleteSecret: (request) =>
      transport.invoke(DELETE_AUTOMATION_SECRET_CHANNEL, request),
    onChanged: listen<AutomationsChangedEvent>(AUTOMATIONS_CHANGED_CHANNEL),
    onReveal: listen<AutomationRevealEvent>(AUTOMATIONS_REVEAL_CHANNEL),
  };
}

export function createPineApi(transport: PineTransport): PineDesktopApi {
  return {
    checkForUpdate: (): Promise<UpdateCheckResult> =>
      transport.invoke(CHECK_FOR_UPDATE_CHANNEL),
    readProjectFilePreview: (request) =>
      transport.invoke(READ_PROJECT_FILE_PREVIEW_CHANNEL, request),
    readPresentedFilePreview: (request) =>
      transport.invoke(READ_PRESENTED_FILE_PREVIEW_CHANNEL, request),
    reopenPresentedToolFile: (request: ReopenPresentedToolFileRequest) =>
      transport.invoke(REOPEN_PRESENTED_TOOL_FILE_CHANNEL, request),
    closeWindow: () => transport.invoke(CLOSE_WINDOW_CHANNEL),
    setWindowBackground: (color: string) =>
      transport.invoke(SET_WINDOW_BACKGROUND_CHANNEL, color),
    setWindowLayout: (layout: PineWindowLayout) =>
      transport.invoke(SET_WINDOW_LAYOUT_CHANNEL, layout),
    planWindowResize: (request: PineWindowResizeRequest) =>
      transport.invoke(PLAN_WINDOW_RESIZE_CHANNEL, request),
    commitWindowResize: () => transport.invoke(COMMIT_WINDOW_RESIZE_CHANNEL),
    onWindowResizeStarted: (listener: (startedAt: number) => void) => {
      const handler = (_event: unknown, startedAt: number) =>
        listener(startedAt);
      transport.on(WINDOW_RESIZE_STARTED_CHANNEL, handler);
      return () =>
        transport.removeListener(WINDOW_RESIZE_STARTED_CHANNEL, handler);
    },
    getAppVersion: (): Promise<string> =>
      transport.invoke(GET_APP_VERSION_CHANNEL),
    getExchangeRates: () => transport.invoke(GET_EXCHANGE_RATES_CHANNEL),
    downloadUpdate: (): Promise<DownloadUpdateResult> =>
      transport.invoke(DOWNLOAD_UPDATE_CHANNEL),
    installUpdate: (): Promise<InstallUpdateResult> =>
      transport.invoke(INSTALL_UPDATE_CHANNEL),
    openExternalUrl: (url: string): Promise<void> =>
      transport.invoke(OPEN_EXTERNAL_URL_CHANNEL, url),
    onCloseTabRequested: (listener) => {
      const handler = () => listener();
      transport.on(CLOSE_TAB_REQUESTED_CHANNEL, handler);
      return () =>
        transport.removeListener(CLOSE_TAB_REQUESTED_CHANNEL, handler);
    },
    onNewTabRequested: (listener) => {
      const handler = () => listener();
      transport.on(NEW_TAB_REQUESTED_CHANNEL, handler);
      return () => transport.removeListener(NEW_TAB_REQUESTED_CHANNEL, handler);
    },
    onOpenPreferencesSection: (listener) => {
      const handler = (_event: unknown, section: string) => listener(section);
      transport.on(OPEN_PREFERENCES_SECTION_CHANNEL, handler);
      return () =>
        transport.removeListener(OPEN_PREFERENCES_SECTION_CHANNEL, handler);
    },
    takePendingPreferencesSection: (): Promise<string | null> =>
      transport.invoke(TAKE_PENDING_PREFERENCES_SECTION_CHANNEL),
    onUpdateEvent: (listener: UpdateEventListener) => {
      const handler = (_event: unknown, event: PineUpdateEvent) =>
        listener(event);
      transport.on(UPDATE_EVENT_CHANNEL, handler);
      return () => transport.removeListener(UPDATE_EVENT_CHANNEL, handler);
    },
    platform: transport.platform,
    setThemeSource: (source: PineThemeSource): Promise<void> =>
      transport.invoke(SET_THEME_SOURCE_CHANNEL, source),
    setAppLocale: (locale: string): void =>
      transport.send(SET_APP_LOCALE_CHANNEL, locale),
    setSidebarVibrancy: (
      request: SetSidebarVibrancyRequest,
    ): Promise<SetSidebarVibrancyResult> =>
      transport.invoke(SET_SIDEBAR_VIBRANCY_CHANNEL, request),
    setSidebarGlassWidth: (width: number): void =>
      transport.send(SET_SIDEBAR_GLASS_WIDTH_CHANNEL, width),
    abortSession: (
      request: SessionControlRequest,
    ): Promise<AbortSessionResult> =>
      transport.invoke(ABORT_SESSION_CHANNEL, request),
    listBackgroundTasks: (
      request: SessionControlRequest,
    ): Promise<ListBackgroundTasksResult> =>
      transport.invoke(LIST_BACKGROUND_TASKS_CHANNEL, request),
    stopBackgroundTask: (
      request: BackgroundTaskRequest,
    ): Promise<BackgroundTaskResult> =>
      transport.invoke(STOP_BACKGROUND_TASK_CHANNEL, request),
    readBackgroundTaskOutput: (
      request: BackgroundTaskRequest,
    ): Promise<ReadBackgroundTaskOutputResult> =>
      transport.invoke(READ_BACKGROUND_TASK_OUTPUT_CHANNEL, request),
    attachSession: (
      request: AttachSessionRequest,
    ): Promise<AttachSessionResult> =>
      transport.invoke(ATTACH_SESSION_CHANNEL, request),
    compactSession: (
      request: SessionControlRequest,
    ): Promise<CompactSessionResult> =>
      transport.invoke(COMPACT_SESSION_CHANNEL, request),
    dequeueSteering: (
      request: DequeueSteeringRequest,
    ): Promise<DequeueSteeringResult> =>
      transport.invoke(DEQUEUE_STEERING_CHANNEL, request),
    sendSteeringNow: (
      request: SendSteeringNowRequest,
    ): Promise<SendSteeringNowResult> =>
      transport.invoke(SEND_STEERING_NOW_CHANNEL, request),
    closeProject: (request: ProjectIdRequest): Promise<void> =>
      transport.invoke(CLOSE_PROJECT_CHANNEL, request),
    getProjectStorage: (): Promise<ProjectStorageResult> =>
      transport.invoke(PROJECT_STORAGE_CHANNEL),
    clearProjectStorage: (
      request: ClearProjectStorageRequest,
    ): Promise<ProjectStorageUsage> =>
      transport.invoke(CLEAR_PROJECT_STORAGE_CHANNEL, request),
    createProject: (request: CreateProjectRequest): Promise<ProjectResult> =>
      transport.invoke(CREATE_PROJECT_CHANNEL, request),
    deleteProject: (request: ProjectIdRequest): Promise<DeleteProjectResult> =>
      transport.invoke(DELETE_PROJECT_CHANNEL, request),
    deleteSession: (
      request: DeleteSessionRequest,
    ): Promise<DeleteSessionResult> =>
      transport.invoke(DELETE_SESSION_CHANNEL, request),
    exportSession: (
      request: ExportSessionRequest,
    ): Promise<ExportSessionResult> =>
      transport.invoke(EXPORT_SESSION_CHANNEL, request),
    listProjectDirectory: (
      request: ListProjectDirectoryRequest,
    ): Promise<ListProjectDirectoryResult> =>
      transport.invoke(LIST_PROJECT_DIRECTORY_CHANNEL, request),
    setWatchedProjectDirectories: (
      request: SetWatchedProjectDirectoriesRequest,
    ): Promise<void> =>
      transport.invoke(SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL, request),
    onProjectFilesChanged: (
      listener: (event: ProjectFilesChangedEvent) => void,
    ): (() => void) => {
      const handler = (_: unknown, event: ProjectFilesChangedEvent) =>
        listener(event);
      transport.on(PROJECT_FILES_CHANGED_CHANNEL, handler);
      return () =>
        transport.removeListener(PROJECT_FILES_CHANGED_CHANNEL, handler);
    },
    operateProjectFile: (request) =>
      transport.invoke(PROJECT_FILE_OPERATION_CHANNEL, request),
    operatePresentedFile: (request) =>
      transport.invoke(PRESENTED_FILE_OPERATION_CHANNEL, request),
    setWatchedFilePreview: (
      request: SetWatchedFilePreviewRequest,
    ): Promise<void> =>
      transport.invoke(SET_WATCHED_FILE_PREVIEW_CHANNEL, request),
    onFilePreviewChanged: (
      listener: (event: FilePreviewChangedEvent) => void,
    ): (() => void) => {
      const handler = (_: unknown, event: FilePreviewChangedEvent) =>
        listener(event);
      transport.on(FILE_PREVIEW_CHANGED_CHANNEL, handler);
      return () =>
        transport.removeListener(FILE_PREVIEW_CHANGED_CHANNEL, handler);
    },
    startProjectFileDrag: (request) =>
      transport.send(START_PROJECT_FILE_DRAG_CHANNEL, request),
    inspectProjectAttachments: (entries) =>
      transport.invoke(PROJECT_FILE_ATTACHMENTS_CHANNEL, entries),
    listProjects: (): Promise<ListProjectsResult> =>
      transport.invoke(LIST_PROJECTS_CHANNEL),
    listSkills: (request) => transport.invoke(LIST_SKILLS_CHANNEL, request),
    automations: createAutomationsApi(transport),
    listMcpServers: (request) =>
      transport.invoke(LIST_MCP_SERVERS_CHANNEL, request),
    saveMcpServer: (request) =>
      transport.invoke(SAVE_MCP_SERVER_CHANNEL, request),
    removeMcpServer: (request) =>
      transport.invoke(REMOVE_MCP_SERVER_CHANNEL, request),
    readSkill: (request) => transport.invoke(READ_SKILL_CHANNEL, request),
    createSkill: (request) => transport.invoke(CREATE_SKILL_CHANNEL, request),
    editSkill: (request) => transport.invoke(EDIT_SKILL_CHANNEL, request),
    removeSkill: (request) => transport.invoke(REMOVE_SKILL_CHANNEL, request),
    setGlobalSkillEnabled: (request) =>
      transport.invoke(SET_GLOBAL_SKILL_ENABLED_CHANNEL, request),
    getModelCatalog: (): Promise<PineModelCatalog> =>
      transport.invoke(GET_MODEL_CATALOG_CHANNEL),
    refreshModelCatalog: (): Promise<PineModelCatalog> =>
      transport.invoke(REFRESH_MODEL_CATALOG_CHANNEL),
    lookupModelMetadata: (
      request: LookupModelMetadataRequest,
    ): Promise<PineModelMetadata> =>
      transport.invoke(LOOKUP_MODEL_METADATA_CHANNEL, request),
    addCustomModel: (
      request: AddCustomModelRequest,
    ): Promise<PineModelCatalog> =>
      transport.invoke(ADD_CUSTOM_MODEL_CHANNEL, request),
    updateCustomModel: (
      request: UpdateCustomModelRequest,
    ): Promise<PineModelCatalog> =>
      transport.invoke(UPDATE_CUSTOM_MODEL_CHANNEL, request),
    deleteCustomModel: (
      request: DeleteCustomModelRequest,
    ): Promise<PineModelCatalog> =>
      transport.invoke(DELETE_CUSTOM_MODEL_CHANNEL, request),
    updateCustomProvider: (
      request: UpdateCustomProviderRequest,
    ): Promise<PineModelCatalog> =>
      transport.invoke(UPDATE_CUSTOM_PROVIDER_CHANNEL, request),
    deleteCustomProvider: (
      request: DeleteCustomProviderRequest,
    ): Promise<PineModelCatalog> =>
      transport.invoke(DELETE_CUSTOM_PROVIDER_CHANNEL, request),
    getAutoApprovalSettings: (): Promise<PineAutoApprovalSettings> =>
      transport.invoke(GET_AUTO_APPROVAL_SETTINGS_CHANNEL),
    setAutoApprovalSettings: (
      settings: PineAutoApprovalSettings,
    ): Promise<PineAutoApprovalSettings> =>
      transport.invoke(SET_AUTO_APPROVAL_SETTINGS_CHANNEL, settings),
    getContextCompactionStrategy: (): Promise<PineContextCompactionStrategy> =>
      transport.invoke(GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL),
    getContextCompactionRoute: (): Promise<PineContextCompactionRoute> =>
      transport.invoke(GET_CONTEXT_COMPACTION_ROUTE_CHANNEL),
    getDiagnosticLogging: (): Promise<boolean> =>
      transport.invoke(GET_DIAGNOSTIC_LOGGING_CHANNEL),
    setDiagnosticLogging: (
      request: SetDiagnosticLoggingRequest,
    ): Promise<SetDiagnosticLoggingResult> =>
      transport.invoke(SET_DIAGNOSTIC_LOGGING_CHANNEL, request),
    getApproximateLocation: (): Promise<boolean> =>
      transport.invoke(GET_APPROXIMATE_LOCATION_CHANNEL),
    setApproximateLocation: (
      request: SetApproximateLocationRequest,
    ): Promise<SetApproximateLocationResult> =>
      transport.invoke(SET_APPROXIMATE_LOCATION_CHANNEL, request),
    getAttentionNotifications: (): Promise<boolean> =>
      transport.invoke(GET_ATTENTION_NOTIFICATIONS_CHANNEL),
    setAttentionNotifications: (
      request: SetAttentionNotificationsRequest,
    ): Promise<SetAttentionNotificationsResult> =>
      transport.invoke(SET_ATTENTION_NOTIFICATIONS_CHANNEL, request),
    getCompletionSignal: (): Promise<PineCompletionSignalMode> =>
      transport.invoke(GET_COMPLETION_SIGNAL_CHANNEL),
    setCompletionSignal: (
      request: SetCompletionSignalRequest,
    ): Promise<SetCompletionSignalResult> =>
      transport.invoke(SET_COMPLETION_SIGNAL_CHANNEL, request),
    onCompletionSound: (listener: () => void) => {
      const handler = () => listener();
      transport.on(COMPLETION_SOUND_EVENT_CHANNEL, handler);
      return () =>
        transport.removeListener(COMPLETION_SOUND_EVENT_CHANNEL, handler);
    },
    getQuickComposer: (): Promise<boolean> =>
      transport.invoke(GET_QUICK_COMPOSER_CHANNEL),
    setQuickComposer: (
      request: SetQuickComposerRequest,
    ): Promise<SetQuickComposerResult> =>
      transport.invoke(SET_QUICK_COMPOSER_CHANNEL, request),
    hideQuickComposer: (): Promise<void> =>
      transport.invoke(HIDE_QUICK_COMPOSER_CHANNEL),
    setQuickComposerPassThrough: (passThrough: boolean): Promise<void> =>
      transport.invoke(SET_QUICK_COMPOSER_PASS_THROUGH_CHANNEL, passThrough),
    setQuickComposerGlass: (rect: QuickComposerRect): Promise<boolean> =>
      transport.invoke(SET_QUICK_COMPOSER_GLASS_CHANNEL, rect),
    submitQuickComposer: (
      request: SubmitQuickComposerRequest,
    ): Promise<number | null | undefined> =>
      transport.invoke(SUBMIT_QUICK_COMPOSER_CHANNEL, request),
    onQuickComposerContext: (
      listener: (context: QuickComposerContext) => void,
    ) => {
      const handler = (_event: unknown, context: QuickComposerContext) =>
        listener(context);
      transport.on(QUICK_COMPOSER_CONTEXT_CHANNEL, handler);
      return () =>
        transport.removeListener(QUICK_COMPOSER_CONTEXT_CHANNEL, handler);
    },
    requestQuickComposerPermission: (permission: QuickComposerPermission) =>
      transport.invoke(REQUEST_QUICK_COMPOSER_PERMISSION_CHANNEL, permission),
    onQuickComposerHidden: (listener: () => void) => {
      const handler = () => listener();
      transport.on(QUICK_COMPOSER_HIDDEN_CHANNEL, handler);
      return () =>
        transport.removeListener(QUICK_COMPOSER_HIDDEN_CHANNEL, handler);
    },
    onQuickComposerShown: (listener: (shown: QuickComposerShown) => void) => {
      const handler = (_event: unknown, shown: QuickComposerShown) =>
        listener(shown);
      transport.on(QUICK_COMPOSER_SHOWN_CHANNEL, handler);
      return () =>
        transport.removeListener(QUICK_COMPOSER_SHOWN_CHANNEL, handler);
    },
    isQuickComposerHandoff: transport.isQuickComposerHandoff,
    takeQuickComposerHandoff: (): Promise<QuickComposerHandoff | null> =>
      transport.invoke(TAKE_QUICK_COMPOSER_HANDOFF_CHANNEL),
    presentQuickComposerHandoff: (
      composerRect: QuickComposerRect,
    ): Promise<void> =>
      transport.invoke(PRESENT_QUICK_COMPOSER_HANDOFF_CHANNEL, composerRect),
    onQuickComposerDelivered: (
      listener: (handoff: QuickComposerHandoff) => void,
    ) => {
      const handler = (_event: unknown, handoff: QuickComposerHandoff) =>
        listener(handoff);
      transport.on(DELIVER_QUICK_COMPOSER_CHANNEL, handler);
      return () =>
        transport.removeListener(DELIVER_QUICK_COMPOSER_CHANNEL, handler);
    },
    getUserProfile: (): Promise<PineUserProfile> =>
      transport.invoke(GET_USER_PROFILE_CHANNEL),
    getTinyFishCredentialStatus: (): Promise<TinyFishCredentialStatus> =>
      transport.invoke(GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL),
    getPathForFile: (file: File): string => transport.getPathForFile(file),
    inspectAttachments: (
      request: InspectAttachmentsRequest,
    ): Promise<PickAttachmentsResult> =>
      transport.invoke(INSPECT_ATTACHMENTS_CHANNEL, request),
    openAttachment: (
      request: OpenAttachmentRequest,
    ): Promise<OpenAttachmentResult> =>
      transport.invoke(OPEN_ATTACHMENT_CHANNEL, request),
    savePastedAttachment: (
      request: SavePastedAttachmentRequest,
    ): Promise<SavePastedAttachmentResult> =>
      transport.invoke(SAVE_PASTED_ATTACHMENT_CHANNEL, request),
    loginProvider: (
      request: LoginProviderRequest,
    ): Promise<ProviderLoginResult> =>
      transport.invoke(LOGIN_PROVIDER_CHANNEL, request),
    respondToProviderAuth: (
      request: ProviderAuthResponseRequest,
    ): Promise<{ accepted: boolean }> =>
      transport.invoke(RESPOND_PROVIDER_AUTH_CHANNEL, request),
    cancelProviderAuth: (request: {
      loginId: string;
    }): Promise<{ cancelled: boolean }> =>
      transport.invoke(CANCEL_PROVIDER_AUTH_CHANNEL, request),
    logoutProvider: (
      request: LogoutProviderRequest,
    ): Promise<{ disposed: boolean }> =>
      transport.invoke(LOGOUT_PROVIDER_CHANNEL, request),
    selectModel: (
      request: SelectModelRequest,
    ): Promise<{ disposed: boolean }> =>
      transport.invoke(SELECT_MODEL_CHANNEL, request),
    selectUtilityModel: (
      request: SelectUtilityModelRequest,
    ): Promise<{ updated: boolean }> =>
      transport.invoke(SELECT_UTILITY_MODEL_CHANNEL, request),
    selectApprovalModel: (
      request: SelectApprovalModelRequest,
    ): Promise<{ updated: boolean }> =>
      transport.invoke(SELECT_APPROVAL_MODEL_CHANNEL, request),
    selectImageModel: (
      request: SelectImageModelRequest,
    ): Promise<{ updated: boolean }> =>
      transport.invoke(SELECT_IMAGE_MODEL_CHANNEL, request),
    selectVideoModel: (
      request: SelectVideoModelRequest,
    ): Promise<{ updated: boolean }> =>
      transport.invoke(SELECT_VIDEO_MODEL_CHANNEL, request),
    openProviderAuthUrl: (url: string): Promise<void> =>
      transport.invoke(OPEN_PROVIDER_AUTH_URL_CHANNEL, url),
    setTinyFishApiKey: (
      request: SetTinyFishApiKeyRequest,
    ): Promise<SetTinyFishApiKeyResult> =>
      transport.invoke(SET_TINYFISH_API_KEY_CHANNEL, request),
    setContextCompactionStrategy: (
      request: SetContextCompactionStrategyRequest,
    ): Promise<SetContextCompactionStrategyResult> =>
      transport.invoke(SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL, request),
    setContextCompactionRoute: (
      request: SetContextCompactionRouteRequest,
    ): Promise<SetContextCompactionRouteResult> =>
      transport.invoke(SET_CONTEXT_COMPACTION_ROUTE_CHANNEL, request),
    setUserProfile: (profile: PineUserProfile): Promise<SetUserProfileResult> =>
      transport.invoke(SET_USER_PROFILE_CHANNEL, profile),
    onProviderAuthEvent: (
      listener: ProviderAuthEventListener,
    ): (() => void) => {
      const handler = (_event: unknown, event: PineProviderAuthEvent) =>
        listener(event);
      transport.on(PROVIDER_AUTH_EVENT_CHANNEL, handler);
      return () =>
        transport.removeListener(PROVIDER_AUTH_EVENT_CHANNEL, handler);
    },
    loadSessionMessages: (
      request: LoadSessionMessagesRequest,
    ): Promise<LoadSessionMessagesResult> =>
      transport.invoke(LOAD_SESSION_MESSAGES_CHANNEL, request),
    openProject: (request: ProjectIdRequest): Promise<OpenProjectResult> =>
      transport.invoke(OPEN_PROJECT_CHANNEL, request),
    pickAttachments: (): Promise<PickAttachmentsResult> =>
      transport.invoke(PICK_ATTACHMENTS_CHANNEL),
    pickAttachmentFolders: (): Promise<PickAttachmentsResult> =>
      transport.invoke(PICK_ATTACHMENT_FOLDERS_CHANNEL),
    pickProjectFolders: (
      request: PickProjectFoldersRequest,
    ): Promise<PickProjectFoldersResult> =>
      transport.invoke(PICK_PROJECT_FOLDERS_CHANNEL, request),
    promptSession: (
      request: PromptSessionRequest,
    ): Promise<PromptSessionResult> =>
      transport.invoke(PROMPT_SESSION_CHANNEL, request),
    resumeSession: (
      request: ResumeSessionRequest,
    ): Promise<ResumeSessionResult> =>
      transport.invoke(RESUME_SESSION_CHANNEL, request),
    renameSession: (
      request: RenameSessionRequest,
    ): Promise<RenameSessionResult> =>
      transport.invoke(RENAME_SESSION_CHANNEL, request),
    searchSessions: (
      request: SearchSessionsRequest,
    ): Promise<SearchSessionsResult> =>
      transport.invoke(SEARCH_SESSIONS_CHANNEL, request),
    listAllRecentSessions: (): Promise<ListAllRecentSessionsResult> =>
      transport.invoke(LIST_ALL_RECENT_SESSIONS_CHANNEL),
    searchAllSessions: (
      request: SearchAllSessionsRequest,
    ): Promise<SearchAllSessionsResult> =>
      transport.invoke(SEARCH_ALL_SESSIONS_CHANNEL, request),
    listSideChats: (request) =>
      transport.invoke(LIST_SIDE_CHATS_CHANNEL, request),
    openSideChat: (request) =>
      transport.invoke(OPEN_SIDE_CHAT_CHANNEL, request),
    promptSideChat: (request) =>
      transport.invoke(PROMPT_SIDE_CHAT_CHANNEL, request),
    abortSideChat: (request) =>
      transport.invoke(ABORT_SIDE_CHAT_CHANNEL, request),
    closeSideChat: (request) =>
      transport.invoke(CLOSE_SIDE_CHAT_CHANNEL, request),
    deleteSideChat: (request) =>
      transport.invoke(DELETE_SIDE_CHAT_CHANNEL, request),
    onSideChatEvent: (listener) => {
      const handler = (_event: unknown, event: PineAgentEvent) =>
        listener(event);
      transport.on(SIDE_CHAT_EVENT_CHANNEL, handler);
      return () => transport.removeListener(SIDE_CHAT_EVENT_CHANNEL, handler);
    },
    respondWorkbenchState: (response): void =>
      transport.send(WORKBENCH_STATE_RESPONSE_CHANNEL, response),
    onLibraryChanged: (listener: (change: PineLibraryChange) => void) => {
      const handler = (_event: unknown, change: PineLibraryChange) =>
        listener(change);
      transport.on(LIBRARY_CHANGED_CHANNEL, handler);
      return () => transport.removeListener(LIBRARY_CHANGED_CHANNEL, handler);
    },
    onSessionsDeleted: (listener: (sessionIds: string[]) => void) => {
      const handler = (_event: unknown, sessionIds: string[]) =>
        listener(sessionIds);
      transport.on(SESSIONS_DELETED_CHANNEL, handler);
      return () => transport.removeListener(SESSIONS_DELETED_CHANNEL, handler);
    },
    onSessionEvent: (listener: SessionEventListener): (() => void) => {
      const handler = (
        _event: unknown,
        // Main enriches present-file events with the resolved tab target before
        // forwarding, so the renderer never sees an unresolved request.
        event: PineSessionEvent,
      ) => listener(event);
      transport.on(SESSION_EVENT_CHANNEL, handler);
      return () => transport.removeListener(SESSION_EVENT_CHANNEL, handler);
    },
    respondApproval: (
      request: RespondApprovalRequest,
    ): Promise<{ accepted: boolean }> =>
      transport.invoke(APPROVAL_RESPONSE_CHANNEL, request),
    respondQuestionnaire: (
      request: RespondQuestionnaireRequest,
    ): Promise<{ accepted: boolean }> =>
      transport.invoke(QUESTIONNAIRE_RESPONSE_CHANNEL, request),
    setApprovalMode: (
      request: SetApprovalModeRequest,
    ): Promise<SetApprovalModeResult> =>
      transport.invoke(SET_APPROVAL_MODE_CHANNEL, request),
    updateProject: (request: UpdateProjectRequest): Promise<ProjectResult> =>
      transport.invoke(UPDATE_PROJECT_CHANNEL, request),
    updateProjectSessionGroups: (
      request: UpdateProjectSessionGroupsRequest,
    ): Promise<ProjectResult> =>
      transport.invoke(UPDATE_PROJECT_SESSION_GROUPS_CHANNEL, request),
  };
}
