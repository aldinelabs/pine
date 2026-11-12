import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  InlineExtension,
  SessionEntry,
  SessionHeader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  DATETIME_TOOL_NAME,
  RECALL_TOOL_NAME,
  UI_LIST_MODELS_TOOL_NAME,
  UI_PROJECT_LIST_TOOL_NAME,
  UI_REPORT_PROGRESS_TOOL_NAME,
  UI_SESSION_SEARCH_TOOL_NAME,
  UI_SESSION_READ_TOOL_NAME,
  UI_SESSION_RELATIVES_TOOL_NAME,
  UI_SESSION_TREE_TOOL_NAME,
} from "../shared/agent";
import { MCP_CONFIG_LIST_TOOL_NAME } from "../shared/mcp";
import { PINE_SIDE_CHAT_ENTRY } from "../shared/sideChats";
import { UI_WORKBENCH_STATE_TOOL_NAME } from "../shared/workbench";
import {
  AUTOMATION_GET_TOOL_NAME,
  AUTOMATION_LIST_TOOL_NAME,
} from "./automation/tools";
import { LIST_VIDEO_MODELS_TOOL_NAME } from "./media/video-tools";
import {
  INVOKE_SKILL_TOOL_NAME,
  LIST_SKILL_RESOURCES_TOOL_NAME,
  READ_SKILL_RESOURCE_TOOL_NAME,
} from "./skills/tools";

/**
 * A side chat is a fork of a conversation where the user asks questions on
 * the side. It keeps the parent's system prompt, tool definitions and
 * messages unchanged, so the provider's prompt cache still covers them, and
 * only adds its own messages after them. Tools that could change anything
 * stay listed (removing them would change the cached prefix) but are refused
 * when called.
 */

export { PINE_SIDE_CHAT_ENTRY };
/** The hidden message that tells the model it is in a side chat. */
export const PINE_SIDE_CHAT_NOTICE = "pine.side-chat-notice" as const;

/** Tools that only read, and so may run in a side chat. */
export const SIDE_CHAT_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "web_fetch",
  DATETIME_TOOL_NAME,
  RECALL_TOOL_NAME,
  INVOKE_SKILL_TOOL_NAME,
  LIST_SKILL_RESOURCES_TOOL_NAME,
  READ_SKILL_RESOURCE_TOOL_NAME,
  UI_PROJECT_LIST_TOOL_NAME,
  UI_SESSION_SEARCH_TOOL_NAME,
  UI_SESSION_TREE_TOOL_NAME,
  UI_SESSION_RELATIVES_TOOL_NAME,
  UI_SESSION_READ_TOOL_NAME,
  UI_LIST_MODELS_TOOL_NAME,
  UI_WORKBENCH_STATE_TOOL_NAME,
  // Reads and writes nothing; its text shows in the transcript either way.
  UI_REPORT_PROGRESS_TOOL_NAME,
  LIST_VIDEO_MODELS_TOOL_NAME,
  AUTOMATION_LIST_TOOL_NAME,
  AUTOMATION_GET_TOOL_NAME,
  MCP_CONFIG_LIST_TOOL_NAME,
]);

export function isSideChatReadOnlyTool(toolName: string): boolean {
  return SIDE_CHAT_READ_ONLY_TOOL_NAMES.has(toolName);
}

export const SIDE_CHAT_BLOCKED_TOOL_REASON =
  "This is a read-only side chat. Tools that write files, run commands, change settings, or act outside the conversation are unavailable here. Answer with read-only tools (reading files, web search and fetch, listing) or from the conversation.";

export const SIDE_CHAT_APPROVAL_REASON =
  "This is a read-only side chat, which cannot ask the user for approval. Use read-only tools that need no approval, or answer from the conversation.";

/** The passage a follow-up asks about, and who wrote it. */
export interface SideChatPassage {
  quote: string;
  role?: "assistant" | "user";
}

export function sideChatNotice(passage?: SideChatPassage): string {
  const source =
    passage?.role === "user"
      ? "one of the user's own messages"
      : passage?.role === "assistant"
        ? "one of your replies"
        : "a message";
  return [
    "<system-reminder>",
    "The user opened a side chat on this conversation to ask questions about it. Everything after this point happens only in the side chat: the main conversation does not see it and continues separately.",
    ...(passage
      ? [
          `The user selected this passage from ${source} above and asks about it; their questions refer to it unless they say otherwise:`,
          "<quoted_passage>",
          passage.quote,
          "</quoted_passage>",
        ]
      : []),
    "In the side chat, call read-only tools only: reading files, web search and web fetch, and tools that list or inspect. Never write or edit files, run shell commands, change settings, or act outside the conversation; such calls fail. Do not continue the main task here. Answer the user's questions directly and concisely.",
    `Tools available here: ${[...SIDE_CHAT_READ_ONLY_TOOL_NAMES].join(", ")}.`,
    "</system-reminder>",
  ].join("\n");
}

/** The passage a side chat follows up, read from its own entry. */
export function sideChatPassage(
  entries: readonly SessionEntry[],
): SideChatPassage | undefined {
  const anchor = sideChatEntry(entries)?.data.anchor;
  if (typeof anchor !== "object" || anchor === null) return undefined;
  const { quote, messageId } = anchor as {
    quote?: unknown;
    messageId?: unknown;
  };
  if (typeof quote !== "string" || !quote) return undefined;
  const message = entries.find(
    (entry) => entry.type === "message" && entry.id === messageId,
  );
  const role =
    message?.type === "message" &&
    (message.message.role === "assistant" || message.message.role === "user")
      ? message.message.role
      : undefined;
  return { quote, ...(role ? { role } : {}) };
}

export interface SideChatEntryData {
  parentSessionId: string;
  /** Where in the parent the side chat asks about, when it follows up text. */
  anchor?: unknown;
}

/** The side chat's own data and where its entries start, if it is one. */
export function sideChatEntry(
  entries: readonly SessionEntry[],
): { id: string; data: SideChatEntryData } | undefined {
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== PINE_SIDE_CHAT_ENTRY)
      continue;
    const data = entry.data as Partial<SideChatEntryData> | undefined;
    if (typeof data?.parentSessionId !== "string") continue;
    return {
      id: entry.id,
      data: {
        parentSessionId: data.parentSessionId,
        ...(data.anchor !== undefined ? { anchor: data.anchor } : {}),
      },
    };
  }
  return undefined;
}

/** Whether an entry of the branch is the side chat's own, after the fork. */
export function isSideChatEntry(
  branch: readonly SessionEntry[],
  entryId: string,
): boolean {
  const marker = branch.findIndex(
    (entry) =>
      entry.type === "custom" && entry.customType === PINE_SIDE_CHAT_ENTRY,
  );
  return (
    marker >= 0 &&
    branch.slice(marker + 1).some((entry) => entry.id === entryId)
  );
}

/** The side chat's own messages: those after its marker entry. */
export function sideChatMessages(
  branch: readonly SessionEntry[],
): { id: string; message: unknown }[] {
  const marker = branch.findIndex(
    (entry) =>
      entry.type === "custom" && entry.customType === PINE_SIDE_CHAT_ENTRY,
  );
  if (marker < 0) return [];
  return branch
    .slice(marker + 1)
    .flatMap((entry) =>
      entry.type === "message"
        ? [{ id: entry.id, message: entry.message }]
        : [],
    );
}

/**
 * The entries a fork starts from: a new header and the parent's current
 * branch, with its ids and parent links as they are.
 */
export function forkEntries(
  parent: SessionManager,
  cwd: string,
): { header: SessionHeader; entries: SessionEntry[] } {
  const parentHeader = parent.getHeader();
  const header: SessionHeader = {
    type: "session",
    ...(parentHeader?.version !== undefined
      ? { version: parentHeader.version }
      : {}),
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd,
    ...(parent.getSessionFile()
      ? { parentSession: parent.getSessionFile() }
      : {}),
  };
  return { header, entries: parent.getBranch() };
}

/** Writes a fork to a new file in the directory and returns its path. */
export function writeForkFile(
  directory: string,
  fork: { header: SessionHeader; entries: SessionEntry[] },
): string {
  mkdirSync(directory, { recursive: true });
  const file = path.join(
    directory,
    `${fork.header.timestamp.replace(/[:.]/g, "-")}_${fork.header.id}.jsonl`,
  );
  writeFileSync(
    file,
    [fork.header, ...fork.entries]
      .map((entry) => `${JSON.stringify(entry)}\n`)
      .join(""),
    { flag: "wx" },
  );
  return file;
}

/**
 * Points an anchor at its message's entry. The renderer may still know a
 * message just streamed by its streamed id; that id stands for the message
 * object, which is the one its entry holds.
 */
export function resolveAnchorMessage(
  anchor: unknown,
  branch: readonly SessionEntry[],
  streamedMessage: (messageId: string) => unknown,
): unknown {
  if (typeof anchor !== "object" || anchor === null) return anchor;
  const messageId = (anchor as { messageId?: unknown }).messageId;
  if (typeof messageId !== "string") return anchor;
  if (branch.some((entry) => entry.id === messageId)) return anchor;
  const message = streamedMessage(messageId);
  const entry =
    message === undefined
      ? undefined
      : branch.find(
          (candidate) =>
            candidate.type === "message" && candidate.message === message,
        );
  if (!entry) throw new Error("The quoted message is not in the conversation.");
  return { ...anchor, messageId: entry.id };
}

/** Refuses tools that are not read-only and tells the model where it is. */
export function createSideChatExtension(options: {
  hasNotice: () => boolean;
  passage: () => SideChatPassage | undefined;
}): InlineExtension {
  return {
    name: "pine-side-chat",
    factory: (pi) => {
      pi.on("tool_call", (event) =>
        isSideChatReadOnlyTool(event.toolName)
          ? undefined
          : { block: true, reason: SIDE_CHAT_BLOCKED_TOOL_REASON },
      );
      pi.on("before_agent_start", () =>
        options.hasNotice()
          ? undefined
          : {
              message: {
                customType: PINE_SIDE_CHAT_NOTICE,
                content: sideChatNotice(options.passage()),
                display: false,
              },
            },
      );
    },
  };
}
