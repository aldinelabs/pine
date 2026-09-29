import type {
  AbortSessionResult,
  SessionControlRequest,
  CompactSessionResult,
  DequeueSteeringRequest,
  DequeueSteeringResult,
  PromptSessionRequest,
  PromptSessionResult,
  RespondApprovalRequest,
  RespondQuestionnaireRequest,
  SetApprovalModeRequest,
  SetApprovalModeResult,
  SessionEventListener,
} from "./agent";
import type {
  PineContextCompactionStrategy,
  SetContextCompactionStrategyRequest,
  SetContextCompactionStrategyResult,
  SetDiagnosticLoggingRequest,
  SetDiagnosticLoggingResult,
} from "./preferences";
import type {
  InspectAttachmentsRequest,
  OpenAttachmentRequest,
  OpenAttachmentResult,
  PickAttachmentsResult,
  SavePastedAttachmentRequest,
  SavePastedAttachmentResult,
} from "./attachments";
import type {
  AddCustomModelRequest,
  DeleteCustomModelRequest,
  DeleteCustomProviderRequest,
  LoginProviderRequest,
  LogoutProviderRequest,
  LookupModelMetadataRequest,
  PineModelCatalog,
  PineModelMetadata,
  ProviderAuthEventListener,
  ProviderAuthResponseRequest,
  ProviderLoginResult,
  SelectModelRequest,
  SelectImageModelRequest,
  SelectUtilityModelRequest,
  UpdateCustomModelRequest,
  UpdateCustomProviderRequest,
} from "./models";
import type {
  ProjectEntryReference,
  ProjectFilePreview,
  ProjectFilePreviewRequest,
  PresentedFilePreviewRequest,
  ProjectFileOperation,
  StartProjectFileDragRequest,
  ListProjectDirectoryRequest,
  ListProjectDirectoryResult,
  ProjectFilesChangedEvent,
  SetWatchedProjectDirectoriesRequest,
} from "./projectFiles";
import type {
  AttachSessionRequest,
  AttachSessionResult,
  DeleteSessionRequest,
  DeleteSessionResult,
  ExportSessionRequest,
  ExportSessionResult,
  LoadSessionMessagesRequest,
  LoadSessionMessagesResult,
  RenameSessionRequest,
  RenameSessionResult,
  ResumeSessionRequest,
  ResumeSessionResult,
  SearchSessionsRequest,
  SearchSessionsResult,
} from "./sessions";
import type { PineWindowApi } from "./window";
import type { PineUserProfile, SetUserProfileResult } from "./userProfile";
import type {
  ListSkillsResult,
  ReadSkillResult,
  RemoveSkillResult,
  SkillIdentityRequest,
  SkillScopeRequest,
  WriteSkillRequest,
  SetGlobalSkillEnabledRequest,
  SetGlobalSkillEnabledResult,
} from "./skills";
import type {
  SetTinyFishApiKeyRequest,
  SetTinyFishApiKeyResult,
  TinyFishCredentialStatus,
} from "./tinyfish";
import type {
  PineMcpCatalog,
  PineMcpMutation,
  PineMcpRequest,
  PineMcpSaveRequest,
} from "./mcp";

export const PROJECTS_DIRECTORY = "projects" as const;
export const PROJECT_METADATA_FILE = "project.json" as const;
export const PROJECT_SESSIONS_DIRECTORY = "sessions" as const;
export const PROJECT_CACHE_DIRECTORY = "cache" as const;
/** Pine-managed storage for attachments pasted without a filesystem path. */
export const PROJECT_ATTACHMENTS_DIRECTORY = "attachments" as const;
export const PROJECT_SKILLS_DIRECTORY = "skills" as const;
export const PROJECT_SKILLS_SETTINGS_FILE = "skills.json" as const;

export const LIST_PROJECTS_CHANNEL = "project:list" as const;
export const CREATE_PROJECT_CHANNEL = "project:create" as const;
export const CLOSE_PROJECT_CHANNEL = "project:close" as const;
export const OPEN_PROJECT_CHANNEL = "project:open" as const;
export const UPDATE_PROJECT_CHANNEL = "project:update" as const;
export const UPDATE_PROJECT_SESSION_GROUPS_CHANNEL =
  "project:update-session-groups" as const;
export const DELETE_PROJECT_CHANNEL = "project:delete" as const;
export const PICK_PROJECT_FOLDERS_CHANNEL = "project:pick-folders" as const;

export type ProjectFolderAccess = "read-only" | "read-write";

export const PROJECT_COLOR_THEMES = [
  "olive",
  "red",
  "rose",
  "orange",
  "green",
  "blue",
  "yellow",
  "violet",
] as const;

export type ProjectColorTheme = (typeof PROJECT_COLOR_THEMES)[number];

export interface ProjectFolderInput {
  access: ProjectFolderAccess;
  id: string;
  name: string;
  path: string;
}

export interface PineProjectFolder extends ProjectFolderInput {
  isAvailable: boolean;
}

export interface PineSessionGroup {
  id: string;
  name: string;
  sessionIds: string[];
}

export interface PineProject {
  createdAt: string;
  defaultFolderId: string;
  folders: PineProjectFolder[];
  id: string;
  lastOpenedAt?: string;
  name: string;
  projectColorTheme?: ProjectColorTheme;
  schemaVersion: 1;
  sessionGroups?: PineSessionGroup[];
  updatedAt: string;
}

export interface ProjectMutationInput {
  defaultFolderId: string;
  folders: ProjectFolderInput[];
  name: string;
  projectColorTheme?: ProjectColorTheme;
}

export type CreateProjectRequest = ProjectMutationInput;

export interface UpdateProjectRequest extends ProjectMutationInput {
  id: string;
}

export interface UpdateProjectSessionGroupsRequest {
  id: string;
  sessionGroups: PineSessionGroup[];
}

export interface ProjectIdRequest {
  id: string;
}

export interface ListProjectsResult {
  projects: PineProject[];
}

export interface ProjectResult {
  project: PineProject;
}

export interface OpenProjectResult extends ProjectResult {
  /** Whether this window now owns the project runtime. */
  opened: boolean;
}

export interface DeleteProjectResult {
  deleted: boolean;
}

export interface PickProjectFoldersResult {
  folders: ProjectFolderInput[];
}

export interface PickProjectFoldersRequest {
  mode: "context" | "default";
}

export interface PineDesktopApi extends PineWindowApi {
  listMcpServers: (request: PineMcpRequest) => Promise<PineMcpCatalog>;
  saveMcpServer: (request: PineMcpSaveRequest) => Promise<PineMcpCatalog>;
  removeMcpServer: (request: PineMcpMutation) => Promise<PineMcpCatalog>;
  readProjectFilePreview: (
    request: ProjectFilePreviewRequest,
  ) => Promise<ProjectFilePreview>;
  readPresentedFilePreview: (
    request: PresentedFilePreviewRequest,
  ) => Promise<ProjectFilePreview>;
  abortSession: (request: SessionControlRequest) => Promise<AbortSessionResult>;
  attachSession: (
    request: AttachSessionRequest,
  ) => Promise<AttachSessionResult>;
  compactSession: (
    request: SessionControlRequest,
  ) => Promise<CompactSessionResult>;
  dequeueSteering: (
    request: DequeueSteeringRequest,
  ) => Promise<DequeueSteeringResult>;
  closeProject: () => Promise<void>;
  createProject: (request: CreateProjectRequest) => Promise<ProjectResult>;
  deleteProject: (request: ProjectIdRequest) => Promise<DeleteProjectResult>;
  deleteSession: (
    request: DeleteSessionRequest,
  ) => Promise<DeleteSessionResult>;
  exportSession: (
    request: ExportSessionRequest,
  ) => Promise<ExportSessionResult>;
  listProjectDirectory: (
    request: ListProjectDirectoryRequest,
  ) => Promise<ListProjectDirectoryResult>;
  setWatchedProjectDirectories: (
    request: SetWatchedProjectDirectoriesRequest,
  ) => Promise<void>;
  onProjectFilesChanged: (
    listener: (event: ProjectFilesChangedEvent) => void,
  ) => () => void;
  operateProjectFile: (request: ProjectFileOperation) => Promise<void>;
  startProjectFileDrag: (request: StartProjectFileDragRequest) => void;
  inspectProjectAttachments: (
    entries: ProjectEntryReference[],
  ) => Promise<PickAttachmentsResult>;
  listProjects: () => Promise<ListProjectsResult>;
  listSkills: (request: SkillScopeRequest) => Promise<ListSkillsResult>;
  readSkill: (request: SkillIdentityRequest) => Promise<ReadSkillResult>;
  createSkill: (request: WriteSkillRequest) => Promise<ReadSkillResult>;
  editSkill: (request: WriteSkillRequest) => Promise<ReadSkillResult>;
  removeSkill: (request: SkillIdentityRequest) => Promise<RemoveSkillResult>;
  setGlobalSkillEnabled: (
    request: SetGlobalSkillEnabledRequest,
  ) => Promise<SetGlobalSkillEnabledResult>;
  getModelCatalog: () => Promise<PineModelCatalog>;
  refreshModelCatalog: () => Promise<PineModelCatalog>;
  lookupModelMetadata: (
    request: LookupModelMetadataRequest,
  ) => Promise<PineModelMetadata>;
  addCustomModel: (request: AddCustomModelRequest) => Promise<PineModelCatalog>;
  updateCustomModel: (
    request: UpdateCustomModelRequest,
  ) => Promise<PineModelCatalog>;
  deleteCustomModel: (
    request: DeleteCustomModelRequest,
  ) => Promise<PineModelCatalog>;
  updateCustomProvider: (
    request: UpdateCustomProviderRequest,
  ) => Promise<PineModelCatalog>;
  deleteCustomProvider: (
    request: DeleteCustomProviderRequest,
  ) => Promise<PineModelCatalog>;
  getContextCompactionStrategy: () => Promise<PineContextCompactionStrategy>;
  getDiagnosticLogging: () => Promise<boolean>;
  setDiagnosticLogging: (
    request: SetDiagnosticLoggingRequest,
  ) => Promise<SetDiagnosticLoggingResult>;
  getUserProfile: () => Promise<PineUserProfile>;
  getTinyFishCredentialStatus: () => Promise<TinyFishCredentialStatus>;
  setTinyFishApiKey: (
    request: SetTinyFishApiKeyRequest,
  ) => Promise<SetTinyFishApiKeyResult>;
  setContextCompactionStrategy: (
    request: SetContextCompactionStrategyRequest,
  ) => Promise<SetContextCompactionStrategyResult>;
  setUserProfile: (profile: PineUserProfile) => Promise<SetUserProfileResult>;
  getPathForFile: (file: File) => string;
  inspectAttachments: (
    request: InspectAttachmentsRequest,
  ) => Promise<PickAttachmentsResult>;
  openAttachment: (
    request: OpenAttachmentRequest,
  ) => Promise<OpenAttachmentResult>;
  savePastedAttachment: (
    request: SavePastedAttachmentRequest,
  ) => Promise<SavePastedAttachmentResult>;
  loginProvider: (
    request: LoginProviderRequest,
  ) => Promise<ProviderLoginResult>;
  respondToProviderAuth: (
    request: ProviderAuthResponseRequest,
  ) => Promise<{ accepted: boolean }>;
  cancelProviderAuth: (request: {
    loginId: string;
  }) => Promise<{ cancelled: boolean }>;
  logoutProvider: (
    request: LogoutProviderRequest,
  ) => Promise<{ disposed: boolean }>;
  selectModel: (request: SelectModelRequest) => Promise<{ disposed: boolean }>;
  selectUtilityModel: (
    request: SelectUtilityModelRequest,
  ) => Promise<{ updated: boolean }>;
  selectImageModel: (
    request: SelectImageModelRequest,
  ) => Promise<{ updated: boolean }>;
  openProviderAuthUrl: (url: string) => Promise<void>;
  onProviderAuthEvent: (listener: ProviderAuthEventListener) => () => void;
  loadSessionMessages: (
    request: LoadSessionMessagesRequest,
  ) => Promise<LoadSessionMessagesResult>;
  openProject: (request: ProjectIdRequest) => Promise<OpenProjectResult>;
  pickAttachments: () => Promise<PickAttachmentsResult>;
  pickAttachmentFolders: () => Promise<PickAttachmentsResult>;
  pickProjectFolders: (
    request: PickProjectFoldersRequest,
  ) => Promise<PickProjectFoldersResult>;
  promptSession: (
    request: PromptSessionRequest,
  ) => Promise<PromptSessionResult>;
  resumeSession: (
    request: ResumeSessionRequest,
  ) => Promise<ResumeSessionResult>;
  renameSession: (
    request: RenameSessionRequest,
  ) => Promise<RenameSessionResult>;
  searchSessions: (
    request: SearchSessionsRequest,
  ) => Promise<SearchSessionsResult>;
  onSessionEvent: (listener: SessionEventListener) => () => void;
  respondApproval: (
    request: RespondApprovalRequest,
  ) => Promise<{ accepted: boolean }>;
  respondQuestionnaire: (
    request: RespondQuestionnaireRequest,
  ) => Promise<{ accepted: boolean }>;
  setApprovalMode: (
    request: SetApprovalModeRequest,
  ) => Promise<SetApprovalModeResult>;
  updateProject: (request: UpdateProjectRequest) => Promise<ProjectResult>;
  updateProjectSessionGroups: (
    request: UpdateProjectSessionGroupsRequest,
  ) => Promise<ProjectResult>;
}
