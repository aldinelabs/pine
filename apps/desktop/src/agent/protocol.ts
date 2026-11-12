import type {
  PineAgentEvent,
  PineApprovalMode,
  PineMessageRewriteTarget,
  PineApprovalTrigger,
  PineJsonValue,
} from "../shared/agent";
import type {
  AddCustomModelRequest,
  DeleteCustomModelRequest,
  DeleteCustomProviderRequest,
  LoginProviderRequest,
  PineImageModelSelection,
  PineVideoModelSelection,
  PineModelCatalog,
  PineProviderAuthEvent,
  PineThinkingLevel,
  PineApprovalModelSelection,
  PineUtilityModelSelection,
  ProviderLoginResult,
  UpdateCustomModelRequest,
  UpdateCustomProviderRequest,
} from "../shared/models";
import type {
  PineContextUsage,
  PineSessionNotice,
  PineSessionSummary,
  SessionRenamer,
  SessionHostOperation,
  SessionHostResult,
} from "../shared/sessions";

export type {
  AgentHostMessage,
  AgentHostRelative,
  AgentHostSession,
  AgentHostSessionTree,
  AgentHostTreeSession,
  SessionHostOperation,
  SessionHostResult,
  SessionTreeOperation,
} from "../shared/sessions";
import type {
  ProjectColorThemeSetting,
  ProjectHostOperation,
  ProjectHostResult,
  ProjectIcon,
} from "../shared/projects";
export type {
  AgentProjectFolder,
  ProjectHostOperation,
  ProjectHostResult,
} from "../shared/projects";
import type {
  PineContextCompactionRoute,
  PineContextCompactionStrategy,
} from "../shared/preferences";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import type { McpStatusSnapshot } from "pi-mcp-adapter";
import type {
  AutomationHostOperation,
  AutomationMcpGrant,
} from "../shared/automation";
import type { ApproximateLocation } from "../shared/approximateLocation";
import type { McpHostOperation } from "../shared/mcp";
import type { PineSessionMutator } from "../shared/sessionMutators";
import type { WorkbenchState } from "../shared/workbench";
import type {
  BackgroundTaskResult,
  ListBackgroundTasksResult,
  ReadBackgroundTaskOutputResult,
} from "../shared/backgroundTasks";

export interface AgentFolderGrant {
  access: "read-only" | "read-write";
  path: string;
}

export interface AgentSessionLocation {
  agentDir: string;
  cwd: string;
  folders: AgentFolderGrant[];
  /** Pine-managed project skill directory, outside the user's shared folders. */
  skillsRoot?: string;
  /** Project-specific global Skill enablement settings. */
  skillsSettingsPath?: string;
  sessionsRoot: string;
  /** In-memory TinyFish credential; never written to a session file. */
  tinyFishApiKey?: string;
  /** Pine's built-in temporary workspace ("No Project"). */
  temporaryWorkspace?: boolean;
  /** The user-facing name of the session's project, for the agent's context. */
  projectName?: string;
  /** Initial permission mode for the session. YOLO bypasses all Pine sandbox,
   * folder, and approval controls; omitted defaults to `auto-approve`. */
  approvalMode?: PineApprovalMode;
  /**
   * A new session started as a sub-session of this one. The worker records
   * it in the session file, which is what a reopened session reads.
   */
  parentSessionId?: string;
  /** Set only for an unattended automation run; see docs/automation.md. */
  automation?: AgentAutomationRun;
}

export interface AgentAutomationRun {
  automationId: string;
  runId: string;
  name: string;
  /** Hosts the run's sandbox may reach; the network is closed otherwise. */
  network: string[];
  /** Passed to shell commands only, and redacted from every tool result. */
  secrets: { name: string; env: string; value: string }[];
  /** Pine tools the run may use besides `automation_report`. */
  toolNames: string[];
  /** MCP tools the run may call, and the folder whose MCP config applies. */
  mcp?: { cwd: string; grants: AutomationMcpGrant[] };
  /** Structured data from the detectors, delivered apart from instructions. */
  payload: PineJsonValue;
}

/** A user project as the agent sees it when choosing where to move. */
export interface AgentHostProject {
  id: string;
  name: string;
  /** The project the asking session currently runs in. */
  current?: boolean;
  defaultFolderPath: string;
  folders: { access: "read-only" | "read-write"; name: string; path: string }[];
  icon: ProjectIcon;
  /** `default` follows Pine's default colour theme from Appearance. */
  accentColor: ProjectColorThemeSetting;
}

/** Questions only the main process can answer, asked from inside a tool. */
export type AgentHostRequest =
  | { kind: "list-projects" }
  | { kind: "teleport"; projectId: string }
  | { kind: "session"; operation: SessionHostOperation }
  | { kind: "project"; operation: ProjectHostOperation }
  | { kind: "workbench-state" }
  | { kind: "approximate-location" }
  | { kind: "automation"; operation: AutomationHostOperation }
  | { kind: "mcp"; operation: McpHostOperation };

export type AgentHostResponse =
  | { kind: "list-projects"; projects: AgentHostProject[] }
  | { kind: "workbench-state"; state: WorkbenchState }
  | { kind: "approximate-location"; location: ApproximateLocation | null }
  | { kind: "teleport"; projectName: string; cwd: string }
  | { kind: "session"; result: SessionHostResult }
  | { kind: "project"; result: ProjectHostResult }
  | { kind: "automation"; result: PineJsonValue }
  | { kind: "mcp"; result: PineJsonValue };

export type AgentHostReply =
  { ok: true; response: AgentHostResponse } | { ok: false; error: string };

/** How a gate resolved an escalated tool call. */
export type GateDecision =
  | {
      kind: "allow";
      scope?: "once" | "session";
      /** Set when the auto-approval reviewer allowed it, not the user. */
      reviewer?: "judge";
    }
  | {
      kind: "deny";
      reason?: string;
      /** Set by the long-context activation card, whose rejections are choices. */
      choice?: "compact" | "abort";
    };

export type AgentWorkerInbound =
  | AgentWorkerRequest
  | { type: "approval:response"; requestId: string; decision: GateDecision }
  | ({ type: "host:response"; requestId: string } & AgentHostReply)
  | {
      type: "questionnaire:response";
      requestId: string;
      submission: AskUserQuestionSubmission;
    };

export type PineRuntimeEvent = PineAgentEvent | PineProviderAuthEvent;

export type AgentWorkerRequest =
  | {
      id: string;
      type: "session:create";
      location: AgentSessionLocation;
    }
  | {
      id: string;
      type: "session:open";
      location: AgentSessionLocation;
      sessionFile: string;
    }
  | ({
      id: string;
      type: "side-chat:open";
    } & AgentSideChatOpenRequest)
  | {
      id: string;
      type: "session:prompt";
      sessionId: string;
      message: string;
      locale: "en-US" | "zh-CN";
      /** User-selected attachment paths granted read-only access. */
      attachedPaths?: string[];
      approvalMode?: PineApprovalMode;
      streamingBehavior?: "followUp" | "steer";
      rewrite?: PineMessageRewriteTarget;
    }
  | {
      id: string;
      type: "session:mutate";
      sessionId: string;
      mutators: PineSessionMutator[];
    }
  | {
      id: string;
      type: "session:abort";
      sessionId: string;
    }
  | {
      id: string;
      type: "session:compact";
      sessionId: string;
    }
  | {
      id: string;
      type: "session:dequeue-steering";
      sessionId: string;
      message: string;
    }
  | {
      id: string;
      type: "session:send-steering-now";
      sessionId: string;
      message: string;
    }
  | {
      id: string;
      type: "session:set-approval-mode";
      sessionId: string;
      approvalMode: PineApprovalMode;
    }
  | {
      id: string;
      type: "session:rename";
      sessionId: string;
      name: string;
      by: SessionRenamer;
    }
  | {
      id: string;
      /** Tells a session about one of its sub-sessions, waking it if idle. */
      type: "session:notify";
      sessionId: string;
      notice: PineSessionNotice;
      /** What the model reads: the sub-session's state and last reply. */
      content: string;
    }
  | {
      id: string;
      type: "session:dispose";
      sessionId: string;
    }
  | {
      id: string;
      type: "mcp:reload";
      sessionId: string;
    }
  | {
      id: string;
      type: "mcp:status";
      sessionId: string;
    }
  | {
      id: string;
      type: "background:list";
      sessionId: string;
    }
  | {
      id: string;
      type: "background:stop";
      sessionId: string;
      taskId: string;
    }
  | {
      id: string;
      type: "background:output";
      sessionId: string;
      taskId: string;
      maxBytes: number;
    }
  | {
      id: string;
      type: "models:catalog";
      agentDir: string;
    }
  | {
      id: string;
      type: "models:refresh-catalog";
      agentDir: string;
    }
  | ({
      id: string;
      type: "models:add-custom";
      agentDir: string;
    } & AddCustomModelRequest)
  | ({
      id: string;
      type: "models:update-custom";
      agentDir: string;
    } & UpdateCustomModelRequest)
  | ({
      id: string;
      type: "models:delete-custom";
      agentDir: string;
    } & DeleteCustomModelRequest)
  | ({
      id: string;
      type: "providers:update-custom";
      agentDir: string;
    } & UpdateCustomProviderRequest)
  | ({
      id: string;
      type: "providers:delete-custom";
      agentDir: string;
    } & DeleteCustomProviderRequest)
  | ({
      id: string;
      type: "provider:login";
      agentDir: string;
    } & LoginProviderRequest)
  | {
      id: string;
      type: "provider:auth-response";
      loginId: string;
      promptId: string;
      value: string;
    }
  | {
      id: string;
      type: "provider:auth-cancel";
      loginId: string;
    }
  | {
      id: string;
      type: "provider:logout";
      agentDir: string;
      providerId: string;
    }
  | {
      id: string;
      type: "models:select";
      agentDir: string;
      modelId: string;
      providerId: string;
      sessionId?: string;
      thinkingLevel: PineThinkingLevel;
    }
  | {
      id: string;
      type: "models:select-utility";
      agentDir: string;
      selection: PineUtilityModelSelection;
    }
  | {
      id: string;
      type: "models:select-approval";
      agentDir: string;
      selection: PineApprovalModelSelection;
    }
  | {
      id: string;
      type: "models:select-image";
      agentDir: string;
      selection: PineImageModelSelection;
    }
  | {
      id: string;
      type: "models:select-video";
      agentDir: string;
      selection: PineVideoModelSelection;
    }
  | {
      id: string;
      type: "runtime:dispose";
    }
  | {
      id: string;
      type: "runtime:set-tinyfish-api-key";
      /** Undefined clears the in-memory key and hides network tools. */
      tinyFishApiKey?: string;
    }
  | {
      id: string;
      type: "runtime:set-context-compaction-strategy";
      strategy: PineContextCompactionStrategy;
    }
  | {
      id: string;
      type: "runtime:set-context-compaction-route";
      route: PineContextCompactionRoute;
    };

export type AgentWorkerRequestInput = AgentWorkerRequest extends infer TRequest
  ? TRequest extends { id: string }
    ? Omit<TRequest, "id">
    : never
  : never;

export interface AgentWorkerSessionResult {
  session: PineSessionSummary;
  sessionFile?: string;
  contextUsage?: PineContextUsage;
}

/** Opens a side chat: a fork of a conversation, or one saved earlier. */
export interface AgentSideChatOpenRequest {
  location: AgentSessionLocation;
  parentSessionId: string;
  /** The parent's file, read when the parent is not live. */
  parentSessionFile?: string;
  /** Where the parent's saved side chats are kept. */
  sideChatsDirectory: string;
  /** Reopens this saved side chat instead of forking a new one. */
  sideChatFile?: string;
  /**
   * The passage a new side chat follows up. A side chat with one is saved;
   * one without lives only in memory.
   */
  anchor?: PineJsonValue;
}

export interface AgentWorkerSideChatResult extends AgentWorkerSessionResult {
  parentSessionId: string;
  anchor?: PineJsonValue;
  /** The side chat's own messages, after the conversation it forked. */
  messages: { id: string; message: PineJsonValue }[];
}

export interface AgentWorkerPromptResult extends AgentWorkerSessionResult {
  accepted: boolean;
}

export type AgentWorkerResult =
  | McpStatusSnapshot
  | ListBackgroundTasksResult
  | BackgroundTaskResult
  | ReadBackgroundTaskOutputResult
  | AgentWorkerSessionResult
  | AgentWorkerSideChatResult
  | AgentWorkerPromptResult
  | PineModelCatalog
  | ProviderLoginResult
  | { accepted: boolean }
  | { aborted: boolean }
  | { compacted: boolean }
  | { message?: string; removed: boolean }
  | { sent: boolean }
  | { cancelled: boolean }
  | { disposed: boolean }
  | { delivered: boolean }
  | { updated: boolean }
  | AgentWorkerMutateResult;

/** The mutators that changed the session; already-applied ones are skipped. */
export interface AgentWorkerMutateResult {
  applied: PineSessionMutator[];
}

export type AgentWorkerMessage =
  | { type: "ready" }
  | {
      type: "response";
      id: string;
      ok: true;
      result: AgentWorkerResult;
    }
  | {
      type: "response";
      id: string;
      ok: false;
      error: { message: string; code?: string };
    }
  | { type: "event"; event: PineRuntimeEvent };

export type GateReviewInput = {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  trigger: PineApprovalTrigger;
  input?: PineJsonValue;
  evidence?: string;
  signal?: AbortSignal;
};

export function toPineJsonValue(value: unknown): PineJsonValue {
  if (value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.parse(JSON.stringify(value)) as PineJsonValue;
  } catch {
    return null;
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
