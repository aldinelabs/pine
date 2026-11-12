import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  UI_PROJECT_LIST_TOOL_NAME,
  UI_SESSION_DELETE_TOOL_NAME,
  UI_SESSION_NEW_TOOL_NAME,
  UI_SESSION_ORGANIZE_TOOL_NAME,
  UI_SESSION_SEARCH_TOOL_NAME,
  UI_SESSION_TREE_TOOL_NAME,
  approvalModeWithin,
  type PineApprovalMode,
} from "../shared/agent";
import type {
  AgentHostRequest,
  AgentHostResponse,
  AgentHostSession,
  AgentHostSessionTree,
  AgentHostTreeSession,
  GateDecision,
  SessionHostOperation,
  SessionHostResult,
  SessionTreeOperation,
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

export async function callSessionHost<Op extends SessionHostOperation["op"]>(
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

function describeTreeSession(session: AgentHostTreeSession): string {
  const notes = [
    `id: ${session.id}`,
    session.updatedAt ? `updated ${session.updatedAt}` : undefined,
    session.current ? "current session" : undefined,
  ].filter(Boolean);
  return `  - ${session.title ?? "(untitled)"} (${notes.join("; ")})`;
}

/** The tree as compact text: folders with their sessions, then the rest. */
export function describeSessionTree(tree: AgentHostSessionTree): string {
  const lines = [
    `Project ${tree.projectName} (id: ${tree.projectId}; revision: ${tree.revision})`,
  ];
  for (const folder of tree.folders) {
    lines.push(`Folder "${folder.name}" (id: ${folder.id})`);
    lines.push(
      ...(folder.sessions.length
        ? folder.sessions.map(describeTreeSession)
        : ["  (empty)"]),
    );
  }
  lines.push(tree.folders.length ? "Not in a folder:" : "Sessions:");
  lines.push(
    ...(tree.unfiled.length
      ? tree.unfiled.map(describeTreeSession)
      : ["  (none)"]),
  );
  if (tree.moreUnfiled)
    lines.push(`  …and ${tree.moreUnfiled} older; raise limit to see them.`);
  return lines.join("\n");
}

function denied(decision: GateDecision, what: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `The user did not ${what}.${decision.kind === "deny" && decision.reason ? ` ${decision.reason}` : ""}`,
      },
    ],
    details: { done: false },
  };
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
      const { sessions } = await callSessionHost(context, {
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
      const result = await callSessionHost(context, {
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

  const treeParams = Type.Object({
    projectId: Type.Optional(
      Type.String({
        description: "Project to show; this session's project when omitted.",
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_SEARCH_LIMIT,
        description: `Most sessions outside folders to list, default ${DEFAULT_SEARCH_LIMIT}.`,
      }),
    ),
  });
  const treeTool = defineTool({
    name: UI_SESSION_TREE_TOOL_NAME,
    label: "Show Session Folders",
    description: `Show a project's session folders as the sidebar has them, with the sessions in each and the most recent ones outside folders. Returns the revision ${UI_SESSION_ORGANIZE_TOOL_NAME} needs.`,
    parameters: treeParams,
    prepareArguments: (args) => args as Static<typeof treeParams>,
    execute: async (_toolCallId, params) => {
      const projectId = params.projectId?.trim();
      const { tree } = await callSessionHost(context, {
        op: "tree",
        ...(projectId ? { projectId } : {}),
        limit: Math.min(
          Math.max(Math.trunc(params.limit ?? DEFAULT_SEARCH_LIMIT), 1),
          MAX_SEARCH_LIMIT,
        ),
      });
      return {
        content: [{ type: "text" as const, text: describeSessionTree(tree) }],
        details: { tree },
      };
    },
  });

  const organizeParams = Type.Object({
    projectId: Type.String(),
    revision: Type.String({
      description: `From ${UI_SESSION_TREE_TOOL_NAME}; edits are refused if the tree changed since.`,
    }),
    operations: Type.Array(
      Type.Object({
        op: Type.Union([
          Type.Literal("create_folder"),
          Type.Literal("rename_folder"),
          Type.Literal("delete_folder"),
          Type.Literal("move"),
          Type.Literal("rename_session"),
        ]),
        folderId: Type.Optional(
          Type.String({
            description:
              'rename_folder, delete_folder, move. A folder created earlier in this call is "new:1", "new:2", …; for move, omit it to take the session out of its folder.',
          }),
        ),
        sessionId: Type.Optional(
          Type.String({ description: "move, rename_session." }),
        ),
        name: Type.Optional(
          Type.String({
            description: "create_folder, rename_folder, rename_session.",
          }),
        ),
      }),
      { minItems: 1, maxItems: 100, description: "Applied in order." },
    ),
  });
  const organizeTool = defineTool({
    name: UI_SESSION_ORGANIZE_TOOL_NAME,
    label: "Organize Sessions",
    description:
      "Edit one project's session folders and titles in one call: create, rename or delete folders (a deleted folder's sessions move back to the project), move sessions into or out of folders, and rename sessions. Sessions stay in their project.",
    promptSnippet: `Use ${UI_SESSION_TREE_TOOL_NAME} and then ${UI_SESSION_ORGANIZE_TOOL_NAME} when the user asks to tidy, file or rename their sessions`,
    parameters: organizeParams,
    prepareArguments: (args) => args as Static<typeof organizeParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const operations = params.operations.map(
        (edit, index): SessionTreeOperation => {
          const need = (value: string | undefined, field: string): string => {
            const trimmed = value?.trim();
            if (!trimmed)
              throw new Error(
                `Operation ${index + 1} (${edit.op}) needs ${field}.`,
              );
            return trimmed;
          };
          switch (edit.op) {
            case "create_folder":
              return { op: "create-folder", name: need(edit.name, "name") };
            case "rename_folder":
              return {
                op: "rename-folder",
                folderId: need(edit.folderId, "folderId"),
                name: need(edit.name, "name"),
              };
            case "delete_folder":
              return {
                op: "delete-folder",
                folderId: need(edit.folderId, "folderId"),
              };
            case "move":
              return {
                op: "move",
                sessionId: need(edit.sessionId, "sessionId"),
                folderId: edit.folderId?.trim() || null,
              };
            case "rename_session":
              return {
                op: "rename-session",
                sessionId: need(edit.sessionId, "sessionId"),
                name: need(edit.name, "name"),
              };
          }
        },
      );
      if (context.getApprovalMode() === "let-me-review") {
        const decision = await context.requestApproval({
          toolCallId,
          toolName: UI_SESSION_ORGANIZE_TOOL_NAME,
          subject: `Organize sessions (${operations.length} ${operations.length === 1 ? "change" : "changes"})`,
          description: "Edit session folders and titles",
          evidence: params.operations
            .map((edit) =>
              [edit.op, edit.folderId, edit.sessionId, edit.name]
                .filter(Boolean)
                .join(" "),
            )
            .join("\n"),
          signal,
        });
        if (decision.kind !== "allow")
          return denied(decision, "make these changes");
      }
      if (signal?.aborted) throw new Error("aborted");
      const { tree, createdFolderIds } = await callSessionHost(context, {
        op: "organize",
        projectId: params.projectId.trim(),
        revision: params.revision,
        operations,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Done.${createdFolderIds.length ? ` New folder ids: ${createdFolderIds.join(", ")}.` : ""}\n${describeSessionTree(tree)}`,
          },
        ],
        details: { done: true, tree, createdFolderIds },
      };
    },
  });

  const deleteParams = Type.Object({
    projectId: Type.String(),
    sessionId: Type.String(),
  });
  const deleteTool = defineTool({
    name: UI_SESSION_DELETE_TOOL_NAME,
    label: "Delete Session",
    description:
      "Permanently delete one of the user's sessions. Pine asks the user to confirm every deletion. The current session and sessions open in a tab cannot be deleted.",
    parameters: deleteParams,
    prepareArguments: (args) => args as Static<typeof deleteParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const projectId = params.projectId.trim();
      const sessionId = params.sessionId.trim();
      const { session, open } = await callSessionHost(context, {
        op: "describe",
        projectId,
        sessionId,
      });
      if (session.current) throw new Error("A session cannot delete itself.");
      if (open)
        throw new Error(
          "That session is open in Pine. Ask the user to close its tab first.",
        );
      // Deleting cannot be undone, so the user decides in every mode.
      const decision = await context.requestApproval({
        toolCallId,
        toolName: UI_SESSION_DELETE_TOOL_NAME,
        subject: `Delete session “${session.title ?? "Untitled"}” permanently`,
        description: "Delete a session",
        evidence: [
          `Project: ${session.projectName}`,
          `${session.messageCount} messages, last updated ${session.updatedAt}`,
          session.snippet?.replace(/\s+/g, " ").trim(),
        ]
          .filter(Boolean)
          .join("\n"),
        signal,
      });
      if (decision.kind !== "allow")
        return denied(decision, "delete the session");
      if (signal?.aborted) throw new Error("aborted");
      const { deleted } = await callSessionHost(context, {
        op: "delete",
        projectId,
        sessionId,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: deleted
              ? `Deleted session ${session.title ?? sessionId}.`
              : "The session was already gone.",
          },
        ],
        details: { done: deleted, projectId, title: session.title },
      };
    },
  });

  return [
    searchTool,
    newTool,
    treeTool,
    organizeTool,
    deleteTool,
  ] as ToolDefinition[];
}
