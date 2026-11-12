import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  UI_PROJECT_LIST_TOOL_NAME,
  UI_SESSION_NEW_TOOL_NAME,
  UI_SESSION_SEARCH_TOOL_NAME,
  approvalModeWithin,
  type PineApprovalMode,
} from "../shared/agent";
import type {
  AgentHostRequest,
  AgentHostResponse,
  AgentHostSession,
  GateDecision,
  SessionHostOperation,
  SessionHostResult,
} from "./protocol";
import { sessionSearchQuery } from "../shared/sessions";

export interface PineSessionToolContext {
  /** Ask main, which owns session storage and the project library. */
  requestHost(request: AgentHostRequest): Promise<AgentHostResponse>;
  getApprovalMode(): PineApprovalMode;
  getLocale(): "en-US" | "zh-CN";
  /** Let Me Review: the user approves starting a session. */
  requestApproval(input: {
    toolCallId: string;
    toolName: string;
    subject: string;
    description: string;
    evidence: string;
    signal?: AbortSignal;
  }): Promise<GateDecision>;
}

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

async function callHost<Op extends SessionHostOperation["op"]>(
  context: PineSessionToolContext,
  operation: Extract<SessionHostOperation, { op: Op }>,
): Promise<Extract<SessionHostResult, { op: Op }>> {
  const response = await context.requestHost({ kind: "session", operation });
  if (response.kind !== "session" || response.result.op !== operation.op)
    throw new Error("Pine returned an unexpected session result.");
  return response.result as Extract<SessionHostResult, { op: Op }>;
}

function describeSession(session: AgentHostSession): string {
  const flags = [
    session.current ? "current session" : undefined,
    session.automationRun ? "automation run" : undefined,
  ].filter(Boolean);
  const header = `- ${session.title ?? "(untitled)"} (id: ${session.id}; project: ${session.projectName}, ${session.projectId}; updated ${session.updatedAt}; ${session.messageCount} messages${flags.length ? `; ${flags.join(", ")}` : ""})`;
  const snippet = session.snippet?.replace(/\s+/g, " ").trim();
  return snippet ? `${header}\n  ${snippet}` : header;
}

const approvalModeSchema = Type.Union(
  [
    Type.Literal("let-me-review"),
    Type.Literal("auto-approve"),
    Type.Literal("autonomous"),
    Type.Literal("YOLO"),
  ],
  {
    description:
      "Approval mode of the new session; defaults to this session's. It cannot be less supervised than this session's mode (let-me-review < auto-approve < autonomous < YOLO).",
  },
);

/**
 * Pine managing its own sessions: finding past conversations and starting
 * new ones. A new session never runs with less supervision than the one
 * that starts it; main checks that again before creating it.
 */
export function createSessionToolDefinitions(
  context: PineSessionToolContext,
): ToolDefinition[] {
  const searchParams = Type.Object({
    query: Type.String({
      description:
        'Words to find in session titles and messages. "*" lists the most recently updated sessions.',
    }),
    projectId: Type.Optional(
      Type.String({
        description: `Only this project's sessions (id from ${UI_PROJECT_LIST_TOOL_NAME}); all projects when omitted.`,
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_SEARCH_LIMIT,
        description: `Most results to return, default ${DEFAULT_SEARCH_LIMIT}.`,
      }),
    ),
  });
  const searchTool = defineTool({
    name: UI_SESSION_SEARCH_TOOL_NAME,
    label: "Search Sessions",
    description:
      'Search the user\'s Pine sessions across projects by title and message text, newest first, with a matching snippet. Use "*" to list recent sessions.',
    promptSnippet: `Use ${UI_SESSION_SEARCH_TOOL_NAME} when the user refers to an earlier conversation or asks what they worked on`,
    parameters: searchParams,
    prepareArguments: (args) => args as Static<typeof searchParams>,
    execute: async (_toolCallId, params) => {
      const projectId = params.projectId?.trim();
      const { sessions } = await callHost(context, {
        op: "search",
        query: sessionSearchQuery(params.query),
        ...(projectId ? { projectId } : {}),
        limit: Math.min(
          Math.max(Math.trunc(params.limit ?? DEFAULT_SEARCH_LIMIT), 1),
          MAX_SEARCH_LIMIT,
        ),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: sessions.length
              ? sessions.map(describeSession).join("\n")
              : "No sessions match.",
          },
        ],
        details: { sessions },
      };
    },
  });

  const newParams = Type.Object({
    message: Type.String({
      description:
        "The new session's first message. It starts with no memory of this conversation, so include everything it needs.",
    }),
    projectId: Type.Optional(
      Type.String({
        description: `Project to run in (id from ${UI_PROJECT_LIST_TOOL_NAME}); this session's project when omitted.`,
      }),
    ),
    approvalMode: Type.Optional(approvalModeSchema),
  });
  const newTool = defineTool({
    name: UI_SESSION_NEW_TOOL_NAME,
    label: "Start Session",
    description:
      "Start a separate Pine session that works on its own in the background, beginning with the given message. It appears in the user's session list; this call returns its id without waiting for it.",
    promptSnippet: `Use ${UI_SESSION_NEW_TOOL_NAME} when the user asks to run a task in its own, separate session`,
    promptGuidelines: [
      `Start a session only when the user asks for separate or parallel work; do not use ${UI_SESSION_NEW_TOOL_NAME} to split up a task you can do here.`,
    ],
    parameters: newParams,
    prepareArguments: (args) => args as Static<typeof newParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const message = params.message.trim();
      if (!message) throw new Error("The first message is empty.");
      const callerMode = context.getApprovalMode();
      const approvalMode = params.approvalMode ?? callerMode;
      if (!approvalModeWithin(approvalMode, callerMode))
        throw new Error(
          `This session is in ${callerMode}; a session it starts cannot use ${approvalMode}. Use ${callerMode} or a more supervised mode.`,
        );
      const projectId = params.projectId?.trim();
      if (callerMode === "let-me-review") {
        const decision = await context.requestApproval({
          toolCallId,
          toolName: UI_SESSION_NEW_TOOL_NAME,
          subject: `New ${approvalMode} session${projectId ? ` in project ${projectId}` : ""}`,
          description: "Start a new session",
          evidence: message,
          signal,
        });
        if (decision.kind !== "allow")
          return {
            content: [
              {
                type: "text" as const,
                text: `The user did not start the session.${decision.reason ? ` ${decision.reason}` : ""}`,
              },
            ],
            details: { started: false },
          };
      }
      if (signal?.aborted) throw new Error("aborted");
      const result = await callHost(context, {
        op: "start",
        ...(projectId ? { projectId } : {}),
        message,
        approvalMode,
        locale: context.getLocale(),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Started session ${result.sessionId} in ${result.projectName} (${result.approvalMode}). It runs on its own; find it later with ${UI_SESSION_SEARCH_TOOL_NAME}.`,
          },
        ],
        details: { started: true, ...result },
      };
    },
  });

  return [searchTool, newTool] as ToolDefinition[];
}
