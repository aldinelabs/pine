import { parseQuoteMessage } from "./quotes";

export const PICK_ATTACHMENTS_CHANNEL = "attachments:pick" as const;
export const PICK_ATTACHMENT_FOLDERS_CHANNEL =
  "attachment-folders:pick" as const;
export const INSPECT_ATTACHMENTS_CHANNEL = "attachments:inspect" as const;
export const OPEN_ATTACHMENT_CHANNEL = "attachments:open" as const;
export const SAVE_PASTED_ATTACHMENT_CHANNEL =
  "attachments:save-pasted" as const;

/** Extensions rendered with the image variant of the attachment component. */
export const IMAGE_EXTENSIONS = ["avif", "gif", "jpeg", "jpg", "png", "webp"];

/** MIME types accepted for images pasted without a filesystem path. */
export const PASTED_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PastedImageMimeType = (typeof PASTED_IMAGE_MIME_TYPES)[number];

const MIME_TO_EXTENSION: Record<PastedImageMimeType, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Upper bound for a single pasted image, in bytes. */
export const MAX_PASTED_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * Plain-text pastes at or above this UTF-8 size become attachments. Measuring
 * bytes keeps the rule useful for both single-byte source code and CJK text.
 */
export const PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES = 12 * 1024;

/** Upper bound for a single pasted text attachment, in UTF-8 bytes. */
export const MAX_PASTED_TEXT_BYTES = 5 * 1024 * 1024;

export interface SavePastedImageAttachmentRequest {
  bytes: Uint8Array;
  /** Project whose Pine-managed storage keeps the pasted file. */
  projectId: string;
  mimeType: PastedImageMimeType;
  /** Original clipboard file name, used as the display name when present. */
  name?: string;
}

export interface SavePastedTextAttachmentRequest {
  mimeType: "text/plain";
  projectId: string;
  name?: string;
  text: string;
}

export type SavePastedAttachmentRequest =
  SavePastedImageAttachmentRequest | SavePastedTextAttachmentRequest;

export interface AttachmentImageUrlRequest {
  path: string;
}

/** Custom protocol that serves local attachment images to the renderer. */
export const ATTACHMENT_IMAGE_PROTOCOL = "pine-attachment";

export function extensionForPastedImage(mimeType: PastedImageMimeType): string {
  return MIME_TO_EXTENSION[mimeType];
}

export function isPastedImageMimeType(
  value: string,
): value is PastedImageMimeType {
  return (PASTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function pastedTextByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function shouldAttachPastedText(text: string): boolean {
  return (
    text.trim().length > 0 &&
    pastedTextByteLength(text) >= PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES
  );
}

export function isImageAttachment(attachment: {
  extension: string;
  kind?: PineAttachmentKind;
}): boolean {
  return (
    attachment.kind !== "directory" &&
    IMAGE_EXTENSIONS.includes(attachment.extension.toLowerCase())
  );
}

/**
 * URL that loads a local attachment image through the scoped
 * `pine-attachment://` protocol. The absolute path travels in the query
 * string; the main process validates it before serving anything.
 */
export function attachmentImageUrl(path: string): string {
  return `${ATTACHMENT_IMAGE_PROTOCOL}://local/?p=${encodeURIComponent(path)}`;
}

export type PineAttachmentKind = "directory" | "file" | "session";

/**
 * A conversation attached by reference: the agent reads it with its session
 * tools instead of a file, and reads it without review because the user
 * attached it.
 */
export interface AttachedSession {
  projectId: string;
  sessionId: string;
  /** The session's project, for the model and the chip. */
  projectName?: string;
}

export interface AttachmentSelection {
  /** Inclusive, 1-based source line numbers. */
  startLine: number;
  endLine: number;
  /** Human-readable location for selections that are not source lines. */
  label?: string;
  text: string;
}

/** The app an attachment was taken from, for the model to read. */
export interface AttachmentSource {
  app: string;
  bundleId?: string;
  windowTitle?: string;
  /** The page a browser shows. */
  url?: string;
  /** The file a document app shows. */
  documentPath?: string;
}

export interface PineAttachment {
  extension: string;
  /** Missing on attachment blocks created before folder support. */
  kind?: PineAttachmentKind;
  modifiedAt: string;
  name: string;
  path: string;
  size: number;
  selection?: AttachmentSelection;
  source?: AttachmentSource;
  /** Set exactly when `kind` is "session". */
  session?: AttachedSession;
}

const SESSION_ATTACHMENT_SCHEME = "pine-session://";

/** The stand-in path that keys a session attachment; never a file. */
export function sessionAttachmentPath(session: AttachedSession): string {
  return `${SESSION_ATTACHMENT_SCHEME}${session.projectId}/${session.sessionId}`;
}

/** A conversation as an attachment; `name` is its title. */
export function sessionAttachment(input: {
  projectId: string;
  sessionId: string;
  projectName?: string;
  title: string;
  updatedAt: string;
}): PineAttachment {
  const session: AttachedSession = {
    projectId: input.projectId,
    sessionId: input.sessionId,
    ...(input.projectName ? { projectName: input.projectName } : {}),
  };
  return {
    extension: "",
    kind: "session",
    modifiedAt: input.updatedAt,
    name: input.title,
    path: sessionAttachmentPath(session),
    size: 0,
    session,
  };
}

export function isSessionAttachment(
  attachment: Pick<PineAttachment, "kind">,
): boolean {
  return attachment.kind === "session";
}

/** The file and folder paths of attachments: what may grant read access. */
export function attachmentFilePaths(
  attachments: readonly PineAttachment[],
): string[] {
  return attachments
    .filter((attachment) => !isSessionAttachment(attachment))
    .map((attachment) => attachment.path);
}

/** The sessions a user message attached. */
export function attachedSessionsOf(message: string): AttachedSession[] {
  return parseAttachmentMessage(message).attachments.flatMap((attachment) =>
    attachment.session ? [attachment.session] : [],
  );
}

export interface PickAttachmentsResult {
  attachments: PineAttachment[];
}

export interface InspectAttachmentsRequest {
  paths: string[];
}

export interface SavePastedAttachmentResult {
  attachment: PineAttachment;
}

export interface OpenAttachmentRequest {
  path: string;
}

export interface OpenAttachmentResult {
  error?: string;
  opened: boolean;
}

export interface ParsedAttachmentMessage {
  attachments: PineAttachment[];
  prompt: string;
}

const ATTACHMENT_BLOCK_START = '<pine_attachments version="1">';
const ATTACHMENT_BLOCK_END = "</pine_attachments>";

function isAttachment(value: unknown): value is PineAttachment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.extension === "string" &&
    (attachment.kind === undefined ||
      attachment.kind === "directory" ||
      attachment.kind === "file" ||
      attachment.kind === "session") &&
    (attachment.kind === "session"
      ? isAttachedSession(attachment.session) &&
        attachment.path === sessionAttachmentPath(attachment.session) &&
        attachment.selection === undefined
      : attachment.session === undefined) &&
    typeof attachment.modifiedAt === "string" &&
    typeof attachment.name === "string" &&
    typeof attachment.path === "string" &&
    typeof attachment.size === "number" &&
    Number.isFinite(attachment.size) &&
    attachment.size >= 0 &&
    (attachment.selection === undefined ||
      (attachment.kind !== "directory" &&
        isAttachmentSelection(attachment.selection))) &&
    (attachment.source === undefined || isAttachmentSource(attachment.source))
  );
}

function isAttachedSession(value: unknown): value is AttachedSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  const id = (field: unknown) =>
    typeof field === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(field);
  return (
    id(session.projectId) &&
    id(session.sessionId) &&
    (session.projectName === undefined ||
      typeof session.projectName === "string")
  );
}

function isAttachmentSource(value: unknown): value is AttachmentSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  const optional = (field: unknown) =>
    field === undefined || typeof field === "string";
  return (
    typeof source.app === "string" &&
    source.app.length > 0 &&
    optional(source.bundleId) &&
    optional(source.windowTitle) &&
    optional(source.url) &&
    optional(source.documentPath)
  );
}

function isAttachmentSelection(value: unknown): value is AttachmentSelection {
  if (typeof value !== "object" || value === null) return false;
  const selection = value as Record<string, unknown>;
  return (
    typeof selection.startLine === "number" &&
    Number.isSafeInteger(selection.startLine) &&
    selection.startLine >= 1 &&
    typeof selection.endLine === "number" &&
    Number.isSafeInteger(selection.endLine) &&
    selection.endLine >= selection.startLine &&
    (selection.label === undefined ||
      (typeof selection.label === "string" && selection.label.length > 0)) &&
    typeof selection.text === "string" &&
    selection.text.length > 0
  );
}

export function serializeAttachmentMessage(
  attachments: readonly PineAttachment[],
  prompt: string,
): string {
  const normalizedPrompt = prompt.trim();
  if (attachments.length === 0) return normalizedPrompt;

  const block = [
    ATTACHMENT_BLOCK_START,
    JSON.stringify({ attachments }),
    ATTACHMENT_BLOCK_END,
  ].join("\n");
  return normalizedPrompt ? `${block}\n\n${normalizedPrompt}` : block;
}

export function parseAttachmentMessage(
  message: string,
): ParsedAttachmentMessage {
  if (!message.startsWith(`${ATTACHMENT_BLOCK_START}\n`)) {
    return { attachments: [], prompt: message };
  }

  const blockEnd = message.indexOf(`\n${ATTACHMENT_BLOCK_END}`);
  if (blockEnd < 0) return { attachments: [], prompt: message };

  try {
    const payload = JSON.parse(
      message.slice(ATTACHMENT_BLOCK_START.length + 1, blockEnd),
    ) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      return { attachments: [], prompt: message };
    }
    const attachments = (payload as Record<string, unknown>).attachments;
    if (!Array.isArray(attachments) || !attachments.every(isAttachment)) {
      return { attachments: [], prompt: message };
    }

    const promptStart = blockEnd + ATTACHMENT_BLOCK_END.length + 1;
    const prompt = message.slice(promptStart).replace(/^\r?\n\r?\n/, "");
    return { attachments, prompt };
  } catch {
    return { attachments: [], prompt: message };
  }
}

export function attachmentMessagePreview(message: string): string {
  const { attachments, prompt } = parseAttachmentMessage(message);
  const quoted = parseQuoteMessage(prompt);
  return (
    quoted.prompt.trim() ||
    attachments.map((attachment) => attachment.name).join(", ") ||
    quoted.quotes.map((quote) => quote.text).join(" ")
  );
}
