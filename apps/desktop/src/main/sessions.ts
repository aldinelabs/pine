import type {
  SessionEntry as Entry,
  SessionInfo,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sanitizeFilename from "sanitize-filename";
import type {
  LoadSessionMessagesResult,
  PineSessionModel,
  PineSessionSummary,
  PineTextMessage,
  PineToolCallApproval,
  PineApprovalDecision,
  SessionSearchResult,
} from "../shared/sessions";
import {
  PINE_APPROVAL_DECISION_ENTRY,
  PINE_APPROVAL_MODE_ENTRY,
} from "../shared/sessions";
import {
  isSandboxDeniedPayload,
  type PineApprovalMode,
  type PineJsonValue,
} from "../shared/agent";
import { formatSessionAsMarkdown } from "../shared/sessionExport";
import {
  attachmentMessagePreview,
  type PineAttachment,
} from "../shared/attachments";
import { parseMessageBlocks } from "../shared/sessions";
import { replayTodoState } from "@pine/rpiv-todo";

const SEARCH_RESULT_LIMIT = 50;
const SEARCH_INDEX_FILE = "session-search.sqlite";
const SNIPPET_START = "\u0001";
const SNIPPET_END = "\u0002";
const SEARCH_INDEX_SCHEMA_VERSION = 2;

export interface PineSessionExportDocument {
  fileName: string;
  markdown: string;
}

export interface PineSessionDescriptor {
  sessionFile: string;
  summary: PineSessionSummary;
}

export interface ProjectSessionServiceOptions {
  cacheRoot: string;
  cwd: string;
  sessionsRoot: string;
}

interface SessionMetadata {
  createdAt: number;
  id: string;
  path: string;
}

// The main bundle is CJS; coding-agent only exposes an ESM import entry.
async function loadSessionManager(): Promise<typeof SessionManager> {
  return (await import("@earendil-works/pi-coding-agent")).SessionManager;
}

/**
 * SessionManager skips malformed lines. A damaged file must fail instead, so
 * it is neither indexed from partial history nor appended to by a rename.
 */
async function assertWellFormed(sessionFile: string): Promise<void> {
  const text = await readFile(sessionFile, "utf8");
  for (const line of text.split("\n")) {
    if (line.trim()) JSON.parse(line);
  }
}

function metadataOf(info: SessionInfo): SessionMetadata {
  return { id: info.id, path: info.path, createdAt: info.created.getTime() };
}

function entryTimestamp(entry: Entry): number {
  return Date.parse(entry.timestamp);
}

interface SessionDocument extends PineSessionSummary {
  body: string;
  hasUserMessage: boolean;
  path: string;
  sourceMtimeMs: number;
}

interface SessionSearchRow {
  created_at: string;
  message_count: number;
  preview: string | null;
  session_id: string;
  snippet: string | null;
  title: string | null;
  updated_at: string;
}

interface IndexedSessionRow {
  message_count: number;
  session_id: string;
  source_mtime_ms: number;
}

interface IndexedTextMessage {
  cursor: number;
  message: PineTextMessage;
}

function isApprovalDecision(value: unknown): value is PineApprovalDecision {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const decision = value as Partial<PineApprovalDecision>;
  return (
    typeof decision.requestId === "string" &&
    typeof decision.toolCallId === "string" &&
    (decision.verdict === "approved" || decision.verdict === "denied") &&
    (decision.decidedBy === "user" ||
      decision.decidedBy === "judge" ||
      decision.decidedBy === "sandbox") &&
    (decision.reason === undefined || typeof decision.reason === "string")
  );
}

function approvalDecisionsFromEntries(
  entries: readonly Entry[],
): Map<string, PineToolCallApproval> {
  const decisions = new Map<string, PineToolCallApproval>();
  for (const entry of entries) {
    if (
      entry.type !== "custom" ||
      entry.customType !== PINE_APPROVAL_DECISION_ENTRY ||
      !isApprovalDecision(entry.data)
    ) {
      continue;
    }
    decisions.set(entry.data.toolCallId, {
      state: entry.data.verdict,
      decidedBy: entry.data.decidedBy,
      ...(entry.data.reason ? { reason: entry.data.reason } : {}),
    });
  }
  return decisions;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      if ("text" in part && typeof part.text === "string") return [part.text];
      return [];
    })
    .join("\n");
}

function thinkingDurationMs(
  entry: Extract<Entry, { type: "message" }>,
): number | undefined {
  const startedAt = entry.message.timestamp;
  const endedAt = entryTimestamp(entry);
  if (typeof startedAt !== "number" || Number.isNaN(endedAt)) return undefined;
  return Math.max(0, endedAt - startedAt);
}

function textFromMessage(entry: Extract<Entry, { type: "message" }>): string {
  const message = entry.message;

  if ("content" in message) return textFromContent(message.content);
  if ("summary" in message && typeof message.summary === "string") {
    return message.summary;
  }
  if ("command" in message && typeof message.command === "string") {
    return `${message.command}\n${"output" in message && typeof message.output === "string" ? message.output : ""}`;
  }

  return "";
}

function indexedTextMessages(entries: Entry[]): IndexedTextMessage[] {
  const messages: IndexedTextMessage[] = [];
  const toolOwners = new Map<string, PineTextMessage>();
  const approvalDecisions = approvalDecisionsFromEntries(entries);

  for (const [index, entry] of entries.entries()) {
    // Entries are append-only, so file position is a stable cursor.
    const cursor = index + 1;
    if (entry.type === "compaction") {
      messages.push({
        cursor,
        message: {
          createdAt: new Date(entryTimestamp(entry)).toISOString(),
          id: `compaction-${entry.id}`,
          role: "assistant",
          blocks: [
            {
              type: "compaction",
              compaction: {
                id: entry.id,
                status: "complete",
              },
            },
          ],
        },
      });
      continue;
    }
    if (entry.type !== "message") continue;
    const entryMessage = entry.message;
    if (
      entryMessage.role === "toolResult" &&
      "toolCallId" in entryMessage &&
      typeof entryMessage.toolCallId === "string" &&
      "isError" in entryMessage &&
      typeof entryMessage.isError === "boolean" &&
      "content" in entryMessage
    ) {
      const owner = toolOwners.get(entryMessage.toolCallId);
      if (!owner) continue;
      const sandboxDenied =
        entryMessage.isError &&
        isSandboxDeniedPayload(
          entryMessage.content as unknown as PineJsonValue,
        );
      const approval =
        approvalDecisions.get(entryMessage.toolCallId) ??
        (sandboxDenied
          ? { state: "denied" as const, decidedBy: "sandbox" as const }
          : undefined);
      owner.blocks = owner.blocks.map((block) => {
        if (
          block.type !== "toolCall" ||
          block.toolCall.id !== entryMessage.toolCallId
        ) {
          return block;
        }
        return {
          ...block,
          toolCall: {
            ...block.toolCall,
            status: entryMessage.isError
              ? ("error" as const)
              : ("complete" as const),
            // Keep the structured details envelope used by live tool events.
            // Questionnaire markers read `details.answers`, and other tools
            // use details for metadata such as fetched page titles.
            output:
              "details" in entryMessage && entryMessage.details !== undefined
                ? {
                    content: entryMessage.content,
                    details: entryMessage.details,
                  }
                : entryMessage.content,
            ...(approval ? { approval } : {}),
          },
        };
      });
      continue;
    }
    if (entry.message.role !== "user" && entry.message.role !== "assistant") {
      continue;
    }

    const blocks = parseMessageBlocks(entry.message);
    const blocksWithApproval = blocks.map((block) => {
      if (block.type !== "toolCall") return block;
      const approval = approvalDecisions.get(block.toolCall.id);
      return approval
        ? { ...block, toolCall: { ...block.toolCall, approval } }
        : block;
    });
    const hasThinking = blocksWithApproval.some(
      (block) => block.type === "thinking",
    );
    if (blocksWithApproval.length === 0) continue;
    const messageTimestamp = entry.message.timestamp;
    const message: PineTextMessage = {
      createdAt:
        typeof messageTimestamp === "number"
          ? new Date(messageTimestamp).toISOString()
          : new Date(entryTimestamp(entry)).toISOString(),
      id: entry.id,
      role: entry.message.role,
      blocks: blocksWithApproval,
      ...(hasThinking ? { thinkingDurationMs: thinkingDurationMs(entry) } : {}),
    };
    messages.push({ cursor, message });
    for (const block of blocksWithApproval) {
      if (block.type === "toolCall") toolOwners.set(block.toolCall.id, message);
    }
  }

  for (const { message } of messages) {
    message.blocks = message.blocks.map((block) =>
      block.type === "toolCall" && block.toolCall.status === "pending"
        ? {
            ...block,
            toolCall: { ...block.toolCall, status: "error" as const },
          }
        : block,
    );
  }

  return messages;
}

function textMessages(entries: Entry[]): PineTextMessage[] {
  return indexedTextMessages(entries).map(({ message }) => message);
}

function outlineMessages(
  messages: readonly IndexedTextMessage[],
): PineTextMessage[] {
  return messages
    .filter(({ message }) => message.role === "user")
    .map(({ message }) => ({
      ...message,
      blocks: message.blocks.filter((block) => block.type === "text"),
    }));
}

function messageCursor(sequence: number): string {
  return `seq:${sequence}`;
}

function messageCursorIndex(
  messages: IndexedTextMessage[],
  cursor: string,
): number {
  if (cursor.startsWith("seq:")) {
    const sequence = Number(cursor.slice(4));
    if (!Number.isSafeInteger(sequence) || sequence < 1) return -1;
    return messages.findIndex((message) => message.cursor === sequence);
  }

  // Accept entry-ID cursors returned by Pine before sequence cursors were
  // introduced. These remain stable for native v4 sessions.
  return messages.findIndex((message) => message.message.id === cursor);
}

function isPineApprovalMode(value: unknown): value is PineApprovalMode {
  return (
    value === "let-me-review" ||
    value === "auto-approve" ||
    value === "autonomous" ||
    value === "YOLO"
  );
}

function approvalModeFromEntries(
  entries: Entry[],
  fallback: PineApprovalMode,
): PineApprovalMode {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry.type !== "custom" ||
      entry.customType !== PINE_APPROVAL_MODE_ENTRY
    )
      continue;
    const data = entry.data;
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      const mode = (data as { approvalMode?: unknown }).approvalMode;
      if (isPineApprovalMode(mode)) return mode;
    }
  }
  return fallback;
}

function modelsFromEntries(entries: Entry[]): PineSessionModel[] {
  const models = new Map<string, PineSessionModel>();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant")
      continue;
    const assistant = entry.message as {
      model?: unknown;
      provider?: unknown;
    };
    if (
      typeof assistant.provider !== "string" ||
      typeof assistant.model !== "string"
    )
      continue;
    const model = {
      providerId: assistant.provider,
      modelId: assistant.model,
    };
    models.set(`${model.providerId}/${model.modelId}`, model);
  }
  return [...models.values()];
}

function sessionDisplayName(
  summary: PineSessionSummary,
  extension: string,
): string {
  const fallback = `conversation-${summary.id}`;
  const candidate = (summary.name || summary.preview || fallback)
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100);
  const base = sanitizeFilename(candidate, { replacement: "-" });
  return `${base && !/^[.\s-]+$/u.test(base) ? base : fallback}.${extension}`;
}

function exportFileName(summary: PineSessionSummary): string {
  return sessionDisplayName(summary, "md");
}

function firstUserMessage(entries: Entry[]): string | undefined {
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const text = attachmentMessagePreview(textFromMessage(entry)).trim();
    if (text) return text;
  }

  return undefined;
}

function hasUserMessage(entries: Entry[]): boolean {
  return entries.some(
    (entry) => entry.type === "message" && entry.message.role === "user",
  );
}

function sessionBody(entries: Entry[]): string {
  return entries
    .flatMap((entry) => {
      if (
        entry.type === "message" &&
        (entry.message.role === "user" || entry.message.role === "assistant")
      ) {
        const text = textFromMessage(entry);
        return [
          entry.message.role === "user" ? attachmentMessagePreview(text) : text,
        ];
      }
      if (entry.type === "compaction" || entry.type === "branch_summary") {
        return [entry.summary];
      }
      return [];
    })
    .filter(Boolean)
    .join("\n");
}

function sessionUpdatedAt(
  entries: Entry[],
  createdAt: number,
  sourceMtimeMs: number,
): string {
  let latestTimestamp = createdAt;
  if (Number.isNaN(latestTimestamp)) latestTimestamp = sourceMtimeMs;

  for (const entry of entries) {
    if (
      entry.type !== "message" ||
      (entry.message.role !== "user" && entry.message.role !== "assistant")
    ) {
      continue;
    }

    const messageTimestamp = entry.message.timestamp;
    const timestamp =
      typeof messageTimestamp === "number"
        ? messageTimestamp
        : entryTimestamp(entry);
    if (!Number.isNaN(timestamp)) {
      latestTimestamp = Math.max(latestTimestamp, timestamp);
    }
  }

  return new Date(latestTimestamp).toISOString();
}

function rowToSearchResult(row: SessionSearchRow): SessionSearchResult {
  return {
    id: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    ...(row.title ? { name: row.title } : {}),
    ...(row.preview ? { preview: row.preview } : {}),
    ...(row.snippet ? { snippet: row.snippet } : {}),
  };
}

function quoteFtsQuery(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

export class ProjectSessionService {
  private readonly database: DatabaseSync;

  private constructor(
    private readonly sessionsRoot: string,
    databasePath: string,
  ) {
    this.database = new DatabaseSync(databasePath, { timeout: 5_000 });
    const schemaVersion = this.database.prepare("PRAGMA user_version").get() as
      { user_version: number } | undefined;
    if (schemaVersion?.user_version !== SEARCH_INDEX_SCHEMA_VERSION) {
      this.database.exec("DROP TABLE IF EXISTS session_search");
    }
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
        session_id UNINDEXED,
        path UNINDEXED,
        created_at UNINDEXED,
        updated_at UNINDEXED,
        title,
        body,
        preview UNINDEXED,
        message_count UNINDEXED,
        source_mtime_ms UNINDEXED,
        tokenize = 'trigram'
      );
      PRAGMA user_version = ${SEARCH_INDEX_SCHEMA_VERSION};
    `);
  }

  static async create(
    options: ProjectSessionServiceOptions,
  ): Promise<ProjectSessionService> {
    const cacheDirectory = options.cacheRoot;
    await mkdir(cacheDirectory, { recursive: true });
    await mkdir(options.sessionsRoot, { recursive: true });

    return new ProjectSessionService(
      options.sessionsRoot,
      path.join(cacheDirectory, SEARCH_INDEX_FILE),
    );
  }

  // Each project keeps its sessions in its own subdirectory of the root, and
  // history stays visible across projects and default-folder changes.
  private async listSessions(): Promise<SessionMetadata[]> {
    const manager = await loadSessionManager();
    const directories = (
      await readdir(this.sessionsRoot, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.sessionsRoot, entry.name));
    const sessions = await Promise.all(
      directories.map((directory) => manager.listAll(directory)),
    );
    return sessions.flat().map(metadataOf);
  }

  private async findSession(
    sessionId: string,
  ): Promise<SessionMetadata | undefined> {
    return (await this.listSessions()).find(
      (session) => session.id === sessionId,
    );
  }

  async describeSession(sessionId: string): Promise<PineSessionDescriptor> {
    const metadata = await this.findSession(sessionId);
    if (!metadata) throw new Error("Session not found in the active project.");

    return {
      sessionFile: metadata.path,
      summary: await this.readSessionDocument(metadata),
    };
  }

  async attachmentForSession(sessionId: string): Promise<PineAttachment> {
    const descriptor = await this.describeSession(sessionId);
    const metadata = await stat(descriptor.sessionFile);
    if (!metadata.isFile()) throw new Error("Session document is not a file.");
    const extension =
      path.extname(descriptor.sessionFile).slice(1).toLowerCase() || "jsonl";
    return {
      extension,
      kind: "file",
      modifiedAt: metadata.mtime.toISOString(),
      name: sessionDisplayName(descriptor.summary, extension),
      path: descriptor.sessionFile,
      size: metadata.size,
    };
  }

  async loadMessages(
    sessionId: string,
    before?: string,
    limit = 50,
    includeOutline = false,
  ): Promise<LoadSessionMessagesResult> {
    const metadata = await this.findSession(sessionId);
    if (!metadata) throw new Error("Session not found in the active project.");

    return this.withSession(metadata, (session) => {
      // Edited history leaves abandoned entries in the file; only the active
      // branch (ending at the last appended entry) is the transcript.
      const entries = session.getBranch();
      const messages = indexedTextMessages(entries);
      const end = before
        ? messageCursorIndex(messages, before)
        : messages.length;
      if (end < 0) throw new Error("Session message cursor not found.");

      const start = Math.max(0, end - limit);
      const page = messages.slice(start, end);
      return {
        hasMore: start > 0,
        messages: page.map(({ message }) => message),
        ...(start > 0 && page[0]
          ? { nextBefore: messageCursor(page[0].cursor) }
          : {}),
        ...(includeOutline
          ? {
              outline: outlineMessages(messages),
              todos: replayTodoState(entries),
            }
          : {}),
      };
    });
  }

  /** Only a successful first-party presentation can restore a preview grant. */
  async presentedFilePath(
    sessionId: string,
    toolCallId: string,
  ): Promise<string | null> {
    const metadata = await this.findSession(sessionId);
    if (!metadata) return null;

    return this.withSession(metadata, (session) => {
      for (const { message } of indexedTextMessages(session.getEntries())) {
        for (const block of message.blocks) {
          if (block.type !== "toolCall") continue;
          const call = block.toolCall;
          if (
            call.id !== toolCallId ||
            call.name !== "ui_present_file" ||
            call.status !== "complete"
          )
            continue;
          const details =
            typeof call.output === "object" && call.output !== null
              ? (call.output as { details?: { path?: unknown } }).details
              : undefined;
          return typeof details?.path === "string" ? details.path : null;
        }
      }
      return null;
    });
  }

  async exportSession(
    sessionId: string,
    fallbackApprovalMode: PineApprovalMode,
  ): Promise<PineSessionExportDocument> {
    const metadata = await this.findSession(sessionId);
    if (!metadata) throw new Error("Session not found in the active project.");

    return this.withSession(metadata, async (session) => {
      const entries = session.getBranch();
      const summary = await this.readSessionDocument(
        metadata,
        undefined,
        session,
      );
      return {
        fileName: exportFileName(summary),
        markdown: formatSessionAsMarkdown({
          approvalMode: approvalModeFromEntries(entries, fallbackApprovalMode),
          messages: textMessages(entries),
          models: modelsFromEntries(entries),
          summary,
        }),
      };
    });
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const metadata = await this.findSession(sessionId);
    if (!metadata) return false;

    await unlink(metadata.path);
    this.database
      .prepare("DELETE FROM session_search WHERE session_id = ?")
      .run(sessionId);
    return true;
  }

  async renameSession(
    sessionId: string,
    name: string,
  ): Promise<PineSessionSummary> {
    const metadata = await this.findSession(sessionId);
    if (!metadata) throw new Error("Session not found in the active project.");

    // SessionManager tolerates malformed lines. Validate the full document
    // before allowing a rename to append to a genuinely damaged source.
    await this.readSessionDocument(metadata);
    (await loadSessionManager()).open(metadata.path).appendSessionInfo(name);
    const summary = await this.readSessionDocument(metadata);
    await this.refreshIndex();
    return summary;
  }

  async search(query: string): Promise<SessionSearchResult[]> {
    await this.refreshIndex();
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      const rows = this.database
        .prepare(
          `SELECT session_id, created_at, updated_at, title, preview,
                  message_count, NULL AS snippet
             FROM session_search
            ORDER BY updated_at DESC
            LIMIT ?`,
        )
        .all(SEARCH_RESULT_LIMIT) as unknown as SessionSearchRow[];
      return rows.map(rowToSearchResult);
    }

    const characterCount = Array.from(normalizedQuery).length;
    const rows =
      characterCount < 3
        ? (this.database
            .prepare(
              `SELECT session_id, created_at, updated_at, title, preview,
                      message_count,
                      CASE WHEN body LIKE '%' || ? || '%'
                        THEN substr(
                          body,
                          max(1, instr(lower(body), lower(?)) - 60),
                          180
                        )
                        ELSE preview END AS snippet
                 FROM session_search
                WHERE title LIKE '%' || ? || '%'
                   OR body LIKE '%' || ? || '%'
                ORDER BY updated_at DESC
                LIMIT ?`,
            )
            .all(
              normalizedQuery,
              normalizedQuery,
              normalizedQuery,
              normalizedQuery,
              SEARCH_RESULT_LIMIT,
            ) as unknown as SessionSearchRow[])
        : (this.database
            .prepare(
              `SELECT session_id, created_at, updated_at, title, preview,
                      message_count,
                      snippet(session_search, 5, ?, ?, ' … ', 24) AS snippet
                 FROM session_search
                WHERE session_search MATCH ?
                ORDER BY bm25(session_search, 0, 0, 0, 0, 8, 1), updated_at DESC
                LIMIT ?`,
            )
            .all(
              SNIPPET_START,
              SNIPPET_END,
              quoteFtsQuery(normalizedQuery),
              SEARCH_RESULT_LIMIT,
            ) as unknown as SessionSearchRow[]);

    return rows.map(rowToSearchResult);
  }

  dispose(): Promise<void> {
    this.database.close();
    return Promise.resolve();
  }

  private async refreshIndex(): Promise<void> {
    const metadataList = await this.listSessions();
    const indexedRows = this.database
      .prepare(
        "SELECT session_id, source_mtime_ms, message_count FROM session_search",
      )
      .all() as unknown as IndexedSessionRow[];
    const indexedSessions = new Map(
      indexedRows.map((row) => [row.session_id, row]),
    );
    const retainedSessionIds = new Set<string>();
    const changedDocuments: SessionDocument[] = [];

    for (const metadata of metadataList) {
      try {
        const sourceMtimeMs = (await stat(metadata.path)).mtimeMs;
        const indexedSession = indexedSessions.get(metadata.id);
        if (indexedSession?.source_mtime_ms === sourceMtimeMs) {
          if (Number(indexedSession.message_count) > 0) {
            retainedSessionIds.add(metadata.id);
          } else {
            await unlink(metadata.path);
          }
          continue;
        }

        const document = await this.readSessionDocument(
          metadata,
          sourceMtimeMs,
        );
        if (!document.hasUserMessage) {
          await unlink(metadata.path);
          continue;
        }

        retainedSessionIds.add(metadata.id);
        changedDocuments.push(document);
      } catch (error) {
        // Preserve any last good index row, leave the source untouched, and
        // retry next refresh. One broken file must not hide healthy sessions.
        if (indexedSessions.has(metadata.id)) {
          retainedSessionIds.add(metadata.id);
        }
        console.warn(`Failed to index session ${metadata.path}`, error);
      }
    }

    const deleteStatement = this.database.prepare(
      "DELETE FROM session_search WHERE session_id = ?",
    );
    const insertStatement = this.database.prepare(
      `INSERT INTO session_search(
        session_id, path, created_at, updated_at, title, body, preview,
        message_count, source_mtime_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const indexedSessionId of indexedSessions.keys()) {
        if (!retainedSessionIds.has(indexedSessionId)) {
          deleteStatement.run(indexedSessionId);
        }
      }
      for (const document of changedDocuments) {
        deleteStatement.run(document.id);
        insertStatement.run(
          document.id,
          document.path,
          document.createdAt,
          document.updatedAt,
          document.name ?? null,
          document.body,
          document.preview ?? null,
          document.messageCount,
          document.sourceMtimeMs,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private async readSessionDocument(
    metadata: SessionMetadata,
    sourceMtimeMs?: number,
    openedSession?: SessionManager,
  ): Promise<SessionDocument> {
    if (!openedSession) {
      return this.withSession(metadata, (session) =>
        this.readSessionDocument(metadata, sourceMtimeMs, session),
      );
    }

    const entries = openedSession.getBranch();
    const preview = firstUserMessage(entries);
    const name = openedSession.getSessionName()?.trim();
    const resolvedSourceMtimeMs =
      sourceMtimeMs ?? (await stat(metadata.path)).mtimeMs;

    return {
      id: metadata.id,
      path: metadata.path,
      createdAt: new Date(metadata.createdAt).toISOString(),
      updatedAt: sessionUpdatedAt(
        entries,
        metadata.createdAt,
        resolvedSourceMtimeMs,
      ),
      messageCount: entries.filter((entry) => entry.type === "message").length,
      hasUserMessage: hasUserMessage(entries),
      sourceMtimeMs: resolvedSourceMtimeMs,
      body: sessionBody(entries),
      ...(name ? { name } : {}),
      ...(preview ? { preview } : {}),
    };
  }

  private async withSession<T>(
    metadata: SessionMetadata,
    callback: (session: SessionManager) => Promise<T> | T,
  ): Promise<T> {
    await assertWellFormed(metadata.path);
    const manager = (await loadSessionManager()).open(metadata.path);
    return callback(manager);
  }
}
