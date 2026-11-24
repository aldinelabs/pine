import type { PineApprovalMode } from "./agent";

/**
 * Pine's Assistant (internal name: orchestrator), the one conversation that
 * manages Pine instead of working in a project: it looks up, dispatches and
 * reports, and never does the work itself. See docs/orchestrator-proposal.md.
 */

/** User-facing name, kept in one place until the product name is settled. */
export const ASSISTANT_DISPLAY_NAME = {
  "en-US": "Assistant",
  "zh-CN": "助理",
} as const;

/**
 * The Assistant lives in a hidden built-in project with fixed ids, so it
 * reuses project runtimes and session storage. Its data sits in the data
 * directory's `assistant/` folder, beside `projects/`, so project listings
 * never see it.
 */
export const ASSISTANT_PROJECT_ID =
  "00000000-0000-4000-8000-000000000003" as const;
export const ASSISTANT_FOLDER_ID =
  "00000000-0000-4000-8000-000000000004" as const;
/** The Assistant's root inside Pine's data directory. */
export const ASSISTANT_DIRECTORY = "assistant" as const;
/** Its working directory inside that root: always empty, shared with no one. */
export const ASSISTANT_WORKSPACE_DIRECTORY = "workspace" as const;
/** Which sessions the Assistant dispatched, and where each one runs. */
export const ASSISTANT_DISPATCHES_FILE = "dispatches.json" as const;
/** The Assistant's one conversation. */
export const ASSISTANT_STATE_FILE = "state.json" as const;

/** The virtual client that holds the Assistant's runtime; see isVirtualClient. */
export const ASSISTANT_CLIENT_ID = -3;

/** The Assistant runs supervised by an AI reviewer, never above it. */
export const ASSISTANT_APPROVAL_MODE: PineApprovalMode = "auto-approve";

export function isAssistantProject(projectId: string | undefined): boolean {
  return projectId === ASSISTANT_PROJECT_ID;
}

export const PINE_OVERVIEW_TOOL_NAME = "pine_overview" as const;
export const DISPATCH_TASK_TOOL_NAME = "dispatch_task" as const;
export const SESSION_DIGEST_TOOL_NAME = "session_digest" as const;

/**
 * Development only: send the Assistant a message and wait for its reply.
 * Registered only in an unpackaged build started with PINE_DEV_ASSISTANT=1.
 */
export const ASSISTANT_DEBUG_PROMPT_CHANNEL = "assistant:debug-prompt" as const;
/** The window argument that makes the preload expose the development entry. */
export const ASSISTANT_DEBUG_ARGUMENT = "--pine-assistant-debug" as const;

export interface AssistantDebugPromptRequest {
  message: string;
  locale?: "en-US" | "zh-CN";
}

export interface AssistantDebugPromptResult {
  sessionId: string;
  /** The Assistant's last reply once its turn ended, or empty. */
  reply: string;
  state: "idle" | "failed" | "timeout";
}

/** What a session is doing now, as the Assistant reports it. */
export type AssistantSessionState = "running" | "awaiting-approval" | "idle";

export interface AssistantOverviewSession {
  id: string;
  projectId: string;
  projectName: string;
  title?: string;
  state: AssistantSessionState;
  updatedAt?: string;
  /** The Assistant dispatched it. */
  dispatched?: true;
}

export interface AssistantOverview {
  projects: { id: string; name: string; temporaryWorkspace?: true }[];
  /** Sessions running or waiting for approval, in every project. */
  active: AssistantOverviewSession[];
  /** Sessions the Assistant dispatched, most recent first. */
  dispatched: AssistantOverviewSession[];
  /** Approvals and questions waiting for the user, across Pine. */
  pendingApprovals: number;
}

export interface AssistantDigest {
  session: AssistantOverviewSession;
  messageCount: number;
  /** The start of its last reply. */
  lastReply?: string;
  /** The user's or dispatcher's last message to it. */
  lastRequest?: string;
}

/** What the Assistant's tools ask of the main process. */
export type AssistantHostOperation =
  | { op: "overview" }
  | {
      op: "dispatch";
      projectId: string;
      title?: string;
      message: string;
      approvalMode: PineApprovalMode;
      locale: "en-US" | "zh-CN";
    }
  | { op: "digest"; projectId: string; sessionId: string };

export type AssistantHostResult =
  | { op: "overview"; overview: AssistantOverview }
  | {
      op: "dispatch";
      sessionId: string;
      projectId: string;
      projectName: string;
      approvalMode: PineApprovalMode;
    }
  | { op: "digest"; digest: AssistantDigest };
