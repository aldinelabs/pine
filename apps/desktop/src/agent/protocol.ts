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
  PineModelCatalog,
  PineProviderAuthEvent,
  PineThinkingLevel,
  PineUtilityModelSelection,
  ProviderLoginResult,
  UpdateCustomModelRequest,
  UpdateCustomProviderRequest,
} from "../shared/models";
import type { PineContextUsage, PineSessionSummary } from "../shared/sessions";
import type { PineContextCompactionStrategy } from "../shared/preferences";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import type { McpStatusSnapshot } from "pi-mcp-adapter";
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
  /** Initial permission mode for the session. YOLO bypasses all Pine sandbox,
   * folder, and approval controls; omitted defaults to `auto-approve`. */
  approvalMode?: PineApprovalMode;
}

/** How a gate resolved an escalated tool call. */
export type GateDecision =
  | { kind: "allow"; scope?: "once" | "session" }
  | { kind: "deny"; reason?: string };

export type AgentWorkerInbound =
  | AgentWorkerRequest
  | { type: "approval:response"; requestId: string; decision: GateDecision }
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
      type: "session:set-approval-mode";
      sessionId: string;
      approvalMode: PineApprovalMode;
    }
  | {
      id: string;
      type: "session:rename";
      sessionId: string;
      name: string;
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
      type: "models:select-image";
      agentDir: string;
      selection: PineImageModelSelection;
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

export interface AgentWorkerPromptResult extends AgentWorkerSessionResult {
  accepted: boolean;
}

export type AgentWorkerResult =
  | McpStatusSnapshot
  | ListBackgroundTasksResult
  | BackgroundTaskResult
  | ReadBackgroundTaskOutputResult
  | AgentWorkerSessionResult
  | AgentWorkerPromptResult
  | PineModelCatalog
  | ProviderLoginResult
  | { accepted: boolean }
  | { aborted: boolean }
  | { compacted: boolean }
  | { message?: string; removed: boolean }
  | { cancelled: boolean }
  | { disposed: boolean }
  | { updated: boolean };

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
