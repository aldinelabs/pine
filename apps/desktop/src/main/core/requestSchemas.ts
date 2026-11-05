import { z } from "zod";
import {
  MAX_PASTED_IMAGE_BYTES,
  MAX_PASTED_TEXT_BYTES,
  PASTED_IMAGE_MIME_TYPES,
} from "../../shared/attachments";
import {
  PROJECT_COLOR_THEME_SETTINGS,
  PROJECT_ICONS,
} from "../../shared/projects";
import { ProjectEntryReferenceSchema } from "../projectFileOperations";

// Validation for every request the shared handlers accept, from any transport.

export const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PASTED_ATTACHMENT_NAME_LENGTH = 200;

export const SavePastedAttachmentRequestSchema = z.union([
  z.object({
    bytes: z
      .instanceof(Uint8Array)
      .refine(
        (bytes) =>
          bytes.byteLength > 0 && bytes.byteLength <= MAX_PASTED_IMAGE_BYTES,
      ),
    mimeType: z.enum(PASTED_IMAGE_MIME_TYPES),
    name: z.string().max(MAX_PASTED_ATTACHMENT_NAME_LENGTH).optional(),
    projectId: z.uuid(),
  }),
  z.object({
    mimeType: z.literal("text/plain"),
    name: z.string().max(MAX_PASTED_ATTACHMENT_NAME_LENGTH).optional(),
    projectId: z.uuid(),
    text: z
      .string()
      .refine((text) => text.trim().length > 0)
      .refine(
        (text) => Buffer.byteLength(text, "utf8") <= MAX_PASTED_TEXT_BYTES,
      ),
  }),
]);

export const ProjectFolderInputSchema = z.object({
  access: z.enum(["read-only", "read-write"]),
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  path: z.string().min(1).max(4_096),
});
export const SkillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const PiSkillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/)
  .refine(
    (name) =>
      !name.startsWith("-") && !name.endsWith("-") && !name.includes("--"),
  );
export const ProjectMutationSchema = z
  .object({
    defaultFolderId: z.uuid(),
    folders: z.array(ProjectFolderInputSchema).min(1),
    name: z.string().trim().min(1).max(100),
    projectColorTheme: z.enum(PROJECT_COLOR_THEME_SETTINGS).default("default"),
    projectIcon: z.enum(PROJECT_ICONS).optional(),
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
export const ProjectIdRequestSchema = z.object({ id: z.uuid() });
export const UpdateProjectSessionGroupsRequestSchema = z.object({
  id: z.uuid(),
  sessionGroups: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().trim().min(1).max(100),
      sessionIds: z.array(z.uuid()),
    }),
  ),
});
export const SkillScopeRequestSchema = z
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
export const SkillIdentityRequestSchema = SkillScopeRequestSchema.safeExtend({
  managedBy: z.enum(["pine", "pi"]).optional(),
  name: PiSkillNameSchema,
});
export const WriteSkillRequestSchema = SkillIdentityRequestSchema.safeExtend({
  content: z.string().trim().min(1).max(1_000_000),
});
export const SetGlobalSkillEnabledRequestSchema = z.object({
  enabled: z.boolean(),
  name: SkillNameSchema,
  projectId: z.uuid(),
});
export const ProjectFilePreviewRequestSchema = ProjectEntryReferenceSchema;
export const PresentedFilePreviewRequestSchema = z.object({
  path: z.string().min(1).max(4096),
});
export const ReopenPresentedToolFileRequestSchema = z.object({
  projectId: z.uuid(),
  sessionId: z.uuid(),
  toolCallId: z.string().min(1).max(256),
});

export const UpdateProjectRequestSchema = ProjectMutationSchema.safeExtend({
  id: z.uuid(),
});
export const SearchSessionsRequestSchema = z.object({
  projectId: z.uuid(),
  query: z.string().max(500),
});
export const SearchAllSessionsRequestSchema = z.object({
  query: z.string().max(500),
});
export const SessionIdRequestSchema = z.object({
  sessionId: z.uuid(),
});
export const ProjectSessionRequestSchema = SessionIdRequestSchema.extend({
  projectId: z.uuid(),
});
export const BackgroundTaskRequestSchema = SessionIdRequestSchema.extend({
  taskId: z.string().trim().min(1).max(64),
});
export const RenameSessionRequestSchema = ProjectSessionRequestSchema.extend({
  name: z.string().trim().min(1).max(200),
});
export const LoadSessionMessagesRequestSchema = z.object({
  // History cursors are opaque, versioned strings derived from stable entry
  // sequence numbers; entry-ID cursors remain accepted for compatibility.
  before: z.string().min(1).max(128).optional(),
  includeOutline: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  projectId: z.uuid(),
  sessionId: z.uuid(),
});
export const PromptSessionRequestSchema = z.object({
  locale: z.enum(["en-US", "zh-CN"]).default("en-US"),
  message: z.string().trim().min(1).max(100_000),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new"), projectId: z.uuid() }),
    z.object({
      kind: z.literal("session"),
      projectId: z.uuid(),
      sessionId: z.uuid(),
    }),
  ]),
  streamingBehavior: z.enum(["follow-up", "steer"]).optional(),
  approvalMode: z
    .enum(["let-me-review", "auto-approve", "autonomous", "YOLO"])
    .optional(),
  rewrite: z
    .object({
      messageId: z.string().min(1).max(200),
      userMessagesAfter: z.number().int().min(0).max(1_000_000),
    })
    .optional(),
  mutators: z
    .array(
      z.object({
        kind: z.literal("activate-authoring"),
        target: z.enum(["skill", "automation", "mcp"]),
      }),
    )
    .max(8)
    .optional(),
});
export const DequeueSteeringRequestSchema = SessionIdRequestSchema.extend({
  message: z.string().min(1).max(100_000),
});
export const SendSteeringNowRequestSchema = DequeueSteeringRequestSchema;
export const RespondApprovalRequestSchema = z.object({
  requestId: z.uuid(),
  action: z.enum(["approve", "reject", "guide", "compact", "abort"]),
  guidance: z.string().trim().min(1).max(10_000).optional(),
});
export const RespondQuestionnaireRequestSchema = z.object({
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
export const SetApprovalModeRequestSchema = SessionIdRequestSchema.extend({
  approvalMode: z.enum(["let-me-review", "auto-approve", "autonomous", "YOLO"]),
});
export const SetContextCompactionStrategyRequestSchema = z.object({
  strategy: z.enum(["passive", "recommended"]),
});
export const SetContextCompactionRouteRequestSchema = z.object({
  route: z.enum(["model", "semantic"]),
});
export const LoginProviderRequestSchema = z.object({
  authType: z.enum(["api_key", "oauth"]),
  loginId: z.uuid(),
  providerId: z.string().trim().min(1).max(200),
});
export const CustomModelDefinitionSchema = z.object({
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
export const ProviderIdSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
});
export const AddCustomModelRequestSchema = z.intersection(
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
export const UpdateCustomModelRequestSchema = z.intersection(
  CustomModelDefinitionSchema,
  z.object({
    originalModelId: z.string().trim().min(1).max(500),
    providerId: z.string().trim().min(1).max(200),
  }),
);
export const UpdateCustomProviderRequestSchema = z.object({
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
export const DeleteCustomModelRequestSchema = z.object({
  modelId: z.string().trim().min(1).max(500),
  providerId: z.string().trim().min(1).max(200),
});
export const DeleteCustomProviderRequestSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
});
export const LookupModelMetadataRequestSchema = z.object({
  modelId: z.string().trim().min(1).max(500),
  providerId: z.string().trim().min(1).max(200).optional(),
});
export const ProviderAuthResponseRequestSchema = z.object({
  loginId: z.uuid(),
  promptId: z.uuid(),
  value: z.string().max(100_000),
});
export const ProviderAuthLoginIdSchema = z.object({ loginId: z.uuid() });
export const SelectModelRequestSchema = z.object({
  modelId: z.string().trim().min(1).max(500),
  projectId: z.uuid().optional(),
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
export const SelectUtilityModelRequestSchema = SelectModelRequestSchema.pick({
  modelId: true,
  providerId: true,
});
export const SelectApprovalModelRequestSchema = SelectModelRequestSchema.pick({
  modelId: true,
  providerId: true,
});
export const SelectImageModelRequestSchema = SelectModelRequestSchema.pick({
  modelId: true,
  providerId: true,
});
export const SelectVideoModelRequestSchema = SelectModelRequestSchema.pick({
  modelId: true,
  providerId: true,
});
export const ListProjectDirectoryRequestSchema = ProjectEntryReferenceSchema;
export const SetTinyFishApiKeyRequestSchema = z.object({
  apiKey: z.string().trim().min(1).max(4_096),
});
export const UserProfileSchema = z.object({
  communicationStyle: z.enum(["calm-professional", "neutral", "warm-friendly"]),
  customInstructions: z.string().max(20_000),
  interfaceElements: z.enum(["rich", "simple"]),
  nickname: z.string().trim().max(100),
  personalDetails: z.string().max(10_000),
  technicalBackground: z.enum(["general-user", "professional-user"]),
});
export const InspectAttachmentsRequestSchema = z.object({
  paths: z.array(z.string().min(1).max(4_096)).max(100),
});

export const McpIdentitySchema = z.object({
  projectId: z.uuid(),
  scope: z.enum(["global", "project"]),
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
});
export const ClearProjectStorageRequestSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["attachments", "temporary"]),
});

const SideChatAnchorSchema = z.object({
  messageId: z.string().trim().min(1).max(200),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  text: z.string().min(1).max(20_000),
  quote: z.string().min(1).max(20_000),
});
export const OpenSideChatRequestSchema = ProjectSessionRequestSchema.extend({
  sideChatId: z.uuid().optional(),
  anchor: SideChatAnchorSchema.refine(
    (anchor) => anchor.end > anchor.start,
  ).optional(),
}).refine((request) => !(request.sideChatId && request.anchor), {
  message: "A saved side chat already has its anchor.",
});
export const SideChatRequestSchema = z.object({
  projectId: z.uuid(),
  sideChatId: z.uuid(),
});
export const PromptSideChatRequestSchema = SideChatRequestSchema.extend({
  locale: z.enum(["en-US", "zh-CN"]).default("en-US"),
  message: z.string().trim().min(1).max(100_000),
});
export const DeleteSideChatRequestSchema = SideChatRequestSchema.extend({
  sessionId: z.uuid(),
});
