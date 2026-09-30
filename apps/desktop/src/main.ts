import {
  ProjectFileOperationSchema,
  ProjectEntryReferenceSchema,
} from "./main/projectFileOperations";
import {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  powerMonitor,
  protocol,
  shell,
  webContents,
  type IpcMainEvent,
  type OpenDialogOptions,
} from "electron";
import started from "electron-squirrel-startup";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ProjectRuntimeRegistry } from "./main/projectRuntime";
import {
  listMcpServers,
  saveMcpServer,
  removeMcpServer,
} from "./main/mcpConfig";
import {
  LIST_MCP_SERVERS_CHANNEL,
  SAVE_MCP_SERVER_CHANNEL,
  REMOVE_MCP_SERVER_CHANNEL,
  type PineMcpCatalog,
} from "./shared/mcp";
import { PresentedFileRegistry } from "./main/presentedFiles";
import { TinyFishCredentialStore } from "./main/tinyfishCredentials";
import {
  PRESENTED_MEDIA_PARAM,
  readProjectFilePreview,
  projectMediaUrl,
  serveProjectMedia,
} from "./main/projectFilePreview";
import { installWindowShortcuts } from "./main/windowShortcuts";
import { AppUpdater, readUpdateManifestUrl } from "./main/appUpdater";
import { AgentProcessHost } from "./main/agentProcessHost";
import { RuntimeDiagnostics } from "./main/runtimeDiagnostics";
import { ModelRecommendationService } from "./main/modelRecommendations";
import {
  ensureWindowsSandboxReady,
  releaseWindowsSandboxRuntimeAccess,
  type WindowsSandboxSetupChoice,
} from "./main/windowsSandbox";
import { ModelMetadataService } from "./main/modelMetadata";
import { ProjectRepository } from "./main/projects/projectRepository";
import {
  collectSkillResources,
  PineSkillRepository,
} from "./agent/skills/repository";
import {
  filterPineManagedSkills,
  piProjectSkillPaths,
  pineScopeForPiSkill,
  summarizePiSkill,
} from "./agent/skills/piDiscovery";
import {
  readPineAgentSettings,
  writeAutoApprovalSettings,
  writeContextCompactionStrategy,
  writeDiagnosticLoggingEnabled,
  writePineUserProfile,
} from "./agent/pineSettings";
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
  type CompactSessionResult,
  type DequeueSteeringResult,
  type PineAgentEvent,
  type PinePresentFileEvent,
  type PromptSessionResult,
  type RespondApprovalRequest,
  type RespondQuestionnaireRequest,
  type SetApprovalModeResult,
} from "./shared/agent";
import {
  DEFAULT_AUTO_APPROVAL_SETTINGS,
  isPineAutoApprovalSettings,
  DEFAULT_CONTEXT_COMPACTION_STRATEGY,
  GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  GET_DIAGNOSTIC_LOGGING_CHANNEL,
  SET_DIAGNOSTIC_LOGGING_CHANNEL,
  GET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  SET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  type PineAutoApprovalSettings,
  type PineContextCompactionStrategy,
  type SetContextCompactionStrategyResult,
  type SetDiagnosticLoggingResult,
} from "./shared/preferences";
import {
  ATTACHMENT_IMAGE_PROTOCOL,
  INSPECT_ATTACHMENTS_CHANNEL,
  MAX_PASTED_IMAGE_BYTES,
  MAX_PASTED_TEXT_BYTES,
  OPEN_ATTACHMENT_CHANNEL,
  PICK_ATTACHMENT_FOLDERS_CHANNEL,
  PICK_ATTACHMENTS_CHANNEL,
  SAVE_PASTED_ATTACHMENT_CHANNEL,
  extensionForPastedImage,
  PASTED_IMAGE_MIME_TYPES,
  type PineAttachment,
  type PineAttachmentKind,
  type OpenAttachmentResult,
  type PickAttachmentsResult,
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
  isProviderAuthEvent,
  type AddCustomModelRequest,
  type DeleteCustomModelRequest,
  type DeleteCustomProviderRequest,
  type LookupModelMetadataRequest,
  type PineModelCatalog,
  type PineModelMetadata,
  type ProviderLoginResult,
  type UpdateCustomModelRequest,
  type UpdateCustomProviderRequest,
} from "./shared/models";
import {
  CREATE_PROJECT_CHANNEL,
  CLOSE_PROJECT_CHANNEL,
  DELETE_PROJECT_CHANNEL,
  LIST_PROJECTS_CHANNEL,
  OPEN_PROJECT_CHANNEL,
  PICK_PROJECT_FOLDERS_CHANNEL,
  PROJECTS_DIRECTORY,
  PROJECT_ATTACHMENTS_DIRECTORY,
  PROJECT_COLOR_THEMES,
  UPDATE_PROJECT_CHANNEL,
  UPDATE_PROJECT_SESSION_GROUPS_CHANNEL,
  type DeleteProjectResult,
  type ListProjectsResult,
  type OpenProjectResult,
  type PineProject,
  type PickProjectFoldersResult,
  type ProjectResult,
} from "./shared/projects";
import {
  CREATE_SKILL_CHANNEL,
  EDIT_SKILL_CHANNEL,
  LIST_SKILLS_CHANNEL,
  READ_SKILL_CHANNEL,
  REMOVE_SKILL_CHANNEL,
  SET_GLOBAL_SKILL_ENABLED_CHANNEL,
  type ListSkillsResult,
  type PineSkillScope,
  type ReadSkillResult,
  type RemoveSkillResult,
  type SetGlobalSkillEnabledResult,
} from "./shared/skills";
import {
  GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL,
  SET_TINYFISH_API_KEY_CHANNEL,
  type SetTinyFishApiKeyResult,
  type TinyFishCredentialStatus,
} from "./shared/tinyfish";
import {
  createDefaultPineUserProfile,
  GET_USER_PROFILE_CHANNEL,
  SET_USER_PROFILE_CHANNEL,
  type PineUserProfile,
  type SetUserProfileResult,
} from "./shared/userProfile";

import {
  ATTACH_SESSION_CHANNEL,
  DELETE_SESSION_CHANNEL,
  EXPORT_SESSION_CHANNEL,
  LOAD_SESSION_MESSAGES_CHANNEL,
  RENAME_SESSION_CHANNEL,
  RESUME_SESSION_CHANNEL,
  SEARCH_SESSIONS_CHANNEL,
  type AttachSessionResult,
  type DeleteSessionResult,
  type ExportSessionResult,
  type LoadSessionMessagesResult,
  type RenameSessionResult,
  type ResumeSessionResult,
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
  PROJECT_MEDIA_PROTOCOL,
  PROJECT_FILES_CHANGED_CHANNEL,
  SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
  MAX_WATCHED_PROJECT_DIRECTORIES,
  MAX_WATCHED_PROJECT_FOLDERS,
  type ListProjectDirectoryResult,
} from "./shared/projectFiles";
import { ProjectFileWatcherRegistry } from "./main/projectFileWatcher";
import { startProjectFileDrag } from "./main/projectFileDrag";
import {
  OPAQUE_WINDOW_BACKGROUND,
  SET_SIDEBAR_VIBRANCY_CHANNEL,
  CLOSE_WINDOW_CHANNEL,
  GET_APP_VERSION_CHANNEL,
  OPEN_EXTERNAL_URL_CHANNEL,
  TRANSPARENT_WINDOW_BACKGROUND,
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
} from "./shared/updates";
import type { WindowsSandboxStatus } from "./shared/windowsSandbox";

type DefaultResourceLoader =
  import("@earendil-works/pi-coding-agent").DefaultResourceLoader;
type PiSkill = import("@earendil-works/pi-coding-agent").Skill;

// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Vite
// plugin that tells the Electron app where to look for the Vite-bundled app code (depending on
// whether you're running in development or production).
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

if (process.platform === "win32") {
  // Squirrel uses this identity for shortcuts and taskbar pinning.
  app.setAppUserModelId("com.squirrel.Pine.Pine");
}

const isSmokeTest = process.argv.includes("--smoke-test");

// Must run before app ready. The attachment image protocol lets the renderer
// display local images without granting it general filesystem access.
protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
    scheme: PROJECT_MEDIA_PROTOCOL,
  },
  {
    privileges: { standard: true, stream: true, supportFetchAPI: true },
    scheme: ATTACHMENT_IMAGE_PROTOCOL,
  },
]);

const ATTACHMENT_IMAGE_CONTENT_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PASTED_ATTACHMENT_NAME_LENGTH = 200;

const SavePastedAttachmentRequestSchema = z.union([
  z.object({
    bytes: z
      .instanceof(Uint8Array)
      .refine(
        (bytes) =>
          bytes.byteLength > 0 && bytes.byteLength <= MAX_PASTED_IMAGE_BYTES,
      ),
    mimeType: z.enum(PASTED_IMAGE_MIME_TYPES),
    name: z.string().max(MAX_PASTED_ATTACHMENT_NAME_LENGTH).optional(),
  }),
  z.object({
    mimeType: z.literal("text/plain"),
    name: z.string().max(MAX_PASTED_ATTACHMENT_NAME_LENGTH).optional(),
    text: z
      .string()
      .refine((text) => text.trim().length > 0)
      .refine(
        (text) => Buffer.byteLength(text, "utf8") <= MAX_PASTED_TEXT_BYTES,
      ),
  }),
]);

/** Root of the Pine-managed projects tree; set once the app is ready. */
let projectsRootPath: string | null = null;

/**
 * Filesystem paths the user explicitly selected as message attachments, per
 * window. Previewing them mirrors the agent's read-only grant for the same
 * paths, so the protocol may serve them even outside granted folders.
 */
const attachedPreviewPaths = new Map<number, Set<string>>();

function registerAttachmentPreviewPaths(
  webContentsId: number,
  attachmentPaths: readonly string[],
): void {
  const registered = attachedPreviewPaths.get(webContentsId) ?? new Set();
  for (const attachmentPath of attachmentPaths) {
    registered.add(path.resolve(attachmentPath));
  }
  attachedPreviewPaths.set(webContentsId, registered);
}

/**
 * Whether the protocol may serve this file: either a Pine-managed pasted
 * attachment (`<projectsRoot>/<projectId>/attachments/<file>`) or a file
 * inside a folder granted to one of the currently open projects.
 */
function isServableAttachmentPath(resolvedPath: string): boolean {
  if (!projectsRootPath) return false;

  const relativePath = path.relative(projectsRootPath, resolvedPath);
  if (
    relativePath !== "" &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== ".." &&
    !path.isAbsolute(relativePath)
  ) {
    const segments = relativePath.split(path.sep);
    if (
      segments.length === 3 &&
      segments[1] === PROJECT_ATTACHMENTS_DIRECTORY &&
      PROJECT_ID_PATTERN.test(segments[0])
    ) {
      return true;
    }
  }
  if (getProjectRuntimes().isInsideGrantedFolder(resolvedPath)) {
    return true;
  }
  for (const registered of attachedPreviewPaths.values()) {
    if (registered.has(resolvedPath)) return true;
  }
  return false;
}

function registerAttachmentImageProtocol(): void {
  protocol.handle(ATTACHMENT_IMAGE_PROTOCOL, async (request) => {
    let requestedPath: string | null;
    try {
      requestedPath = new URL(request.url).searchParams.get("p");
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!requestedPath) {
      return new Response("Bad request", { status: 400 });
    }
    const resolvedPath = path.resolve(requestedPath);
    if (!isServableAttachmentPath(resolvedPath)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const contents = await readFile(resolvedPath);
      const extension = path.extname(resolvedPath).slice(1).toLowerCase();
      return new Response(contents, {
        headers: {
          "content-type":
            ATTACHMENT_IMAGE_CONTENT_TYPES[extension] ??
            "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

nativeTheme.themeSource = "system";

let agentHost: AgentProcessHost | null = null;
let runtimeDiagnostics: RuntimeDiagnostics | null = null;
let pineAgentDirectory: string | null = null;
const modelRecommendations = new ModelRecommendationService();
const modelMetadata = new ModelMetadataService();
let projectRuntimes: ProjectRuntimeRegistry | null = null;
let presentedFiles: PresentedFileRegistry | null = null;
let projectFileWatchers: ProjectFileWatcherRegistry | null = null;
let projectRepository: ProjectRepository | null = null;
let appUpdater: AppUpdater | null = null;
let tinyFishCredentialStore: TinyFishCredentialStore | null = null;
let windowsSandboxReady = process.platform !== "win32";
let windowsSandboxSetupPromise: Promise<boolean> | null = null;
const pendingProjectOpens = new Map<
  string,
  { promise: Promise<PineProject>; webContentsId: number }
>();

const ProjectFolderInputSchema = z.object({
  access: z.enum(["read-only", "read-write"]),
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  path: z.string().min(1).max(4_096),
});
const SkillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const PiSkillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/)
  .refine(
    (name) =>
      !name.startsWith("-") && !name.endsWith("-") && !name.includes("--"),
  );
const ProjectMutationSchema = z
  .object({
    defaultFolderId: z.uuid(),
    folders: z.array(ProjectFolderInputSchema).min(1),
    name: z.string().trim().min(1).max(100),
    projectColorTheme: z.enum(PROJECT_COLOR_THEMES).default("olive"),
  })
  .superRefine((project, context) => {
    const defaultFolder = project.folders.find(
      (folder) => folder.id === project.defaultFolderId,
    );
    if (defaultFolder?.access === "read-write") return;

    context.addIssue({
      code: "custom",
      message: "The default folder must have read-write access.",
      path: ["defaultFolderId"],
    });
  });
const PickProjectFoldersRequestSchema = z.object({
  mode: z.enum(["context", "default"]),
});
const ProjectIdRequestSchema = z.object({ id: z.uuid() });
const UpdateProjectSessionGroupsRequestSchema = z.object({
  id: z.uuid(),
  sessionGroups: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().trim().min(1).max(100),
      sessionIds: z.array(z.uuid()),
    }),
  ),
});
const SkillScopeRequestSchema = z
  .object({
    projectId: z.uuid().optional(),
    scope: z.enum(["global", "project"]),
  })
  .superRefine((request, context) => {
    if (request.scope === "project" && !request.projectId) {
      context.addIssue({
        code: "custom",
        message: "Project scope requires a project ID.",
        path: ["projectId"],
      });
    }
  });
const SkillIdentityRequestSchema = SkillScopeRequestSchema.safeExtend({
  managedBy: z.enum(["pine", "pi"]).optional(),
  name: PiSkillNameSchema,
});
const WriteSkillRequestSchema = SkillIdentityRequestSchema.safeExtend({
  content: z.string().trim().min(1).max(1_000_000),
});
const SetGlobalSkillEnabledRequestSchema = z.object({
  enabled: z.boolean(),
  name: SkillNameSchema,
  projectId: z.uuid(),
});
const ProjectFilePreviewRequestSchema = ProjectEntryReferenceSchema.extend({
  projectId: z.uuid(),
});
const PresentedFilePreviewRequestSchema = z.object({
  path: z.string().min(1).max(4096),
});
const ReopenPresentedToolFileRequestSchema = z.object({
  sessionId: z.uuid(),
  toolCallId: z.string().min(1).max(256),
});

async function previewPath(ownerId: number, request: unknown): Promise<string> {
  const entry = ProjectFilePreviewRequestSchema.parse(request);
  if (!getProjectRuntimes().isOpen(ownerId, entry.projectId))
    throw new Error("Project is no longer open.");
  const [filePath] = await getProjectRuntimes().projectEntryPaths(ownerId, [
    entry,
  ]);
  if (!getProjectRuntimes().isOpen(ownerId, entry.projectId))
    throw new Error("Project is no longer open.");
  return filePath;
}

/**
 * Resolve a presented file for content serving. The path must still be an
 * absolute path this window presented, so a tab can never turn the media
 * protocol into a generic disk read.
 */
async function presentedFilePath(
  ownerId: number,
  request: unknown,
): Promise<string> {
  const { path: requestedPath } =
    PresentedFilePreviewRequestSchema.parse(request);
  const canonicalPath = await realpath(requestedPath).catch(() => null);
  if (!canonicalPath || !presentedFiles?.allows(ownerId, canonicalPath)) {
    throw new Error("This file was not presented to this window.");
  }
  return canonicalPath;
}

/**
 * Resolve a presented file into a tab target and forward it to its window. The
 * renderer only ever sees the resolved target: main is the only place that
 * knows which project folder a path belongs to, and the only place allowed to
 * grant a window read access to a file outside those folders.
 */
async function forwardPresentedFile(
  event: Extract<PineAgentEvent, { type: "present-file" }>,
  ownerId: number,
): Promise<void> {
  const target = await projectRuntimes?.resolvePresentTarget(
    event.sessionId,
    event.path,
  );
  // An unresolvable path (folder removed, file deleted, project gone) never
  // becomes a tab, so the renderer cannot be handed a raw absolute path.
  if (!target) return;
  if (target.source === "presented") {
    presentedFiles?.remember(ownerId, target.path);
  }
  webContents.fromId(ownerId)?.send(SESSION_EVENT_CHANNEL, {
    ...event,
    target,
  } satisfies PinePresentFileEvent);
}

function registerProjectMediaProtocol(): void {
  protocol.handle(PROJECT_MEDIA_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "preview")
        return new Response(null, { status: 400 });
      const ownerId = z.coerce
        .number()
        .int()
        .positive()
        .parse(url.searchParams.get("owner"));
      const filePath =
        url.searchParams.get(PRESENTED_MEDIA_PARAM) === "1"
          ? await presentedFilePath(
              ownerId,
              Object.fromEntries(url.searchParams),
            )
          : await previewPath(ownerId, Object.fromEntries(url.searchParams));
      return await serveProjectMedia(request, filePath);
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
const UpdateProjectRequestSchema = ProjectMutationSchema.safeExtend({
  id: z.uuid(),
});
const SearchSessionsRequestSchema = z.object({
  query: z.string().max(500),
});
const SessionIdRequestSchema = z.object({
  sessionId: z.uuid(),
});
const RenameSessionRequestSchema = SessionIdRequestSchema.extend({
  name: z.string().trim().min(1).max(200),
});
const LoadSessionMessagesRequestSchema = z.object({
  // History cursors are opaque, versioned strings derived from stable entry
  // sequence numbers; entry-ID cursors remain accepted for compatibility.
  before: z.string().min(1).max(128).optional(),
  includeOutline: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sessionId: z.uuid(),
});
const PromptSessionRequestSchema = z.object({
  locale: z.enum(["en-US", "zh-CN"]).default("en-US"),
  message: z.string().trim().min(1).max(100_000),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new") }),
    z.object({ kind: z.literal("session"), sessionId: z.uuid() }),
  ]),
  streamingBehavior: z.enum(["follow-up", "steer"]).optional(),
  approvalMode: z
    .enum(["let-me-review", "auto-approve", "autonomous", "YOLO"])
    .optional(),
});
const DequeueSteeringRequestSchema = SessionIdRequestSchema.extend({
  message: z.string().min(1).max(100_000),
});
const RespondApprovalRequestSchema = z.object({
  requestId: z.uuid(),
  action: z.enum(["approve", "reject", "guide"]),
  guidance: z.string().trim().min(1).max(10_000).optional(),
});
const RespondQuestionnaireRequestSchema = z.object({
  requestId: z.uuid(),
  submission: z.object({
    cancelled: z.boolean(),
    answers: z
      .array(
        z.object({
          questionIndex: z.number().int().min(0).max(3),
          selectedOptionIndexes: z.array(z.number().int().min(0).max(3)).max(4),
          customAnswer: z.string().trim().max(100_000).optional(),
        }),
      )
      .max(4),
  }),
});
const SetApprovalModeRequestSchema = SessionIdRequestSchema.extend({
  approvalMode: z.enum(["let-me-review", "auto-approve", "autonomous", "YOLO"]),
});
const SetContextCompactionStrategyRequestSchema = z.object({
  strategy: z.enum(["passive", "recommended"]),
});
const LoginProviderRequestSchema = z.object({
  authType: z.enum(["api_key", "oauth"]),
  loginId: z.uuid(),
  providerId: z.string().trim().min(1).max(200),
});
const CustomModelDefinitionSchema = z.object({
  contextWindow: z.number().int().positive().max(10_000_000),
  maxTokens: z.number().int().positive().max(10_000_000),
  modelId: z.string().trim().min(1).max(500),
  modelName: z.string().trim().min(1).max(200).optional(),
  thinkingLevels: z
    .array(z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]))
    .min(1)
    .max(7),
  vision: z.boolean(),
});
const ProviderIdSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
});
const AddCustomModelRequestSchema = z.intersection(
  CustomModelDefinitionSchema,
  z.discriminatedUnion("providerMode", [
    z.object({
      providerMode: z.literal("existing"),
      providerId: z.string().trim().min(1).max(200),
    }),
    z.object({
      providerMode: z.literal("new"),
      providerId: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[a-z0-9][a-z0-9._-]*$/),
      providerName: z.string().trim().min(1).max(200),
      baseUrl: z.url().refine((url) => {
        try {
          return ["http:", "https:"].includes(new URL(url).protocol);
        } catch {
          return false;
        }
      }),
      apiKey: z.string().trim().min(1).max(100_000),
      api: z.enum([
        "anthropic-messages",
        "google-generative-ai",
        "openai-completions",
        "openai-responses",
      ]),
    }),
  ]),
);
const UpdateCustomModelRequestSchema = z.intersection(
  CustomModelDefinitionSchema,
  z.object({
    originalModelId: z.string().trim().min(1).max(500),
    providerId: z.string().trim().min(1).max(200),
  }),
);
const UpdateCustomProviderRequestSchema = z.object({
  api: z.enum([
    "anthropic-messages",
    "google-generative-ai",
    "openai-completions",
    "openai-responses",
  ]),
  apiKey: z.string().trim().max(100_000).optional(),
  baseUrl: z.url().refine((url) => {
    try {
      return ["http:", "https:"].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }),
  providerId: z.string().trim().min(1).max(200),
  providerName: z.string().trim().min(1).max(200),
});
const DeleteCustomModelRequestSchema = z.object({
  modelId: z.string().trim().min(1).max(500),
  providerId: z.string().trim().min(1).max(200),
});
const DeleteCustomProviderRequestSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
});
const LookupModelMetadataRequestSchema = z.object({
  modelId: z.string().trim().min(1).max(500),
  providerId: z.string().trim().min(1).max(200).optional(),
});
const ProviderAuthResponseRequestSchema = z.object({
  loginId: z.uuid(),
  promptId: z.uuid(),
  value: z.string().max(100_000),
});
const ProviderAuthLoginIdSchema = z.object({ loginId: z.uuid() });
const SelectModelRequestSchema = z.object({
  modelId: z.string().trim().min(1).max(500),
  providerId: z.string().trim().min(1).max(200),
  sessionId: z.uuid().optional(),
  thinkingLevel: z.enum([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]),
});
const SelectUtilityModelRequestSchema = SelectModelRequestSchema.pick({
  modelId: true,
  providerId: true,
});
const SelectImageModelRequestSchema = SelectModelRequestSchema.pick({
  modelId: true,
  providerId: true,
});
const ProviderAuthUrlSchema = z.url().refine((url) => {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
});
const ListProjectDirectoryRequestSchema = z.object({
  folderId: z.uuid(),
  relativePath: z.string().max(4_096),
});
const SetWatchedProjectDirectoriesRequestSchema = z.object({
  folders: z
    .array(
      z.object({
        folderId: z.uuid(),
        directories: z.array(z.string().max(4_096)),
      }),
    )
    .max(MAX_WATCHED_PROJECT_FOLDERS)
    .refine(
      (folders) =>
        new Set(folders.map((folder) => folder.folderId)).size ===
        folders.length,
      "Folder IDs must be unique.",
    )
    .refine(
      (folders) =>
        folders.reduce(
          (total, folder) => total + folder.directories.length,
          0,
        ) <= MAX_WATCHED_PROJECT_DIRECTORIES,
      `At most ${MAX_WATCHED_PROJECT_DIRECTORIES} directories can be watched.`,
    ),
});
const SetSidebarVibrancyRequestSchema = z.object({
  enabled: z.boolean(),
});
const SetTinyFishApiKeyRequestSchema = z.object({
  apiKey: z.string().trim().min(1).max(4_096),
});
const UserProfileSchema = z.object({
  communicationStyle: z.enum(["calm-professional", "warm-friendly"]),
  customInstructions: z.string().max(20_000),
  nickname: z.string().trim().max(100),
  personalDetails: z.string().max(10_000),
  technicalBackground: z.enum([
    "general-user",
    "enthusiast",
    "professional-user",
  ]),
});
const InspectAttachmentsRequestSchema = z.object({
  paths: z.array(z.string().min(1).max(4_096)).max(100),
});
const OpenAttachmentRequestSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(4_096)
    .refine((attachmentPath) => path.isAbsolute(attachmentPath)),
});

async function inspectAttachmentPaths(
  filePaths: readonly string[],
): Promise<PickAttachmentsResult> {
  const attachments = await Promise.all(
    filePaths.map(async (filePath): Promise<PineAttachment | undefined> => {
      const metadata = await stat(filePath);
      let kind: PineAttachmentKind;
      if (metadata.isFile()) kind = "file";
      else if (metadata.isDirectory()) kind = "directory";
      else return undefined;
      return {
        extension:
          kind === "file" ? path.extname(filePath).slice(1).toLowerCase() : "",
        kind,
        modifiedAt: metadata.mtime.toISOString(),
        name: path.basename(filePath),
        path: filePath,
        size: metadata.size,
      };
    }),
  );
  return {
    attachments: attachments.filter((attachment) => attachment !== undefined),
  };
}

function getProjectRepository(): ProjectRepository {
  if (!projectRepository) throw new Error("Project storage is not ready.");
  return projectRepository;
}

function getProjectRuntimes(): ProjectRuntimeRegistry {
  if (!projectRuntimes) throw new Error("Project runtime is not ready.");
  return projectRuntimes;
}

function handleDiagnosticIpc(
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1],
): void {
  ipcMain.handle(channel, (event, ...args) =>
    runtimeDiagnostics
      ? runtimeDiagnostics.trace(channel, event.sender.id, () =>
          listener(event, ...args),
        )
      : listener(event, ...args),
  );
}

function windowForWebContentsId(
  webContentsId: number,
): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(
    (window) =>
      !window.isDestroyed() && window.webContents.id === webContentsId,
  );
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

function getTinyFishCredentialStore(): TinyFishCredentialStore {
  if (!tinyFishCredentialStore) {
    throw new Error("TinyFish credential storage is not ready.");
  }
  return tinyFishCredentialStore;
}

function getPineAgentDirectory(): string {
  if (!pineAgentDirectory) {
    throw new Error("Pine agent storage is not ready.");
  }
  return pineAgentDirectory;
}

async function skillRepositoryFor(
  scope: PineSkillScope,
  projectId?: string,
): Promise<PineSkillRepository> {
  const repository = getProjectRepository();
  if (scope === "project" && !projectId) {
    throw new Error("Project scope requires a project ID.");
  }

  let projectSkillsRoot = path.join(
    getPineAgentDirectory(),
    ".no-project-skills",
  );
  let disabledGlobalSkillsPath: string | undefined;
  if (projectId) {
    await repository.get(projectId);
    const dataPaths = repository.dataPaths(projectId);
    disabledGlobalSkillsPath =
      dataPaths.skillsSettingsPath ??
      path.join(dataPaths.projectRoot, "skills.json");
    if (scope === "project") {
      projectSkillsRoot =
        dataPaths.skillsRoot ?? path.join(dataPaths.projectRoot, "skills");
    }
  }

  return new PineSkillRepository({
    ...(disabledGlobalSkillsPath ? { disabledGlobalSkillsPath } : {}),
    global: path.join(getPineAgentDirectory(), "skills"),
    project: projectSkillsRoot,
  });
}

function getAppUpdater(): AppUpdater {
  if (!appUpdater) throw new Error("App updater is not ready.");
  return appUpdater;
}

function broadcastUpdateEvent(event: PineUpdateEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATE_EVENT_CHANNEL, event);
    }
  }
}

/** macOS dock bounce id for the pending approval attention request. */
let approvalBounceId: number | null = null;

/**
 * Surface a pending approval at the OS level: the dock icon bounces on
 * macOS and the taskbar button flashes on Windows until the decision (or
 * window focus) clears it.
 */
function requestApprovalAttention(ownerId: number): void {
  if (process.platform === "darwin") {
    approvalBounceId = app.dock?.bounce("informational") ?? null;
    return;
  }
  if (process.platform === "win32") {
    const sender = webContents.fromId(ownerId);
    const window = sender ? BrowserWindow.fromWebContents(sender) : undefined;
    window?.flashFrame(true);
  }
}

function clearApprovalAttention(): void {
  if (process.platform === "darwin") {
    if (approvalBounceId !== null) app.dock?.cancelBounce(approvalBounceId);
    approvalBounceId = null;
    return;
  }
  if (process.platform === "win32") {
    for (const window of BrowserWindow.getAllWindows()) {
      window.flashFrame(false);
    }
  }
}

const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(app.getAppPath(), "resources/icon.png");

function isChineseLocale(): boolean {
  return app.getLocale().toLowerCase().startsWith("zh");
}

async function showWindowsSandboxSetupDialog(
  status: WindowsSandboxStatus,
): Promise<WindowsSandboxSetupChoice> {
  const chinese = isChineseLocale();
  const cancelled = status.state === "not-installed" && status.cancelled;
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: chinese ? "需要配置 Windows 沙箱" : "Windows sandbox setup required",
    message: chinese
      ? "完成 Windows 沙箱配置后才能进入 Pine。"
      : "Pine cannot open until the Windows sandbox is configured.",
    detail: cancelled
      ? chinese
        ? "你取消了上一次 UAC 授权。点击“重试”再次打开 UAC 提示。"
        : "The last UAC request was cancelled. Choose Retry to show it again."
      : chinese
        ? "请在 UAC 提示中允许 Pine 完成配置。"
        : "Approve the UAC prompt so Pine can finish the setup.",
    buttons: chinese ? ["重试", "退出 Pine"] : ["Retry", "Exit Pine"],
    cancelId: 1,
    defaultId: 0,
    noLink: true,
  });
  return response === 0 ? "retry" : "exit";
}

async function ensureAppWindowsSandboxReady(): Promise<boolean> {
  if (windowsSandboxReady) return true;
  if (!windowsSandboxSetupPromise) {
    windowsSandboxSetupPromise = ensureWindowsSandboxReady({
      prompt: showWindowsSandboxSetupDialog,
    }).then((ready) => {
      windowsSandboxReady = ready;
      return ready;
    });
  }
  try {
    return await windowsSandboxSetupPromise;
  } catch (error) {
    console.error("[Windows sandbox] setup flow failed", error);
    windowsSandboxReady = false;
    return false;
  } finally {
    windowsSandboxSetupPromise = null;
  }
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    title: "Pine",
    icon: appIconPath,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 21, y: 21 } }
      : {
          // Keep the native Windows controls aligned with the custom title
          // bar instead of falling back to the shorter system overlay.
          titleBarOverlay: {
            color: "rgba(0, 0, 0, 0)",
            height: 56,
          },
        }),
    width: 1120,
    height: 840,
    minWidth: 720,
    minHeight: 540,
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      experimentalFeatures: false,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      scrollBounce: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  const webContentsId = mainWindow.webContents.id;
  mainWindow.on("unresponsive", () => {
    runtimeDiagnostics?.record("window:unresponsive", { webContentsId });
  });
  mainWindow.on("responsive", () => {
    runtimeDiagnostics?.record("window:responsive", { webContentsId });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    runtimeDiagnostics?.record("renderer:gone", {
      webContentsId,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  mainWindow.webContents.on("preload-error", (_event, _preloadPath, error) => {
    runtimeDiagnostics?.record("preload:error", {
      webContentsId,
      error: error.message,
    });
  });
  installWindowShortcuts(mainWindow.webContents, createWindow);

  // Focus stops the approval attention request (Windows flashes until the
  // window is focused; macOS bounces until the app activates).
  mainWindow.on("focus", clearApprovalAttention);

  mainWindow.once("ready-to-show", () => {
    if (isSmokeTest) {
      app.exit(0);
    } else {
      mainWindow.show();
    }
  });
  mainWindow.webContents.once("destroyed", () => {
    for (const [projectId, pending] of pendingProjectOpens) {
      if (pending.webContentsId === webContentsId) {
        pendingProjectOpens.delete(projectId);
      }
    }
    attachedPreviewPaths.delete(webContentsId);
    presentedFiles?.forget(webContentsId);
    projectFileWatchers?.disposeSender(webContentsId);
    void projectRuntimes?.dispose(webContentsId);
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools();
  }
};

ipcMain.handle(CLOSE_WINDOW_CHANNEL, (event): void => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle(GET_APP_VERSION_CHANNEL, (): string => app.getVersion());

ipcMain.handle(CHECK_FOR_UPDATE_CHANNEL, (): Promise<UpdateCheckResult> =>
  getAppUpdater().check(),
);

ipcMain.handle(
  DOWNLOAD_UPDATE_CHANNEL,
  async (): Promise<DownloadUpdateResult> => {
    try {
      return await getAppUpdater().download();
    } catch (error) {
      broadcastUpdateEvent({ message: String(error), type: "error" });
      throw error;
    }
  },
);

ipcMain.handle(
  INSTALL_UPDATE_CHANNEL,
  async (): Promise<InstallUpdateResult> => {
    try {
      return await getAppUpdater().install();
    } catch (error) {
      broadcastUpdateEvent({ message: String(error), type: "error" });
      throw error;
    }
  },
);

ipcMain.handle(
  GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL,
  (): TinyFishCredentialStatus => ({
    configured: getTinyFishCredentialStore().isConfigured(),
  }),
);

ipcMain.handle(
  GET_USER_PROFILE_CHANNEL,
  async (): Promise<PineUserProfile> =>
    (await readPineAgentSettings(getPineAgentDirectory())).userProfile ??
    createDefaultPineUserProfile(),
);

ipcMain.handle(
  GET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  async (): Promise<PineAutoApprovalSettings> =>
    (await readPineAgentSettings(getPineAgentDirectory())).autoApproval ?? {
      ...DEFAULT_AUTO_APPROVAL_SETTINGS,
    },
);

ipcMain.handle(
  SET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  async (_event, request: unknown): Promise<PineAutoApprovalSettings> => {
    const settings = z
      .custom<PineAutoApprovalSettings>(isPineAutoApprovalSettings)
      .parse(request);
    const normalized = {
      strategy: settings.strategy,
      decisionsModel: settings.decisionsModel.trim(),
    };
    await writeAutoApprovalSettings(getPineAgentDirectory(), normalized);
    return normalized;
  },
);

ipcMain.handle(
  GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  async (): Promise<PineContextCompactionStrategy> =>
    (await readPineAgentSettings(getPineAgentDirectory()))
      .contextCompactionStrategy ?? DEFAULT_CONTEXT_COMPACTION_STRATEGY,
);

ipcMain.handle(
  GET_DIAGNOSTIC_LOGGING_CHANNEL,
  (): boolean => runtimeDiagnostics?.isEnabled ?? false,
);

ipcMain.handle(
  SET_DIAGNOSTIC_LOGGING_CHANNEL,
  async (_event, request: unknown): Promise<SetDiagnosticLoggingResult> => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request);
    if (!runtimeDiagnostics)
      throw new Error("Runtime diagnostics are not ready.");
    await writeDiagnosticLoggingEnabled(getPineAgentDirectory(), enabled);
    await runtimeDiagnostics.setEnabled(enabled);
    if (enabled) {
      runtimeDiagnostics.record("diagnostics:enabled", {
        version: app.getVersion(),
        electron: process.versions.electron,
        platform: process.platform,
      });
    }
    return { enabled };
  },
);

ipcMain.handle(
  SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  async (
    _event,
    request: unknown,
  ): Promise<SetContextCompactionStrategyResult> => {
    const { strategy } =
      SetContextCompactionStrategyRequestSchema.parse(request);
    await writeContextCompactionStrategy(getPineAgentDirectory(), strategy);
    await projectRuntimes?.setContextCompactionStrategy(strategy);
    return { updated: true };
  },
);

ipcMain.handle(
  SET_USER_PROFILE_CHANNEL,
  async (_event, profile: unknown): Promise<SetUserProfileResult> => {
    const parsed = UserProfileSchema.parse(profile);
    await writePineUserProfile(
      getPineAgentDirectory(),
      parsed satisfies PineUserProfile,
    );
    return { updated: true };
  },
);

ipcMain.handle(
  SET_TINYFISH_API_KEY_CHANNEL,
  async (_event, request: unknown): Promise<SetTinyFishApiKeyResult> => {
    const { apiKey } = SetTinyFishApiKeyRequestSchema.parse(request);
    const store = getTinyFishCredentialStore();
    await store.setApiKey(apiKey);
    await projectRuntimes?.setTinyFishApiKey(store.getApiKey());
    return { configured: store.isConfigured() };
  },
);

ipcMain.handle(OPEN_EXTERNAL_URL_CHANNEL, async (_event, url: unknown) => {
  await shell.openExternal(ProviderAuthUrlSchema.parse(url));
});

ipcMain.handle(
  READ_PROJECT_FILE_PREVIEW_CHANNEL,
  async (event, request: unknown) => {
    const entry = ProjectFilePreviewRequestSchema.parse(request);
    const filePath = await previewPath(event.sender.id, entry);
    return readProjectFilePreview(
      filePath,
      projectMediaUrl(event.sender.id, entry),
    );
  },
);

ipcMain.handle(
  READ_PRESENTED_FILE_PREVIEW_CHANNEL,
  async (event, request: unknown) => {
    const entry = PresentedFilePreviewRequestSchema.parse(request);
    // Presented files live outside every project folder, so the tab reads them
    // through the window-scoped grant instead of a project entry.
    const filePath = await presentedFilePath(event.sender.id, entry);
    return readProjectFilePreview(
      filePath,
      projectMediaUrl(event.sender.id, { path: filePath }, { presented: true }),
    );
  },
);

ipcMain.handle(
  REOPEN_PRESENTED_TOOL_FILE_CHANNEL,
  async (event, request: unknown) => {
    const { sessionId, toolCallId } =
      ReopenPresentedToolFileRequestSchema.parse(request);
    const target = await getProjectRuntimes().reopenPresentedToolFile(
      event.sender.id,
      sessionId,
      toolCallId,
    );
    if (target?.source === "presented") {
      presentedFiles?.remember(event.sender.id, target.path);
    }
    return target;
  },
);

ipcMain.handle(
  LIST_PROJECTS_CHANNEL,
  async (): Promise<ListProjectsResult> => ({
    projects: await getProjectRepository().list(),
  }),
);

ipcMain.handle(
  GET_MODEL_CATALOG_CHANNEL,
  async (): Promise<PineModelCatalog> => {
    const [catalog, recommendedIds] = await Promise.all([
      getProjectRuntimes().getModelCatalog(),
      modelRecommendations.get(),
    ]);
    const availableIds = new Set(catalog.models.map((model) => model.id));
    return {
      ...catalog,
      recommendedModelIds: recommendedIds.filter((id) => availableIds.has(id)),
    };
  },
);

ipcMain.handle(
  REFRESH_MODEL_CATALOG_CHANNEL,
  async (): Promise<PineModelCatalog> => {
    const [catalog, recommendedIds] = await Promise.all([
      getProjectRuntimes().refreshModelCatalog(),
      modelRecommendations.get(),
    ]);
    const availableIds = new Set(catalog.models.map((model) => model.id));
    return {
      ...catalog,
      recommendedModelIds: recommendedIds.filter((id) => availableIds.has(id)),
    };
  },
);

ipcMain.handle(
  LOOKUP_MODEL_METADATA_CHANNEL,
  async (_event, request: unknown): Promise<PineModelMetadata> =>
    modelMetadata.lookup(
      LookupModelMetadataRequestSchema.parse(
        request,
      ) satisfies LookupModelMetadataRequest,
    ),
);

ipcMain.handle(
  ADD_CUSTOM_MODEL_CHANNEL,
  async (_event, request: unknown): Promise<PineModelCatalog> =>
    getProjectRuntimes().addCustomModel(
      AddCustomModelRequestSchema.parse(
        request,
      ) satisfies AddCustomModelRequest,
    ),
);

ipcMain.handle(
  UPDATE_CUSTOM_MODEL_CHANNEL,
  async (_event, request: unknown): Promise<PineModelCatalog> =>
    getProjectRuntimes().updateCustomModel(
      UpdateCustomModelRequestSchema.parse(
        request,
      ) satisfies UpdateCustomModelRequest,
    ),
);

ipcMain.handle(
  DELETE_CUSTOM_MODEL_CHANNEL,
  async (_event, request: unknown): Promise<PineModelCatalog> =>
    getProjectRuntimes().deleteCustomModel(
      DeleteCustomModelRequestSchema.parse(
        request,
      ) satisfies DeleteCustomModelRequest,
    ),
);

ipcMain.handle(
  UPDATE_CUSTOM_PROVIDER_CHANNEL,
  async (_event, request: unknown): Promise<PineModelCatalog> =>
    getProjectRuntimes().updateCustomProvider(
      UpdateCustomProviderRequestSchema.parse(
        request,
      ) satisfies UpdateCustomProviderRequest,
    ),
);

ipcMain.handle(
  DELETE_CUSTOM_PROVIDER_CHANNEL,
  async (_event, request: unknown): Promise<PineModelCatalog> =>
    getProjectRuntimes().deleteCustomProvider(
      DeleteCustomProviderRequestSchema.parse(
        request,
      ) satisfies DeleteCustomProviderRequest,
    ),
);

const providerLoginOwners = new Map<string, number>();

ipcMain.handle(
  LOGIN_PROVIDER_CHANNEL,
  async (event, request: unknown): Promise<ProviderLoginResult> => {
    const parsed = LoginProviderRequestSchema.parse(request);
    providerLoginOwners.set(parsed.loginId, event.sender.id);
    try {
      return await getProjectRuntimes().loginProvider(parsed);
    } finally {
      providerLoginOwners.delete(parsed.loginId);
    }
  },
);

ipcMain.handle(
  RESPOND_PROVIDER_AUTH_CHANNEL,
  (event, request: unknown): Promise<{ accepted: boolean }> => {
    const parsed = ProviderAuthResponseRequestSchema.parse(request);
    if (providerLoginOwners.get(parsed.loginId) !== event.sender.id) {
      throw new Error("Provider login does not belong to this window.");
    }
    return getProjectRuntimes().respondToProviderAuth(
      parsed.loginId,
      parsed.promptId,
      parsed.value,
    );
  },
);

ipcMain.handle(
  CANCEL_PROVIDER_AUTH_CHANNEL,
  (event, request: unknown): Promise<{ cancelled: boolean }> => {
    const { loginId } = ProviderAuthLoginIdSchema.parse(request);
    if (providerLoginOwners.get(loginId) !== event.sender.id) {
      throw new Error("Provider login does not belong to this window.");
    }
    return getProjectRuntimes().cancelProviderAuth(loginId);
  },
);

ipcMain.handle(
  LOGOUT_PROVIDER_CHANNEL,
  (_event, request: unknown): Promise<{ disposed: boolean }> =>
    getProjectRuntimes().logoutProvider(
      ProviderIdSchema.parse(request).providerId,
    ),
);

ipcMain.handle(
  SELECT_MODEL_CHANNEL,
  (event, request: unknown): Promise<{ disposed: boolean }> =>
    getProjectRuntimes().selectModel(
      event.sender.id,
      SelectModelRequestSchema.parse(request),
    ),
);

ipcMain.handle(
  SELECT_UTILITY_MODEL_CHANNEL,
  (_event, request: unknown): Promise<{ updated: boolean }> =>
    getProjectRuntimes().selectUtilityModel(
      SelectUtilityModelRequestSchema.parse(request),
    ),
);

ipcMain.handle(
  SELECT_IMAGE_MODEL_CHANNEL,
  (_event, request: unknown): Promise<{ updated: boolean }> =>
    getProjectRuntimes().selectImageModel(
      SelectImageModelRequestSchema.parse(request),
    ),
);

ipcMain.handle(OPEN_PROVIDER_AUTH_URL_CHANNEL, async (_event, url: unknown) => {
  await shell.openExternal(ProviderAuthUrlSchema.parse(url));
});

ipcMain.handle(
  PICK_ATTACHMENTS_CHANNEL,
  async (event): Promise<PickAttachmentsResult> => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Add Attachments",
      buttonLabel: "Add",
      properties: ["openFile", "multiSelections"],
    };
    const selection = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options);

    if (selection.canceled) return { attachments: [] };
    const result = await inspectAttachmentPaths(selection.filePaths);
    registerAttachmentPreviewPaths(
      event.sender.id,
      result.attachments.map((attachment) => attachment.path),
    );
    return result;
  },
);

handleDiagnosticIpc(
  PICK_ATTACHMENT_FOLDERS_CHANNEL,
  async (event): Promise<PickAttachmentsResult> => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Add Attachment Folders",
      buttonLabel: "Add",
      properties: ["openDirectory", "multiSelections"],
    };
    const selection = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options);

    if (selection.canceled) return { attachments: [] };
    const result = await inspectAttachmentPaths(selection.filePaths);
    registerAttachmentPreviewPaths(
      event.sender.id,
      result.attachments.map((attachment) => attachment.path),
    );
    return result;
  },
);

ipcMain.handle(
  INSPECT_ATTACHMENTS_CHANNEL,
  async (event, request: unknown): Promise<PickAttachmentsResult> => {
    const { paths } = InspectAttachmentsRequestSchema.parse(request);
    const result = await inspectAttachmentPaths(paths);
    registerAttachmentPreviewPaths(
      event.sender.id,
      result.attachments.map((attachment) => attachment.path),
    );
    return result;
  },
);

ipcMain.handle(
  OPEN_ATTACHMENT_CHANNEL,
  async (_event, request: unknown): Promise<OpenAttachmentResult> => {
    const { path: attachmentPath } = OpenAttachmentRequestSchema.parse(request);
    const metadata = await stat(attachmentPath);
    if (!metadata.isFile() && !metadata.isDirectory()) {
      return { opened: false, error: "Attachment is not a file or folder." };
    }
    const error = await shell.openPath(attachmentPath);
    return error ? { opened: false, error } : { opened: true };
  },
);

ipcMain.handle(
  SAVE_PASTED_ATTACHMENT_CHANNEL,
  async (event, request: unknown): Promise<SavePastedAttachmentResult> => {
    const parsed = SavePastedAttachmentRequestSchema.parse(request);
    const attachmentsRoot = getProjectRuntimes().attachmentsRootFor(
      event.sender.id,
    );
    if (!attachmentsRoot) {
      throw new Error("No project is open in this window.");
    }

    const isText = parsed.mimeType === "text/plain";
    const extension = isText ? "txt" : extensionForPastedImage(parsed.mimeType);
    const displayName =
      path
        .basename(parsed.name ?? "")
        .trim()
        .slice(0, 200) || (isText ? "pasted-text.txt" : `image.${extension}`);

    await mkdir(attachmentsRoot, { recursive: true });
    const attachmentPath = path.join(
      attachmentsRoot,
      `${randomUUID()}.${extension}`,
    );
    await writeFile(attachmentPath, isText ? parsed.text : parsed.bytes);
    const metadata = await stat(attachmentPath);

    const attachment: PineAttachment = {
      extension,
      kind: "file",
      modifiedAt: metadata.mtime.toISOString(),
      name: displayName,
      path: attachmentPath,
      size: metadata.size,
    };
    registerAttachmentPreviewPaths(event.sender.id, [attachmentPath]);
    return { attachment };
  },
);

handleDiagnosticIpc(
  PICK_PROJECT_FOLDERS_CHANNEL,
  async (event, request: unknown): Promise<PickProjectFoldersResult> => {
    const { mode } = PickProjectFoldersRequestSchema.parse(request);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title:
        mode === "default" ? "Choose Default Folder" : "Add Context Folders",
      buttonLabel: mode === "default" ? "Choose" : "Add",
      properties: [
        "openDirectory",
        ...(mode === "context" ? (["multiSelections"] as const) : []),
        "createDirectory",
        "promptToCreate",
      ],
    };
    const selection = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options);

    if (selection.canceled) return { folders: [] };
    return {
      folders: selection.filePaths.map((folderPath) => ({
        access: "read-write",
        id: randomUUID(),
        name: path.basename(folderPath),
        path: folderPath,
      })),
    };
  },
);

handleDiagnosticIpc(
  CREATE_PROJECT_CHANNEL,
  async (_event, request: unknown): Promise<ProjectResult> => {
    const input = ProjectMutationSchema.parse(request);
    return { project: await getProjectRepository().create(input) };
  },
);

const McpIdentitySchema = z.object({
  projectId: z.uuid(),
  scope: z.enum(["global", "project"]),
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
});

async function mcpProjectCwd(projectId: string): Promise<string> {
  const project = await getProjectRepository().get(projectId);
  const folder = project.folders.find(
    (entry) => entry.id === project.defaultFolderId,
  );
  if (!folder?.isAvailable)
    throw new Error("The project's default folder is unavailable.");
  return folder.path;
}

async function piSkillResourceLoader(
  projectId: string | undefined,
  repository: PineSkillRepository,
): Promise<DefaultResourceLoader> {
  const { DefaultResourceLoader, SettingsManager, loadSkills } =
    await import("@earendil-works/pi-coding-agent");
  const agentDir = getPineAgentDirectory();
  const cwd = projectId ? await mcpProjectCwd(projectId) : agentDir;
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: false,
  });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalSkillPaths: projectId ? piProjectSkillPaths(cwd) : [],
    skillsOverride: filterPineManagedSkills(
      repository,
      cwd,
      agentDir,
      loadSkills,
    ),
  });
  await loader.reload();
  return loader;
}

async function readPiSkill(
  projectId: string | undefined,
  repository: PineSkillRepository,
  scope: PineSkillScope,
  name: string,
): Promise<ReadSkillResult> {
  const loader = await piSkillResourceLoader(projectId, repository);
  const skill = loader
    .getSkills()
    .skills.find(
      (candidate) =>
        candidate.name === name && pineScopeForPiSkill(candidate) === scope,
    );
  if (!skill) throw new Error(`Pi skill "${name}" was not found.`);

  return piSkillReadResult(skill);
}

async function piSkillReadResult(skill: PiSkill): Promise<ReadSkillResult> {
  return {
    content: await readFile(skill.filePath, "utf8"),
    resources: await collectSkillResources(skill.baseDir),
    skill: summarizePiSkill(skill),
    skillDirectory: skill.baseDir,
  };
}

async function editPiSkill(
  projectId: string | undefined,
  repository: PineSkillRepository,
  scope: PineSkillScope,
  name: string,
  content: string,
): Promise<ReadSkillResult> {
  const loader = await piSkillResourceLoader(projectId, repository);
  const skill = loader
    .getSkills()
    .skills.find(
      (candidate) =>
        candidate.name === name && pineScopeForPiSkill(candidate) === scope,
    );
  if (!skill) throw new Error(`Pi skill "${name}" was not found.`);
  if (summarizePiSkill(skill).readOnly) {
    throw new Error("This Pi Skill is package-managed and cannot be edited.");
  }

  const normalizedContent = `${content.trim()}\n`;
  if (
    normalizedContent.trim().length === 0 ||
    Buffer.byteLength(normalizedContent, "utf8") > 1_000_000
  ) {
    throw new Error("SKILL.md must contain 1-1,000,000 bytes of content.");
  }

  const validationDirectory = path.join(
    skill.baseDir,
    `.pine-skill-validation-${randomUUID()}`,
  );
  const stagedFile = `${skill.filePath}.${randomUUID()}.tmp`;
  await mkdir(validationDirectory, { recursive: false });
  try {
    await writeFile(
      path.join(validationDirectory, "SKILL.md"),
      normalizedContent,
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
    const { loadSkillsFromDir } =
      await import("@earendil-works/pi-coding-agent");
    const validation = loadSkillsFromDir({
      dir: validationDirectory,
      source: "temporary",
    });
    if (validation.skills.length !== 1 || validation.skills[0]?.name !== name) {
      throw new Error(
        validation.diagnostics[0]?.message ??
          "The edited Skill is not valid Pi Skill content.",
      );
    }
    await writeFile(stagedFile, normalizedContent, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(stagedFile, skill.filePath);
  } finally {
    await rm(stagedFile, { force: true });
    await rm(validationDirectory, { recursive: true, force: true });
  }

  return readPiSkill(projectId, repository, scope, name);
}

async function removePiSkill(
  projectId: string | undefined,
  repository: PineSkillRepository,
  scope: PineSkillScope,
  name: string,
): Promise<boolean> {
  const loader = await piSkillResourceLoader(projectId, repository);
  const skill = loader
    .getSkills()
    .skills.find(
      (candidate) =>
        candidate.name === name && pineScopeForPiSkill(candidate) === scope,
    );
  if (!skill) throw new Error(`Pi skill "${name}" was not found.`);
  if (summarizePiSkill(skill).readOnly) {
    throw new Error("This Pi Skill is package-managed and cannot be deleted.");
  }

  const trashDirectory = path.join(
    skill.baseDir,
    ".trash",
    `${name}-${Date.now()}-${randomUUID()}`,
  );
  await mkdir(trashDirectory, { recursive: true });
  await rename(
    skill.filePath,
    path.join(trashDirectory, path.basename(skill.filePath)),
  );
  return true;
}

async function mcpCatalog(
  event: Electron.IpcMainInvokeEvent,
  projectId: string,
): Promise<PineMcpCatalog> {
  const catalog = await listMcpServers(await mcpProjectCwd(projectId));
  if (getProjectRuntimes().isOpen(event.sender.id, projectId)) {
    const status = await getProjectRuntimes().getMcpStatus(event.sender.id);
    if (status) catalog.status = status;
  }
  return catalog;
}

ipcMain.handle(
  LIST_MCP_SERVERS_CHANNEL,
  async (event, request: unknown): Promise<PineMcpCatalog> => {
    const { projectId } = z.object({ projectId: z.uuid() }).parse(request);
    return mcpCatalog(event, projectId);
  },
);

ipcMain.handle(
  SAVE_MCP_SERVER_CHANNEL,
  async (event, request: unknown): Promise<PineMcpCatalog> => {
    const parsed = McpIdentitySchema.extend({
      previousName: McpIdentitySchema.shape.name.optional(),
      definition: z.record(z.string(), z.unknown()),
    }).parse(request);
    if (
      typeof parsed.definition.command !== "string" &&
      typeof parsed.definition.url !== "string"
    )
      throw new Error("An MCP server needs a command or URL.");
    const cwd = await mcpProjectCwd(parsed.projectId);
    await saveMcpServer(cwd, parsed);
    if (getProjectRuntimes().isOpen(event.sender.id, parsed.projectId))
      await getProjectRuntimes().reloadMcp(event.sender.id);
    return mcpCatalog(event, parsed.projectId);
  },
);

ipcMain.handle(
  REMOVE_MCP_SERVER_CHANNEL,
  async (event, request: unknown): Promise<PineMcpCatalog> => {
    const parsed = McpIdentitySchema.parse(request);
    const cwd = await mcpProjectCwd(parsed.projectId);
    await removeMcpServer(cwd, parsed);
    if (getProjectRuntimes().isOpen(event.sender.id, parsed.projectId))
      await getProjectRuntimes().reloadMcp(event.sender.id);
    return mcpCatalog(event, parsed.projectId);
  },
);

ipcMain.handle(
  LIST_SKILLS_CHANNEL,
  async (_event, request: unknown): Promise<ListSkillsResult> => {
    const parsed = SkillScopeRequestSchema.parse(request);
    const repository = await skillRepositoryFor(parsed.scope, parsed.projectId);
    const managed = repository.list(parsed.scope);
    const piSkills = await piSkillResourceLoader(parsed.projectId, repository);
    const discovered = piSkills.getSkills();
    return {
      diagnostics: [
        ...managed.diagnostics,
        ...discovered.diagnostics.map((entry) => ({
          message: entry.message,
          type:
            entry.type === "collision"
              ? ("collision" as const)
              : entry.type === "error"
                ? ("error" as const)
                : ("warning" as const),
        })),
      ],
      skills: [
        ...managed.skills,
        ...discovered.skills
          .filter((skill) => pineScopeForPiSkill(skill) === parsed.scope)
          .map(summarizePiSkill),
      ],
    };
  },
);

ipcMain.handle(
  READ_SKILL_CHANNEL,
  async (_event, request: unknown): Promise<ReadSkillResult> => {
    const parsed = SkillIdentityRequestSchema.parse(request);
    const repository = await skillRepositoryFor(parsed.scope, parsed.projectId);
    if (parsed.managedBy === "pi") {
      return readPiSkill(
        parsed.projectId,
        repository,
        parsed.scope,
        parsed.name,
      );
    }
    return repository.read(parsed.scope, parsed.name);
  },
);

ipcMain.handle(
  CREATE_SKILL_CHANNEL,
  async (_event, request: unknown): Promise<ReadSkillResult> => {
    const parsed = WriteSkillRequestSchema.parse(request);
    if (parsed.managedBy === "pi") {
      throw new Error("New Skills must use Pine-managed storage.");
    }
    return (await skillRepositoryFor(parsed.scope, parsed.projectId)).create(
      parsed.scope,
      parsed.name,
      parsed.content,
    );
  },
);

ipcMain.handle(
  EDIT_SKILL_CHANNEL,
  async (_event, request: unknown): Promise<ReadSkillResult> => {
    const parsed = WriteSkillRequestSchema.parse(request);
    const repository = await skillRepositoryFor(parsed.scope, parsed.projectId);
    if (parsed.managedBy === "pi") {
      return editPiSkill(
        parsed.projectId,
        repository,
        parsed.scope,
        parsed.name,
        parsed.content,
      );
    }
    return repository.edit(parsed.scope, parsed.name, parsed.content);
  },
);

ipcMain.handle(
  REMOVE_SKILL_CHANNEL,
  async (_event, request: unknown): Promise<RemoveSkillResult> => {
    const parsed = SkillIdentityRequestSchema.parse(request);
    const repository = await skillRepositoryFor(parsed.scope, parsed.projectId);
    return {
      removed:
        parsed.managedBy === "pi"
          ? await removePiSkill(
              parsed.projectId,
              repository,
              parsed.scope,
              parsed.name,
            )
          : await repository.remove(parsed.scope, parsed.name),
    };
  },
);

ipcMain.handle(
  SET_GLOBAL_SKILL_ENABLED_CHANNEL,
  async (_event, request: unknown): Promise<SetGlobalSkillEnabledResult> => {
    const parsed = SetGlobalSkillEnabledRequestSchema.parse(request);
    const repository = await skillRepositoryFor("project", parsed.projectId);
    await repository.setGlobalSkillEnabled(parsed.name, parsed.enabled);
    return { updated: true };
  },
);

handleDiagnosticIpc(CLOSE_PROJECT_CHANNEL, async (event): Promise<void> => {
  // Presenting a file is authorized per run, so closing the project that ran
  // the agent ends those grants with it.
  presentedFiles?.forget(event.sender.id);
  await getProjectRuntimes().dispose(event.sender.id);
});

handleDiagnosticIpc(
  OPEN_PROJECT_CHANNEL,
  async (event, request: unknown): Promise<OpenProjectResult> => {
    const { id } = ProjectIdRequestSchema.parse(request);
    const repository = getProjectRepository();
    const currentOwnerId = getProjectRuntimes().ownerOfProject(id);
    if (currentOwnerId !== undefined && currentOwnerId !== event.sender.id) {
      const project = await repository.open(id);
      const existingWindow = windowForWebContentsId(currentOwnerId);
      if (existingWindow) {
        focusWindow(existingWindow);
        return { opened: false, project };
      }
      await getProjectRuntimes().dispose(currentOwnerId);
    }

    const pending = pendingProjectOpens.get(id);
    if (pending) {
      const targetWindow = windowForWebContentsId(pending.webContentsId);
      if (targetWindow && pending.webContentsId !== event.sender.id) {
        focusWindow(targetWindow);
        return { opened: false, project: await pending.promise };
      }
      return { opened: true, project: await pending.promise };
    }

    const opening = (async (): Promise<PineProject> => {
      const project = await repository.open(id);
      await getProjectRuntimes().open(
        event.sender.id,
        project,
        repository.dataPaths(id),
      );
      return project;
    })();
    pendingProjectOpens.set(id, {
      promise: opening,
      webContentsId: event.sender.id,
    });
    try {
      return { opened: true, project: await opening };
    } finally {
      if (pendingProjectOpens.get(id)?.promise === opening) {
        pendingProjectOpens.delete(id);
      }
    }
  },
);

handleDiagnosticIpc(
  UPDATE_PROJECT_CHANNEL,
  async (event, request: unknown): Promise<ProjectResult> => {
    const parsed = UpdateProjectRequestSchema.parse(request);
    const { id } = parsed;
    const input = {
      defaultFolderId: parsed.defaultFolderId,
      folders: parsed.folders,
      name: parsed.name,
      projectColorTheme: parsed.projectColorTheme,
    };
    const repository = getProjectRepository();
    const project = await repository.update(id, input);
    if (getProjectRuntimes().isOpen(event.sender.id, id)) {
      await getProjectRuntimes().open(
        event.sender.id,
        project,
        repository.dataPaths(id),
      );
    }
    return { project };
  },
);

ipcMain.handle(
  UPDATE_PROJECT_SESSION_GROUPS_CHANNEL,
  async (_event, request: unknown): Promise<ProjectResult> => {
    const { id, sessionGroups } =
      UpdateProjectSessionGroupsRequestSchema.parse(request);
    return {
      project: await getProjectRepository().updateSessionGroups(
        id,
        sessionGroups,
      ),
    };
  },
);

ipcMain.handle(
  DELETE_PROJECT_CHANNEL,
  async (event, request: unknown): Promise<DeleteProjectResult> => {
    const { id } = ProjectIdRequestSchema.parse(request);
    if (getProjectRuntimes().isOpen(event.sender.id, id)) {
      presentedFiles?.forget(event.sender.id);
      await getProjectRuntimes().dispose(event.sender.id);
    }
    return { deleted: await getProjectRepository().delete(id) };
  },
);

// Serialize filesystem operations so concurrent drags cannot overwrite one another.
let projectFileOperationQueue: Promise<void> = Promise.resolve();
ipcMain.handle(PROJECT_FILE_OPERATION_CHANNEL, (event, request: unknown) => {
  const operation = ProjectFileOperationSchema.parse(request);
  const pending = projectFileOperationQueue.then(() =>
    getProjectRuntimes().operateFile(event.sender.id, operation, {
      trash: (filePath) => shell.trashItem(filePath),
      open: (filePath) => shell.openPath(filePath),
      reveal: (filePath) => shell.showItemInFolder(filePath),
      copyPath: (filePath) => clipboard.writeText(filePath),
    }),
  );
  projectFileOperationQueue = pending.catch(() => undefined);
  return pending;
});

async function handleProjectFileDrag(
  event: IpcMainEvent,
  request: unknown,
): Promise<void> {
  try {
    const entry = ProjectEntryReferenceSchema.parse(request);
    const filePath = getProjectRuntimes().projectEntryPathForNativeDrag(
      event.sender.id,
      entry,
    );
    await startProjectFileDrag(event.sender, filePath, (file, options) =>
      app.getFileIcon(file, options),
    );
  } catch (error) {
    console.error("Failed to start project file drag.", error);
  }
}

ipcMain.on(START_PROJECT_FILE_DRAG_CHANNEL, (event, request: unknown): void => {
  void handleProjectFileDrag(event, request);
});

ipcMain.handle(
  PROJECT_FILE_ATTACHMENTS_CHANNEL,
  async (event, request: unknown): Promise<PickAttachmentsResult> => {
    const entries = z
      .array(ProjectEntryReferenceSchema)
      .min(1)
      .max(100)
      .parse(request);
    const paths = await getProjectRuntimes().projectEntryPaths(
      event.sender.id,
      entries,
    );
    const result = await inspectAttachmentPaths(paths);
    registerAttachmentPreviewPaths(
      event.sender.id,
      result.attachments.map((attachment) => attachment.path),
    );
    return result;
  },
);

ipcMain.handle(
  LIST_PROJECT_DIRECTORY_CHANNEL,
  async (event, request: unknown): Promise<ListProjectDirectoryResult> => {
    const { folderId, relativePath } =
      ListProjectDirectoryRequestSchema.parse(request);
    return {
      entries: await getProjectRuntimes().listDirectory(
        event.sender.id,
        folderId,
        relativePath,
      ),
    };
  },
);

ipcMain.handle(
  SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
  (event, request: unknown): Promise<void> => {
    const parsed = SetWatchedProjectDirectoriesRequestSchema.parse(request);
    if (!projectFileWatchers) {
      projectFileWatchers = new ProjectFileWatcherRegistry(
        (senderId, folderId, relativePath) =>
          getProjectRuntimes().resolveDirectory(
            senderId,
            folderId,
            relativePath,
          ),
        (senderId, changes) => {
          webContents
            .fromId(senderId)
            ?.send(PROJECT_FILES_CHANGED_CHANNEL, { folders: changes });
        },
      );
    }
    return projectFileWatchers.setWatchedDirectories(event.sender.id, parsed);
  },
);

handleDiagnosticIpc(
  SEARCH_SESSIONS_CHANNEL,
  async (event, request: unknown): Promise<SearchSessionsResult> => {
    const { query } = SearchSessionsRequestSchema.parse(request);
    return {
      sessions: await getProjectRuntimes().search(event.sender.id, query),
    };
  },
);

ipcMain.handle(
  ATTACH_SESSION_CHANNEL,
  async (event, request: unknown): Promise<AttachSessionResult> => {
    const { sessionId } = SessionIdRequestSchema.parse(request);
    const attachment = await getProjectRuntimes().attachmentForSession(
      event.sender.id,
      sessionId,
    );
    registerAttachmentPreviewPaths(event.sender.id, [attachment.path]);
    return { attachment };
  },
);

handleDiagnosticIpc(
  RESUME_SESSION_CHANNEL,
  async (event, request: unknown): Promise<ResumeSessionResult> => {
    const { sessionId } = SessionIdRequestSchema.parse(request);
    return getProjectRuntimes().resume(event.sender.id, sessionId);
  },
);

ipcMain.handle(
  DELETE_SESSION_CHANNEL,
  async (event, request: unknown): Promise<DeleteSessionResult> => {
    const { sessionId } = SessionIdRequestSchema.parse(request);
    return {
      deleted: await getProjectRuntimes().deleteSession(
        event.sender.id,
        sessionId,
      ),
    };
  },
);

ipcMain.handle(
  EXPORT_SESSION_CHANNEL,
  async (event, request: unknown): Promise<ExportSessionResult> => {
    const { sessionId } = SessionIdRequestSchema.parse(request);
    const document = await getProjectRuntimes().exportSession(
      event.sender.id,
      sessionId,
    );
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) return { saved: false };
    const result = await dialog.showSaveDialog(parentWindow, {
      defaultPath: document.fileName,
      filters: [{ name: "Markdown", extensions: ["md"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return { saved: false };

    await writeFile(result.filePath, document.markdown, "utf8");
    return { path: result.filePath, saved: true };
  },
);

ipcMain.handle(
  RENAME_SESSION_CHANNEL,
  async (event, request: unknown): Promise<RenameSessionResult> => {
    const { name, sessionId } = RenameSessionRequestSchema.parse(request);
    return {
      session: await getProjectRuntimes().renameSession(
        event.sender.id,
        sessionId,
        name,
      ),
    };
  },
);

handleDiagnosticIpc(
  LOAD_SESSION_MESSAGES_CHANNEL,
  async (event, request: unknown): Promise<LoadSessionMessagesResult> => {
    const { before, includeOutline, limit, sessionId } =
      LoadSessionMessagesRequestSchema.parse(request);
    return getProjectRuntimes().loadMessages(
      event.sender.id,
      sessionId,
      before,
      limit,
      includeOutline,
    );
  },
);

ipcMain.handle(
  PROMPT_SESSION_CHANNEL,
  async (event, request: unknown): Promise<PromptSessionResult> =>
    getProjectRuntimes().prompt(
      event.sender.id,
      PromptSessionRequestSchema.parse(request),
    ),
);

ipcMain.handle(
  ABORT_SESSION_CHANNEL,
  async (event, request: unknown): Promise<AbortSessionResult> =>
    getProjectRuntimes().abort(
      event.sender.id,
      SessionIdRequestSchema.parse(request).sessionId,
    ),
);

ipcMain.handle(
  COMPACT_SESSION_CHANNEL,
  async (event, request: unknown): Promise<CompactSessionResult> =>
    getProjectRuntimes().compact(
      event.sender.id,
      SessionIdRequestSchema.parse(request).sessionId,
    ),
);

ipcMain.handle(
  DEQUEUE_STEERING_CHANNEL,
  async (event, request: unknown): Promise<DequeueSteeringResult> => {
    const { message, sessionId } = DequeueSteeringRequestSchema.parse(request);
    return getProjectRuntimes().dequeueSteering(
      event.sender.id,
      message,
      sessionId,
    );
  },
);

ipcMain.handle(
  SET_APPROVAL_MODE_CHANNEL,
  async (event, request: unknown): Promise<SetApprovalModeResult> => {
    const { approvalMode, sessionId } =
      SetApprovalModeRequestSchema.parse(request);
    return getProjectRuntimes().setApprovalMode(
      event.sender.id,
      approvalMode,
      sessionId,
    );
  },
);

ipcMain.handle(
  APPROVAL_RESPONSE_CHANNEL,
  (event, request: unknown): { accepted: boolean } =>
    getProjectRuntimes().respondApproval(
      event.sender.id,
      RespondApprovalRequestSchema.parse(
        request,
      ) satisfies RespondApprovalRequest,
    ),
);

ipcMain.handle(
  QUESTIONNAIRE_RESPONSE_CHANNEL,
  (event, request: unknown): { accepted: boolean } =>
    getProjectRuntimes().respondQuestionnaire(
      event.sender.id,
      RespondQuestionnaireRequestSchema.parse(
        request,
      ) satisfies RespondQuestionnaireRequest,
    ),
);

ipcMain.handle(
  SET_SIDEBAR_VIBRANCY_CHANNEL,
  (event, request: unknown): SetSidebarVibrancyResult => {
    const { enabled } = SetSidebarVibrancyRequestSchema.parse(request);
    if (process.platform !== "darwin") return { applied: false };

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return { applied: false };

    window.setVibrancy(enabled ? "sidebar" : null);
    // An opaque window background covers the native vibrancy material, so it
    // must become fully transparent while the effect is enabled.
    window.setBackgroundColor(
      enabled ? TRANSPARENT_WINDOW_BACKGROUND : OPAQUE_WINDOW_BACKGROUND,
    );
    return { applied: true };
  },
);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
async function initializeApp(): Promise<void> {
  pineAgentDirectory = path.join(app.getPath("userData"), "agent");
  const settings = await readPineAgentSettings(pineAgentDirectory);
  runtimeDiagnostics = new RuntimeDiagnostics(
    app.getPath("logs"),
    settings.diagnosticLoggingEnabled ?? false,
  );
  runtimeDiagnostics.record("app:start", {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
  });
  powerMonitor.on("suspend", () => runtimeDiagnostics?.record("power:suspend"));
  powerMonitor.on("resume", () => runtimeDiagnostics?.record("power:resume"));
  powerMonitor.on("lock-screen", () =>
    runtimeDiagnostics?.record("power:lock-screen"),
  );
  powerMonitor.on("unlock-screen", () =>
    runtimeDiagnostics?.record("power:unlock-screen"),
  );
  app.on("child-process-gone", (_event, details) => {
    runtimeDiagnostics?.record("child-process:gone", {
      type: details.type,
      ...(details.name ? { name: details.name } : {}),
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  // Dev runs inside Electron.app, so it cannot use Pine's bundle asset catalog.
  // Preview Apple's generated compatibility image here. Packaged apps retain
  // the native Icon Composer resource; never override it with dock.setIcon().
  if (!app.isPackaged) app.dock?.setIcon(appIconPath);

  // Windows agent tools rely on a one-time elevated sandbox installation. Keep
  // the renderer closed until that prerequisite is complete. Smoke tests are
  // intentionally non-interactive and must remain launch-only.
  if (process.platform === "win32" && !isSmokeTest) {
    if (!(await ensureAppWindowsSandboxReady())) {
      app.quit();
      return;
    }
  } else {
    windowsSandboxReady = true;
  }

  tinyFishCredentialStore = new TinyFishCredentialStore(
    path.join(app.getPath("userData"), "tinyfish-api-key"),
  );
  await tinyFishCredentialStore.load();
  agentHost = AgentProcessHost.createDefault();
  projectsRootPath = path.join(app.getPath("userData"), PROJECTS_DIRECTORY);
  projectRepository = new ProjectRepository(projectsRootPath);
  const releaseConfigPath = app.isPackaged
    ? path.join(process.resourcesPath, "release.json")
    : path.join(app.getAppPath(), "../../.pine/release.json");
  const manifestUrl = app.isPackaged
    ? await readUpdateManifestUrl(releaseConfigPath)
    : null;
  appUpdater = new AppUpdater({
    arch: process.arch,
    currentExecutable: process.execPath,
    currentVersion: app.getVersion(),
    emit: broadcastUpdateEvent,
    manifestUrl,
    platform: process.platform,
    quit: () => app.quit(),
    tempDirectory: app.getPath("temp"),
    windowsUpdater: process.platform === "win32" ? autoUpdater : undefined,
  });
  registerAttachmentImageProtocol();
  registerProjectMediaProtocol();
  presentedFiles = new PresentedFileRegistry();
  projectRuntimes = new ProjectRuntimeRegistry(
    agentHost,
    pineAgentDirectory,
    () => tinyFishCredentialStore?.getApiKey(),
  );
  agentHost.subscribe((agentEvent) => {
    if (isProviderAuthEvent(agentEvent)) {
      const ownerId = providerLoginOwners.get(agentEvent.loginId);
      if (ownerId !== undefined) {
        webContents
          .fromId(ownerId)
          ?.send(PROVIDER_AUTH_EVENT_CHANNEL, agentEvent);
      }
      return;
    }
    const ownerId = projectRuntimes?.ownerOfSession(agentEvent.sessionId);
    if (ownerId === undefined) return;
    if (agentEvent.type === "present-file") {
      void forwardPresentedFile(agentEvent, ownerId);
      return;
    }
    if (agentEvent.type === "context-usage") {
      projectRuntimes?.updateContextUsage(agentEvent.sessionId, {
        tokens: agentEvent.tokens,
        contextWindow: agentEvent.contextWindow,
        percent: agentEvent.percent,
        cost: agentEvent.cost,
        cacheHitRate: agentEvent.cacheHitRate,
      });
    } else if (agentEvent.type === "session-updated") {
      projectRuntimes?.updateSessionSummary(
        agentEvent.sessionId,
        agentEvent.summary,
      );
    } else if (agentEvent.type === "approval-request") {
      projectRuntimes?.trackApproval(
        agentEvent.requestId,
        ownerId,
        agentEvent.sessionId,
      );
      requestApprovalAttention(ownerId);
    } else if (agentEvent.type === "approval-decided") {
      projectRuntimes?.forgetApproval(agentEvent.requestId);
      clearApprovalAttention();
    } else if (agentEvent.type === "questionnaire-request") {
      projectRuntimes?.trackQuestionnaire(
        agentEvent.requestId,
        ownerId,
        agentEvent.sessionId,
      );
      requestApprovalAttention(ownerId);
    } else if (agentEvent.type === "questionnaire-decided") {
      projectRuntimes?.forgetQuestionnaire(agentEvent.requestId);
      clearApprovalAttention();
    }
    if (
      agentEvent.type === "run-state" &&
      (agentEvent.state === "idle" || agentEvent.state === "failed")
    ) {
      projectRuntimes?.clearSessionInteractions(agentEvent.sessionId);
    }
    webContents.fromId(ownerId)?.send(SESSION_EVENT_CHANNEL, agentEvent);
  });
  createWindow();
}

app.on("ready", () => {
  void initializeApp();
});

app.on("will-quit", () => {
  projectFileWatchers?.dispose();
  void agentHost?.dispose();
  releaseWindowsSandboxRuntimeAccess();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    if (process.platform === "win32" && !isSmokeTest) {
      void ensureAppWindowsSandboxReady().then((ready) => {
        if (ready && BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        } else if (!ready) {
          app.quit();
        }
      });
    } else {
      createWindow();
    }
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
