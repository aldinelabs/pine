import { readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { parseQuoteMessage } from "../shared/quotes";
import { parseAttachmentMessage } from "../shared/attachments";
import { contentBlocksToText, parseMessageBlocks } from "../shared/sessions";
import {
  PINE_SIDE_CHAT_ENTRY,
  isSideChatAnchor,
  type PineSideChatSummary,
} from "../shared/sideChats";

/**
 * Saved side chats sit in the project's data, one folder per conversation,
 * apart from its session history so they never appear in session lists.
 */
export function sideChatsDirectory(
  projectRoot: string,
  parentSessionId: string,
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parentSessionId))
    throw new Error("Invalid session id.");
  return path.join(projectRoot, "side-chats", parentSessionId);
}

interface SideChatFile {
  path: string;
  summary: PineSideChatSummary;
  /** Whether anything was asked in it. */
  hasQuestion: boolean;
}

const TITLE_LENGTH = 120;

/**
 * The entries of the branch the side chat is on, in order. Edits leave the
 * earlier questions in the file on a branch of their own; the last entry
 * written is on the current one.
 */
function activeBranch(
  entries: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of entries)
    if (typeof entry.id === "string" && entry.type !== "session")
      byId.set(entry.id, entry);
  const branch: Record<string, unknown>[] = [];
  let entry = [...byId.values()].at(-1);
  while (entry && branch.length <= byId.size) {
    branch.push(entry);
    entry =
      typeof entry.parentId === "string" ? byId.get(entry.parentId) : undefined;
  }
  return branch.reverse();
}

async function readSideChatFile(
  file: string,
  parentSessionId: string,
): Promise<SideChatFile | undefined> {
  const [text, metadata] = await Promise.all([
    readFile(file, "utf8"),
    stat(file),
  ]);
  let id: string | undefined;
  const entries: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type === "session" && typeof entry.id === "string")
        id = entry.id;
      else entries.push(entry);
    } catch {
      continue;
    }
  }
  let anchor: unknown;
  let started = false;
  let title: string | undefined;
  let hasQuestion = false;
  for (const entry of activeBranch(entries)) {
    if (entry.type === "custom" && entry.customType === PINE_SIDE_CHAT_ENTRY) {
      const data = entry.data as Record<string, unknown> | undefined;
      if (data?.parentSessionId !== parentSessionId) return undefined;
      anchor = data.anchor;
      started = true;
    } else if (
      started &&
      entry.type === "message" &&
      (entry.message as { role?: unknown } | undefined)?.role === "user"
    ) {
      hasQuestion = true;
      if (title === undefined) {
        const prompt = contentBlocksToText(parseMessageBlocks(entry.message));
        const question = parseQuoteMessage(
          parseAttachmentMessage(prompt).prompt,
        )
          .prompt.replace(/\s+/g, " ")
          .trim();
        if (question) title = question.slice(0, TITLE_LENGTH);
      }
    }
  }
  if (!id || !isSideChatAnchor(anchor)) return undefined;
  return {
    path: file,
    hasQuestion,
    summary: {
      id,
      parentSessionId,
      anchor,
      ...(title ? { title } : {}),
      updatedAt: metadata.mtime.toISOString(),
    },
  };
}

async function readSideChatFiles(
  directory: string,
  parentSessionId: string,
): Promise<SideChatFile[]> {
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) =>
      name.endsWith(".jsonl"),
    );
  } catch {
    return [];
  }
  const files = await Promise.all(
    names.map((name) =>
      readSideChatFile(path.join(directory, name), parentSessionId).catch(
        () => undefined,
      ),
    ),
  );
  return files.filter((file) => file !== undefined);
}

export async function listSideChats(
  directory: string,
  parentSessionId: string,
): Promise<PineSideChatSummary[]> {
  return (await readSideChatFiles(directory, parentSessionId))
    .map((file) => file.summary)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

export async function findSideChat(
  directory: string,
  parentSessionId: string,
  sideChatId: string,
): Promise<SideChatFile | undefined> {
  return (await readSideChatFiles(directory, parentSessionId)).find(
    (file) => file.summary.id === sideChatId,
  );
}

export async function deleteSideChat(
  directory: string,
  parentSessionId: string,
  sideChatId: string,
): Promise<boolean> {
  const file = await findSideChat(directory, parentSessionId, sideChatId);
  if (!file) return false;
  await unlink(file.path);
  return true;
}

/** A follow-up closed before anything was asked leaves nothing behind. */
export async function discardUnusedSideChat(
  directory: string,
  parentSessionId: string,
  sideChatId: string,
): Promise<boolean> {
  const file = await findSideChat(directory, parentSessionId, sideChatId);
  if (!file || file.hasQuestion) return false;
  await unlink(file.path);
  return true;
}

export async function deleteSideChatsOf(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
