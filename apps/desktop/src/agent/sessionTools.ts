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
  UI_SESSION_READ_TOOL_NAME,
  UI_SESSION_RELATIVES_TOOL_NAME,
  UI_SESSION_RENAME_TOOL_NAME,
  UI_SESSION_SEARCH_TOOL_NAME,
  UI_SESSION_SEND_TOOL_NAME,
  UI_SESSION_TREE_TOOL_NAME,
  approvalModeWithin,
  type PineApprovalMode,
} from "../shared/agent";
import type {
  AgentHostRequest,
  AgentHostResponse,
  AgentHostRelative,
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
  /**
   * Renames the asking session itself. A title the user chose stays; the
   * worker reports that instead of replacing it.
   */
  renameCurrentSession(title: string): RenameCurrentSessionResult;
  /** Set when this session is a sub-session of another. */
  getParentSessionId(): string | undefined;
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

export type RenameCurrentSessionResult =
  | { renamed: true; title: string }
  | { renamed: false; reason: "user-title" | "unchanged" | "invalid" };

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
    title: Type.Optional(
      Type.String({
        description:
          "A short sidebar title naming its task, in the user's language (a few words). Without one, it shows the first message until Pine titles it.",
      }),
    ),
    message: Type.String({
      description:
        "The new session's first message. It starts with no memory of this conversation, so include everything it needs.",
    }),
    relation: Type.Optional(
      Type.Union([Type.Literal("child"), Type.Literal("sibling")], {
        description:
          "child: a sub-session of this one, shown under it, that reports back each turn it finishes; the default for a top-level session. sibling: a separate session beside this one; for a sub-session, another sub-session of the same parent, and the only choice.",
      }),
    ),
    projectId: Type.Optional(
      Type.String({
        description: `For a top-level sibling, the project to run in (id from ${UI_PROJECT_LIST_TOOL_NAME}); sub-sessions always run in this session's project.`,
      }),
    ),
    approvalMode: Type.Optional(approvalModeSchema),
  });
  const newTool = defineTool({
    name: UI_SESSION_NEW_TOOL_NAME,
    label: "Start Session",
    description:
      "Start a Pine session that works on its own in the background, beginning with the given message: by default a sub-session of this one, which works like a subagent. This call returns its id without waiting for it.",
    promptSnippet: `Use ${UI_SESSION_NEW_TOOL_NAME} to hand a self-contained part of the work to a sub-session, or to start a separate session the user asks for`,
    promptGuidelines: [
      `A sub-session suits a self-contained part of a larger task, or work that can run in parallel; several can run at once. Do small steps here instead. Start a separate top-level session only when the user asks for one.`,
      `After starting sub-sessions, Pine delivers a notice each time one finishes a turn or waits for approval; continue with other work or end your turn, and do not poll or sleep to wait. Use ${UI_SESSION_READ_TOOL_NAME} for more of a sub-session's messages and ${UI_SESSION_SEND_TOOL_NAME} to give it follow-up work.`,
      "A sub-session starts with no memory of this conversation, so its first message must include everything it needs and say what to report back.",
      "Give each session a short title naming its task, so the user can tell sub-sessions apart in the sidebar.",
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
      const isSubSession = context.getParentSessionId() !== undefined;
      const relation = params.relation ?? (isSubSession ? "sibling" : "child");
      if (relation === "child" && isSubSession)
        throw new Error(
          "This session is a sub-session, and sub-sessions go one level deep. Start a sibling instead.",
        );
      const projectId = params.projectId?.trim();
      const title = params.title?.trim().slice(0, 80);
      if (callerMode === "let-me-review") {
        const decision = await context.requestApproval({
          toolCallId,
          toolName: UI_SESSION_NEW_TOOL_NAME,
          subject: `New ${approvalMode} ${relation === "child" || isSubSession ? "sub-session" : "session"}${projectId ? ` in project ${projectId}` : ""}`,
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
        relation,
        ...(title ? { title } : {}),
        message,
        approvalMode,
        locale: context.getLocale(),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: result.parentSessionId
              ? `Started sub-session ${result.sessionId} (${result.approvalMode}). Pine tells ${isSubSession ? "the parent session" : "you"} when it finishes a turn or waits for approval; do not poll it.`
              : `Started session ${result.sessionId} in ${result.projectName} (${result.approvalMode}). It runs on its own; find it later with ${UI_SESSION_SEARCH_TOOL_NAME}.`,
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
    description: `Edit one project's session folders and titles in one call: create, rename or delete folders (a deleted folder's sessions move back to the project), move sessions into or out of folders, and rename sessions the user asks about. Sessions stay in their project. Retitle this session with ${UI_SESSION_RENAME_TOOL_NAME} instead.`,
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

  const renameParams = Type.Object({
    title: Type.String({
      description:
        "What this session is working on now, in the user's language: a short, specific phrase of at most 60 characters.",
    }),
  });
  const renameTool = defineTool({
    name: UI_SESSION_RENAME_TOOL_NAME,
    label: "Retitle Session",
    description:
      "Set this session's title in the sidebar and tab to what it is working on now. A title the user chose themselves is kept.",
    promptSnippet: `Use ${UI_SESSION_RENAME_TOOL_NAME} to keep this session's title in step with the task it is working on`,
    promptGuidelines: [
      `When the user's message starts a new task or moves to a different area, call ${UI_SESSION_RENAME_TOOL_NAME} once you understand what the new work is, if the current title no longer describes it. Name the work, not the request's wording.`,
      `Do not retitle for follow-ups, corrections or steps within the same task, and at most once per new task. Pine titles a new session after its first exchange, so do not call ${UI_SESSION_RENAME_TOOL_NAME} in the first turn.`,
      `Call it alongside other work without mentioning it in the reply. If it reports that the user chose the title, leave the title alone for the rest of the session.`,
    ],
    parameters: renameParams,
    prepareArguments: (args) => args as Static<typeof renameParams>,
    execute: (_toolCallId, params) => {
      const result = context.renameCurrentSession(params.title);
      const text = result.renamed
        ? `Title set to "${result.title}".`
        : result.reason === "user-title"
          ? "The user chose this session's title; it stays. Do not retitle this session again."
          : result.reason === "unchanged"
            ? "The title already says that."
            : "The title is empty.";
      return Promise.resolve({
        content: [{ type: "text" as const, text }],
        details: result,
      });
    },
  });

  const describeRelative = (session: AgentHostRelative, role: string) =>
    `- ${role}: ${session.title ?? "(untitled)"} (id: ${session.id}; ${session.state}${session.updatedAt ? `; updated ${session.updatedAt}` : ""})`;
  const relativesTool = defineTool({
    name: UI_SESSION_RELATIVES_TOOL_NAME,
    label: "List Related Sessions",
    description:
      "List this session's parent, its sub-sessions and its siblings (the parent's other sub-sessions), with what each is doing now.",
    parameters: Type.Object({}),
    execute: async () => {
      const result = await callSessionHost(context, { op: "relatives" });
      const lines = [
        ...(result.parent ? [describeRelative(result.parent, "parent")] : []),
        ...result.children.map((child) =>
          describeRelative(child, "sub-session"),
        ),
        ...result.siblings.map((sibling) =>
          describeRelative(sibling, "sibling"),
        ),
      ];
      return {
        content: [
          {
            type: "text" as const,
            text: lines.length
              ? lines.join("\n")
              : "This session has no parent, sub-sessions or siblings.",
          },
        ],
        details: result,
      };
    },
  });

  const readParams = Type.Object({
    sessionId: Type.String({
      description: `A parent, sub-session or sibling, from ${UI_SESSION_RELATIVES_TOOL_NAME}.`,
    }),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 50,
        description: "Most recent messages to read, default 10.",
      }),
    ),
    before: Type.Optional(
      Type.String({
        description: "Cursor from an earlier read, for older messages.",
      }),
    ),
  });
  const readTool = defineTool({
    name: UI_SESSION_READ_TOOL_NAME,
    label: "Read Session",
    description:
      "Read the latest messages of this session's parent, a sub-session or a sibling, as text with tool calls named in brackets.",
    parameters: readParams,
    prepareArguments: (args) => args as Static<typeof readParams>,
    execute: async (_toolCallId, params) => {
      const before = params.before?.trim();
      const result = await callSessionHost(context, {
        op: "read",
        sessionId: params.sessionId.trim(),
        limit: Math.min(Math.max(Math.trunc(params.limit ?? 10), 1), 50),
        ...(before ? { before } : {}),
      });
      const body = result.messages
        .map(
          (message) =>
            `[${message.role} · ${message.createdAt}]\n${message.text}`,
        )
        .join("\n\n");
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Session ${result.title ?? "(untitled)"} (id: ${result.sessionId})`,
              body || "(no messages)",
              ...(result.olderCursor
                ? [
                    `Older messages: read again with before "${result.olderCursor}".`,
                  ]
                : []),
            ].join("\n\n"),
          },
        ],
        details: { sessionId: result.sessionId, title: result.title },
      };
    },
  });

  const sendParams = Type.Object({
    sessionId: Type.String({
      description: `A parent, sub-session or sibling, from ${UI_SESSION_RELATIVES_TOOL_NAME}.`,
    }),
    message: Type.String({
      description:
        "What to tell it. A running session reads it at its next step; an idle one starts a new turn.",
    }),
  });
  const sendTool = defineTool({
    name: UI_SESSION_SEND_TOOL_NAME,
    label: "Message Session",
    description:
      "Send a message to this session's parent, a sub-session or a sibling, for example follow-up work for a sub-session. It is marked as coming from this session.",
    parameters: sendParams,
    prepareArguments: (args) => args as Static<typeof sendParams>,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const message = params.message.trim();
      if (!message) throw new Error("The message is empty.");
      const sessionId = params.sessionId.trim();
      const result = await callSessionHost(context, {
        op: "send",
        sessionId,
        message,
        locale: context.getLocale(),
      });
      return {
        content: [
          {
            type: "text" as const,
            text:
              result.delivered === "steer"
                ? `Delivered to ${sessionId}; it reads the message at its next step.`
                : `Sent to ${sessionId}, which started a new turn.`,
          },
        ],
        details: { sessionId, delivered: result.delivered },
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
      "Permanently delete one of the user's sessions. Pine asks the user to confirm every deletion. The current session cannot be deleted; a session open in a tab is stopped and its tab closes.",
    parameters: deleteParams,
    prepareArguments: (args) => args as Static<typeof deleteParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const projectId = params.projectId.trim();
      const sessionId = params.sessionId.trim();
      const { session, subSessionCount } = await callSessionHost(context, {
        op: "describe",
        projectId,
        sessionId,
      });
      if (session.current) throw new Error("A session cannot delete itself.");
      // Deleting cannot be undone, so the user decides in every mode.
      const decision = await context.requestApproval({
        toolCallId,
        toolName: UI_SESSION_DELETE_TOOL_NAME,
        subject: `Delete session “${session.title ?? "Untitled"}” permanently`,
        description: "Delete a session",
        evidence: [
          `Project: ${session.projectName}`,
          `${session.messageCount} messages, last updated ${session.updatedAt}`,
          subSessionCount
            ? `Its ${subSessionCount} ${subSessionCount === 1 ? "sub-session is" : "sub-sessions are"} deleted too.`
            : undefined,
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
    renameTool,
    deleteTool,
    relativesTool,
    readTool,
    sendTool,
  ] as ToolDefinition[];
}
