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
} from "./shared/backgroundTasks";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  LIST_MCP_SERVERS_CHANNEL,
  SAVE_MCP_SERVER_CHANNEL,
  REMOVE_MCP_SERVER_CHANNEL,
} from "./shared/mcp";
import {
  ABORT_SESSION_CHANNEL,
  COMPACT_SESSION_CHANNEL,
  APPROVAL_RESPONSE_CHANNEL,
  QUESTIONNAIRE_RESPONSE_CHANNEL,
  DEQUEUE_STEERING_CHANNEL,
  PROMPT_SESSION_CHANNEL,
  SET_APPROVAL_MODE_CHANNEL,
  SESSION_EVENT_CHANNEL,
  type AbortSessionResult,
  type SessionControlRequest,
  type CompactSessionResult,
  type DequeueSteeringRequest,
  type DequeueSteeringResult,
  type PineSessionEvent,
  type PromptSessionRequest,
  type PromptSessionResult,
  type RespondApprovalRequest,
  type RespondQuestionnaireRequest,
  type SetApprovalModeRequest,
  type SetApprovalModeResult,
  type SessionEventListener,
} from "./shared/agent";
import {
  GET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
  SET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
  GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  GET_DIAGNOSTIC_LOGGING_CHANNEL,
  SET_DIAGNOSTIC_LOGGING_CHANNEL,
  GET_COMPLETION_SIGNAL_CHANNEL,
  SET_COMPLETION_SIGNAL_CHANNEL,
  GET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  SET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  type PineAutoApprovalSettings,
  type PineContextCompactionRoute,
  type PineContextCompactionStrategy,
  type SetCompletionSignalRequest,
  type SetCompletionSignalResult,
  type SetContextCompactionRouteRequest,
  type SetContextCompactionRouteResult,
  type SetContextCompactionStrategyRequest,
  type SetContextCompactionStrategyResult,
  type SetDiagnosticLoggingRequest,
  type SetDiagnosticLoggingResult,
} from "./shared/preferences";
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
} from "./shared/attachments";
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
  type SelectUtilityModelRequest,
} from "./shared/models";
import {
  CREATE_SKILL_CHANNEL,
  EDIT_SKILL_CHANNEL,
  LIST_SKILLS_CHANNEL,
  READ_SKILL_CHANNEL,
  REMOVE_SKILL_CHANNEL,
  SET_GLOBAL_SKILL_ENABLED_CHANNEL,
} from "./shared/skills";
import {
  CREATE_PROJECT_CHANNEL,
  CLOSE_PROJECT_CHANNEL,
  DELETE_PROJECT_CHANNEL,
  LIST_PROJECTS_CHANNEL,
  OPEN_PROJECT_CHANNEL,
  PICK_PROJECT_FOLDERS_CHANNEL,
  UPDATE_PROJECT_CHANNEL,
  UPDATE_PROJECT_SESSION_GROUPS_CHANNEL,
  type CreateProjectRequest,
  type DeleteProjectResult,
  type ListProjectsResult,
  type OpenProjectResult,
  type PineDesktopApi,
  type PickProjectFoldersRequest,
  type PickProjectFoldersResult,
  type ProjectIdRequest,
  type ProjectResult,
  type UpdateProjectRequest,
  type UpdateProjectSessionGroupsRequest,
} from "./shared/projects";
import {
  ATTACH_SESSION_CHANNEL,
  DELETE_SESSION_CHANNEL,
  EXPORT_SESSION_CHANNEL,
  LOAD_SESSION_MESSAGES_CHANNEL,
  RENAME_SESSION_CHANNEL,
  RESUME_SESSION_CHANNEL,
  SEARCH_SESSIONS_CHANNEL,
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
} from "./shared/sessions";
import {
  PROJECT_FILE_OPERATION_CHANNEL,
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
} from "./shared/projectFiles";
import {
  SET_SIDEBAR_VIBRANCY_CHANNEL,
  CLOSE_TAB_REQUESTED_CHANNEL,
  NEW_TAB_REQUESTED_CHANNEL,
  CLOSE_WINDOW_CHANNEL,
  SET_WINDOW_BACKGROUND_CHANNEL,
  SET_WINDOW_LAYOUT_CHANNEL,
  PLAN_WINDOW_RESIZE_CHANNEL,
  COMMIT_WINDOW_RESIZE_CHANNEL,
  WINDOW_RESIZE_STARTED_CHANNEL,
  GET_APP_VERSION_CHANNEL,
  OPEN_EXTERNAL_URL_CHANNEL,
  type PineWindowLayout,
  type PineWindowResizeRequest,
  type SetSidebarVibrancyRequest,
  type SetSidebarVibrancyResult,
} from "./shared/window";
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
} from "./shared/updates";
import {
  GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL,
  SET_TINYFISH_API_KEY_CHANNEL,
  type SetTinyFishApiKeyRequest,
  type SetTinyFishApiKeyResult,
  type TinyFishCredentialStatus,
} from "./shared/tinyfish";
import {
  GET_USER_PROFILE_CHANNEL,
  SET_USER_PROFILE_CHANNEL,
  type PineUserProfile,
  type SetUserProfileResult,
} from "./shared/userProfile";

const pineApi: PineDesktopApi = {
  checkForUpdate: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke(CHECK_FOR_UPDATE_CHANNEL),
  readProjectFilePreview: (request) =>
    ipcRenderer.invoke(READ_PROJECT_FILE_PREVIEW_CHANNEL, request),
  readPresentedFilePreview: (request) =>
    ipcRenderer.invoke(READ_PRESENTED_FILE_PREVIEW_CHANNEL, request),
  reopenPresentedToolFile: (request: ReopenPresentedToolFileRequest) =>
    ipcRenderer.invoke(REOPEN_PRESENTED_TOOL_FILE_CHANNEL, request),
  closeWindow: () => ipcRenderer.invoke(CLOSE_WINDOW_CHANNEL),
  setWindowBackground: (color: string) =>
    ipcRenderer.invoke(SET_WINDOW_BACKGROUND_CHANNEL, color),
  setWindowLayout: (layout: PineWindowLayout) =>
    ipcRenderer.invoke(SET_WINDOW_LAYOUT_CHANNEL, layout),
  planWindowResize: (request: PineWindowResizeRequest) =>
    ipcRenderer.invoke(PLAN_WINDOW_RESIZE_CHANNEL, request),
  commitWindowResize: () => ipcRenderer.invoke(COMMIT_WINDOW_RESIZE_CHANNEL),
  onWindowResizeStarted: (listener: (startedAt: number) => void) => {
    const handler = (_event: unknown, startedAt: number) => listener(startedAt);
    ipcRenderer.on(WINDOW_RESIZE_STARTED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(WINDOW_RESIZE_STARTED_CHANNEL, handler);
  },
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(GET_APP_VERSION_CHANNEL),
  downloadUpdate: (): Promise<DownloadUpdateResult> =>
    ipcRenderer.invoke(DOWNLOAD_UPDATE_CHANNEL),
  installUpdate: (): Promise<InstallUpdateResult> =>
    ipcRenderer.invoke(INSTALL_UPDATE_CHANNEL),
  openExternalUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke(OPEN_EXTERNAL_URL_CHANNEL, url),
  onCloseTabRequested: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(CLOSE_TAB_REQUESTED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(CLOSE_TAB_REQUESTED_CHANNEL, handler);
  },
  onNewTabRequested: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(NEW_TAB_REQUESTED_CHANNEL, handler);
    return () => ipcRenderer.removeListener(NEW_TAB_REQUESTED_CHANNEL, handler);
  },
  onUpdateEvent: (listener: UpdateEventListener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      event: PineUpdateEvent,
    ) => listener(event);
    ipcRenderer.on(UPDATE_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(UPDATE_EVENT_CHANNEL, handler);
  },
  platform: process.platform,
  setSidebarVibrancy: (
    request: SetSidebarVibrancyRequest,
  ): Promise<SetSidebarVibrancyResult> =>
    ipcRenderer.invoke(SET_SIDEBAR_VIBRANCY_CHANNEL, request),
  abortSession: (request: SessionControlRequest): Promise<AbortSessionResult> =>
    ipcRenderer.invoke(ABORT_SESSION_CHANNEL, request),
  listBackgroundTasks: (
    request: SessionControlRequest,
  ): Promise<ListBackgroundTasksResult> =>
    ipcRenderer.invoke(LIST_BACKGROUND_TASKS_CHANNEL, request),
  stopBackgroundTask: (
    request: BackgroundTaskRequest,
  ): Promise<BackgroundTaskResult> =>
    ipcRenderer.invoke(STOP_BACKGROUND_TASK_CHANNEL, request),
  readBackgroundTaskOutput: (
    request: BackgroundTaskRequest,
  ): Promise<ReadBackgroundTaskOutputResult> =>
    ipcRenderer.invoke(READ_BACKGROUND_TASK_OUTPUT_CHANNEL, request),
  attachSession: (
    request: AttachSessionRequest,
  ): Promise<AttachSessionResult> =>
    ipcRenderer.invoke(ATTACH_SESSION_CHANNEL, request),
  compactSession: (
    request: SessionControlRequest,
  ): Promise<CompactSessionResult> =>
    ipcRenderer.invoke(COMPACT_SESSION_CHANNEL, request),
  dequeueSteering: (
    request: DequeueSteeringRequest,
  ): Promise<DequeueSteeringResult> =>
    ipcRenderer.invoke(DEQUEUE_STEERING_CHANNEL, request),
  closeProject: (request: ProjectIdRequest): Promise<void> =>
    ipcRenderer.invoke(CLOSE_PROJECT_CHANNEL, request),
  createProject: (request: CreateProjectRequest): Promise<ProjectResult> =>
    ipcRenderer.invoke(CREATE_PROJECT_CHANNEL, request),
  deleteProject: (request: ProjectIdRequest): Promise<DeleteProjectResult> =>
    ipcRenderer.invoke(DELETE_PROJECT_CHANNEL, request),
  deleteSession: (
    request: DeleteSessionRequest,
  ): Promise<DeleteSessionResult> =>
    ipcRenderer.invoke(DELETE_SESSION_CHANNEL, request),
  exportSession: (
    request: ExportSessionRequest,
  ): Promise<ExportSessionResult> =>
    ipcRenderer.invoke(EXPORT_SESSION_CHANNEL, request),
  listProjectDirectory: (
    request: ListProjectDirectoryRequest,
  ): Promise<ListProjectDirectoryResult> =>
    ipcRenderer.invoke(LIST_PROJECT_DIRECTORY_CHANNEL, request),
  setWatchedProjectDirectories: (
    request: SetWatchedProjectDirectoriesRequest,
  ): Promise<void> =>
    ipcRenderer.invoke(SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL, request),
  onProjectFilesChanged: (
    listener: (event: ProjectFilesChangedEvent) => void,
  ): (() => void) => {
    const handler = (_: unknown, event: ProjectFilesChangedEvent) =>
      listener(event);
    ipcRenderer.on(PROJECT_FILES_CHANGED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(PROJECT_FILES_CHANGED_CHANNEL, handler);
  },
  operateProjectFile: (request) =>
    ipcRenderer.invoke(PROJECT_FILE_OPERATION_CHANNEL, request),
  setWatchedFilePreview: (
    request: SetWatchedFilePreviewRequest,
  ): Promise<void> =>
    ipcRenderer.invoke(SET_WATCHED_FILE_PREVIEW_CHANNEL, request),
  onFilePreviewChanged: (
    listener: (event: FilePreviewChangedEvent) => void,
  ): (() => void) => {
    const handler = (_: unknown, event: FilePreviewChangedEvent) =>
      listener(event);
    ipcRenderer.on(FILE_PREVIEW_CHANGED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(FILE_PREVIEW_CHANGED_CHANNEL, handler);
  },
  startProjectFileDrag: (request) =>
    ipcRenderer.send(START_PROJECT_FILE_DRAG_CHANNEL, request),
  inspectProjectAttachments: (entries) =>
    ipcRenderer.invoke(PROJECT_FILE_ATTACHMENTS_CHANNEL, entries),
  listProjects: (): Promise<ListProjectsResult> =>
    ipcRenderer.invoke(LIST_PROJECTS_CHANNEL),
  listSkills: (request) => ipcRenderer.invoke(LIST_SKILLS_CHANNEL, request),
  listMcpServers: (request) =>
    ipcRenderer.invoke(LIST_MCP_SERVERS_CHANNEL, request),
  saveMcpServer: (request) =>
    ipcRenderer.invoke(SAVE_MCP_SERVER_CHANNEL, request),
  removeMcpServer: (request) =>
    ipcRenderer.invoke(REMOVE_MCP_SERVER_CHANNEL, request),
  readSkill: (request) => ipcRenderer.invoke(READ_SKILL_CHANNEL, request),
  createSkill: (request) => ipcRenderer.invoke(CREATE_SKILL_CHANNEL, request),
  editSkill: (request) => ipcRenderer.invoke(EDIT_SKILL_CHANNEL, request),
  removeSkill: (request) => ipcRenderer.invoke(REMOVE_SKILL_CHANNEL, request),
  setGlobalSkillEnabled: (request) =>
    ipcRenderer.invoke(SET_GLOBAL_SKILL_ENABLED_CHANNEL, request),
  getModelCatalog: (): Promise<PineModelCatalog> =>
    ipcRenderer.invoke(GET_MODEL_CATALOG_CHANNEL),
  refreshModelCatalog: (): Promise<PineModelCatalog> =>
    ipcRenderer.invoke(REFRESH_MODEL_CATALOG_CHANNEL),
  lookupModelMetadata: (
    request: LookupModelMetadataRequest,
  ): Promise<PineModelMetadata> =>
    ipcRenderer.invoke(LOOKUP_MODEL_METADATA_CHANNEL, request),
  addCustomModel: (request: AddCustomModelRequest): Promise<PineModelCatalog> =>
    ipcRenderer.invoke(ADD_CUSTOM_MODEL_CHANNEL, request),
  updateCustomModel: (
    request: UpdateCustomModelRequest,
  ): Promise<PineModelCatalog> =>
    ipcRenderer.invoke(UPDATE_CUSTOM_MODEL_CHANNEL, request),
  deleteCustomModel: (
    request: DeleteCustomModelRequest,
  ): Promise<PineModelCatalog> =>
    ipcRenderer.invoke(DELETE_CUSTOM_MODEL_CHANNEL, request),
  updateCustomProvider: (
    request: UpdateCustomProviderRequest,
  ): Promise<PineModelCatalog> =>
    ipcRenderer.invoke(UPDATE_CUSTOM_PROVIDER_CHANNEL, request),
  deleteCustomProvider: (
    request: DeleteCustomProviderRequest,
  ): Promise<PineModelCatalog> =>
    ipcRenderer.invoke(DELETE_CUSTOM_PROVIDER_CHANNEL, request),
  getAutoApprovalSettings: (): Promise<PineAutoApprovalSettings> =>
    ipcRenderer.invoke(GET_AUTO_APPROVAL_SETTINGS_CHANNEL),
  setAutoApprovalSettings: (
    settings: PineAutoApprovalSettings,
  ): Promise<PineAutoApprovalSettings> =>
    ipcRenderer.invoke(SET_AUTO_APPROVAL_SETTINGS_CHANNEL, settings),
  getContextCompactionStrategy: (): Promise<PineContextCompactionStrategy> =>
    ipcRenderer.invoke(GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL),
  getContextCompactionRoute: (): Promise<PineContextCompactionRoute> =>
    ipcRenderer.invoke(GET_CONTEXT_COMPACTION_ROUTE_CHANNEL),
  getDiagnosticLogging: (): Promise<boolean> =>
    ipcRenderer.invoke(GET_DIAGNOSTIC_LOGGING_CHANNEL),
  setDiagnosticLogging: (
    request: SetDiagnosticLoggingRequest,
  ): Promise<SetDiagnosticLoggingResult> =>
    ipcRenderer.invoke(SET_DIAGNOSTIC_LOGGING_CHANNEL, request),
  getCompletionSignal: (): Promise<boolean> =>
    ipcRenderer.invoke(GET_COMPLETION_SIGNAL_CHANNEL),
  setCompletionSignal: (
    request: SetCompletionSignalRequest,
  ): Promise<SetCompletionSignalResult> =>
    ipcRenderer.invoke(SET_COMPLETION_SIGNAL_CHANNEL, request),
  getUserProfile: (): Promise<PineUserProfile> =>
    ipcRenderer.invoke(GET_USER_PROFILE_CHANNEL),
  getTinyFishCredentialStatus: (): Promise<TinyFishCredentialStatus> =>
    ipcRenderer.invoke(GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  inspectAttachments: (
    request: InspectAttachmentsRequest,
  ): Promise<PickAttachmentsResult> =>
    ipcRenderer.invoke(INSPECT_ATTACHMENTS_CHANNEL, request),
  openAttachment: (
    request: OpenAttachmentRequest,
  ): Promise<OpenAttachmentResult> =>
    ipcRenderer.invoke(OPEN_ATTACHMENT_CHANNEL, request),
  savePastedAttachment: (
    request: SavePastedAttachmentRequest,
  ): Promise<SavePastedAttachmentResult> =>
    ipcRenderer.invoke(SAVE_PASTED_ATTACHMENT_CHANNEL, request),
  loginProvider: (
    request: LoginProviderRequest,
  ): Promise<ProviderLoginResult> =>
    ipcRenderer.invoke(LOGIN_PROVIDER_CHANNEL, request),
  respondToProviderAuth: (
    request: ProviderAuthResponseRequest,
  ): Promise<{ accepted: boolean }> =>
    ipcRenderer.invoke(RESPOND_PROVIDER_AUTH_CHANNEL, request),
  cancelProviderAuth: (request: {
    loginId: string;
  }): Promise<{ cancelled: boolean }> =>
    ipcRenderer.invoke(CANCEL_PROVIDER_AUTH_CHANNEL, request),
  logoutProvider: (
    request: LogoutProviderRequest,
  ): Promise<{ disposed: boolean }> =>
    ipcRenderer.invoke(LOGOUT_PROVIDER_CHANNEL, request),
  selectModel: (request: SelectModelRequest): Promise<{ disposed: boolean }> =>
    ipcRenderer.invoke(SELECT_MODEL_CHANNEL, request),
  selectUtilityModel: (
    request: SelectUtilityModelRequest,
  ): Promise<{ updated: boolean }> =>
    ipcRenderer.invoke(SELECT_UTILITY_MODEL_CHANNEL, request),
  selectImageModel: (
    request: SelectImageModelRequest,
  ): Promise<{ updated: boolean }> =>
    ipcRenderer.invoke(SELECT_IMAGE_MODEL_CHANNEL, request),
  openProviderAuthUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke(OPEN_PROVIDER_AUTH_URL_CHANNEL, url),
  setTinyFishApiKey: (
    request: SetTinyFishApiKeyRequest,
  ): Promise<SetTinyFishApiKeyResult> =>
    ipcRenderer.invoke(SET_TINYFISH_API_KEY_CHANNEL, request),
  setContextCompactionStrategy: (
    request: SetContextCompactionStrategyRequest,
  ): Promise<SetContextCompactionStrategyResult> =>
    ipcRenderer.invoke(SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL, request),
  setContextCompactionRoute: (
    request: SetContextCompactionRouteRequest,
  ): Promise<SetContextCompactionRouteResult> =>
    ipcRenderer.invoke(SET_CONTEXT_COMPACTION_ROUTE_CHANNEL, request),
  setUserProfile: (profile: PineUserProfile): Promise<SetUserProfileResult> =>
    ipcRenderer.invoke(SET_USER_PROFILE_CHANNEL, profile),
  onProviderAuthEvent: (listener: ProviderAuthEventListener): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      event: PineProviderAuthEvent,
    ) => listener(event);
    ipcRenderer.on(PROVIDER_AUTH_EVENT_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(PROVIDER_AUTH_EVENT_CHANNEL, handler);
  },
  loadSessionMessages: (
    request: LoadSessionMessagesRequest,
  ): Promise<LoadSessionMessagesResult> =>
    ipcRenderer.invoke(LOAD_SESSION_MESSAGES_CHANNEL, request),
  openProject: (request: ProjectIdRequest): Promise<OpenProjectResult> =>
    ipcRenderer.invoke(OPEN_PROJECT_CHANNEL, request),
  pickAttachments: (): Promise<PickAttachmentsResult> =>
    ipcRenderer.invoke(PICK_ATTACHMENTS_CHANNEL),
  pickAttachmentFolders: (): Promise<PickAttachmentsResult> =>
    ipcRenderer.invoke(PICK_ATTACHMENT_FOLDERS_CHANNEL),
  pickProjectFolders: (
    request: PickProjectFoldersRequest,
  ): Promise<PickProjectFoldersResult> =>
    ipcRenderer.invoke(PICK_PROJECT_FOLDERS_CHANNEL, request),
  promptSession: (
    request: PromptSessionRequest,
  ): Promise<PromptSessionResult> =>
    ipcRenderer.invoke(PROMPT_SESSION_CHANNEL, request),
  resumeSession: (
    request: ResumeSessionRequest,
  ): Promise<ResumeSessionResult> =>
    ipcRenderer.invoke(RESUME_SESSION_CHANNEL, request),
  renameSession: (
    request: RenameSessionRequest,
  ): Promise<RenameSessionResult> =>
    ipcRenderer.invoke(RENAME_SESSION_CHANNEL, request),
  searchSessions: (
    request: SearchSessionsRequest,
  ): Promise<SearchSessionsResult> =>
    ipcRenderer.invoke(SEARCH_SESSIONS_CHANNEL, request),
  onSessionEvent: (listener: SessionEventListener): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      // Main enriches present-file events with the resolved tab target before
      // forwarding, so the renderer never sees an unresolved request.
      event: PineSessionEvent,
    ) => listener(event);
    ipcRenderer.on(SESSION_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(SESSION_EVENT_CHANNEL, handler);
  },
  respondApproval: (
    request: RespondApprovalRequest,
  ): Promise<{ accepted: boolean }> =>
    ipcRenderer.invoke(APPROVAL_RESPONSE_CHANNEL, request),
  respondQuestionnaire: (
    request: RespondQuestionnaireRequest,
  ): Promise<{ accepted: boolean }> =>
    ipcRenderer.invoke(QUESTIONNAIRE_RESPONSE_CHANNEL, request),
  setApprovalMode: (
    request: SetApprovalModeRequest,
  ): Promise<SetApprovalModeResult> =>
    ipcRenderer.invoke(SET_APPROVAL_MODE_CHANNEL, request),
  updateProject: (request: UpdateProjectRequest): Promise<ProjectResult> =>
    ipcRenderer.invoke(UPDATE_PROJECT_CHANNEL, request),
  updateProjectSessionGroups: (
    request: UpdateProjectSessionGroupsRequest,
  ): Promise<ProjectResult> =>
    ipcRenderer.invoke(UPDATE_PROJECT_SESSION_GROUPS_CHANNEL, request),
};

contextBridge.exposeInMainWorld("pine", pineApi);

declare global {
  interface Window {
    pine: PineDesktopApi;
  }
}
