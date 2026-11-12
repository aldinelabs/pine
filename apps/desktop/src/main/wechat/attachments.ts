// Media received from WeChat. The serial worker downloads a file when it
// reaches the message and stages it here (`<dataDirectory>/wechat-inbox`,
// 0700, files 0600). The next prompt moves the staged files into the
// project's attachments root. File names are display data only: every path
// on disk is generated here.
import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  constants as fsConstants,
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { IlinkMediaTooLargeError } from "@pine/wechat-ilink";
import type { PineAttachment } from "../../shared/attachments";
import {
  FILE_MAX_BYTES,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  PENDING_ATTACHMENTS_MAX,
  PENDING_ATTACHMENT_TTL_MS,
} from "./constants";
import type { InboundAttachmentsApi } from "./ports";
import type { PendingAttachment, StoredMedia, WeChatStateStore } from "./types";

export interface InboundAttachmentsOptions {
  store: WeChatStateStore;
  /** Staging directory, `<dataDirectory>/wechat-inbox`. */
  directory: string;
  now: () => number;
}

/** The file is over `FILE_MAX_BYTES`. Maps to `E-SIZE`. */
export class AttachmentTooLargeError extends Error {
  readonly maxBytes: number;
  /** Known when the message declared it. */
  readonly sizeBytes?: number;
  /** The sanitised display name of the file. */
  readonly displayName: string;
  readonly name = "AttachmentTooLargeError";

  constructor(fileName: string, maxBytes: number, sizeBytes?: number) {
    super(`${fileName} is larger than ${maxBytes} bytes.`);
    this.maxBytes = maxBytes;
    if (sizeBytes !== undefined) this.sizeBytes = sizeBytes;
    this.displayName = fileName;
  }
}

/** `PENDING_ATTACHMENTS_MAX` files are already waiting. */
export class AttachmentLimitError extends Error {
  readonly name = "AttachmentLimitError";
  readonly max = PENDING_ATTACHMENTS_MAX;

  constructor() {
    super(`At most ${PENDING_ATTACHMENTS_MAX} attachments can wait at once.`);
  }
}

/** The download took longer than `MEDIA_DOWNLOAD_TIMEOUT_MS`. */
export class AttachmentTimeoutError extends Error {
  readonly name = "AttachmentTimeoutError";

  constructor() {
    super("The download took too long.");
  }
}

const DISPLAY_NAME_MAX = 200;
const EXTENSION_MAX = 30;
/** What `stage` writes: a UUID and an optional sanitised extension. */
const STAGED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-zA-Z0-9.]*)?$/;
/** C0 and C1 controls, DEL, and the bidi embedding and isolate characters. */
const CONTROL_CHARACTERS = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]",
  "g",
);

/** Last path segment, without control or bidi characters, at most 200 characters. */
export function sanitiseDisplayName(name: string | undefined): string {
  if (!name) return "";
  const base = name.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const clean = base.replace(CONTROL_CHARACTERS, "").trim();
  if (clean === "." || clean === "..") return "";
  return Array.from(clean).slice(0, DISPLAY_NAME_MAX).join("");
}

/** `.ext` from a display name, safe to use in a generated file name. */
function safeExtension(name: string): string {
  return path
    .extname(name)
    .slice(0, EXTENSION_MAX)
    .replace(/[^a-zA-Z0-9.]/g, "");
}

/** Extension of an image going by its first bytes. */
function imageExtension(data: Buffer): string {
  if (
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return ".png";
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return ".jpg";
  if (data.subarray(0, 4).toString("latin1") === "GIF8") return ".gif";
  if (
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return ".webp";
  }
  return "";
}

function defaultName(kind: StoredMedia["kind"], data: Buffer): string {
  if (kind === "image") return `image${imageExtension(data) || ".jpg"}`;
  if (kind === "video") return "video.mp4";
  return "file";
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function unlinkQuietly(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch {
    // Already gone, or not ours to worry about.
  }
}

/** Moves a file; copies and unlinks when the two paths are on different devices. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "EXDEV") throw error;
    await copyFile(from, to, fsConstants.COPYFILE_EXCL);
    await unlink(from);
  }
}

/** Media received from WeChat, staged until a prompt uses it. */
export class InboundAttachments implements InboundAttachmentsApi {
  private readonly directory: string;

  constructor(protected readonly options: InboundAttachmentsOptions) {
    this.directory = path.resolve(options.directory);
  }

  async stage(
    media: StoredMedia,
    download: (
      ref: string,
      maxBytes: number,
      signal?: AbortSignal,
    ) => Promise<Buffer>,
  ): Promise<PendingAttachment> {
    const declaredName = sanitiseDisplayName(media.fileName);
    if (this.list().length >= PENDING_ATTACHMENTS_MAX) {
      throw new AttachmentLimitError();
    }
    if (media.sizeBytes !== undefined && media.sizeBytes > FILE_MAX_BYTES) {
      throw new AttachmentTooLargeError(
        declaredName || defaultName(media.kind, Buffer.alloc(0)),
        FILE_MAX_BYTES,
        media.sizeBytes,
      );
    }

    const data = await this.download(media, declaredName, download);
    const name = declaredName || defaultName(media.kind, data);
    const extension =
      safeExtension(name) ||
      (media.kind === "image" ? imageExtension(data) : "");

    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const stagedPath = path.join(this.directory, `${randomUUID()}${extension}`);
    await writeFile(stagedPath, data, { flag: "wx", mode: 0o600 });

    const attachment: PendingAttachment = {
      id: randomUUID(),
      name,
      sizeBytes: data.byteLength,
      kind: media.kind,
      stagedPath,
      receivedAtMs: this.options.now(),
    };
    try {
      await this.options.store.update((draft) => {
        draft.pendingAttachments.push(attachment);
      });
    } catch (error) {
      await unlinkQuietly(stagedPath);
      throw error;
    }
    return attachment;
  }

  list(): readonly PendingAttachment[] {
    return this.options.store.get().pendingAttachments;
  }

  async take(attachmentsRoot: string): Promise<PineAttachment[]> {
    const pending = [...this.list()];
    if (pending.length === 0) return [];
    const root = path.resolve(attachmentsRoot);
    await mkdir(root, { recursive: true });

    const moved: { from: string; to: string }[] = [];
    const attachments: PineAttachment[] = [];
    try {
      for (const entry of pending) {
        // The list lives in a plain state file: never move a path this
        // class did not create.
        if (!this.isStagedPath(entry.stagedPath)) continue;
        const extension = safeExtension(entry.stagedPath);
        const target = path.join(root, `${randomUUID()}${extension}`);
        try {
          await moveFile(entry.stagedPath, target);
        } catch (error) {
          if (isMissing(error)) continue;
          throw error;
        }
        moved.push({ from: entry.stagedPath, to: target });
        const metadata = await stat(target);
        attachments.push({
          name: sanitiseDisplayName(entry.name) || path.basename(target),
          path: target,
          extension: extension.slice(1).toLowerCase(),
          kind: "file",
          size: metadata.size,
          modifiedAt: metadata.mtime.toISOString(),
        });
      }
    } catch (error) {
      // Put back what was moved so a retry finds the files where the list says.
      for (const file of moved.reverse()) {
        await moveFile(file.to, file.from).catch(() => unlinkQuietly(file.to));
      }
      throw error;
    }

    const taken = new Set(pending.map((entry) => entry.id));
    await this.options.store.update((draft) => {
      draft.pendingAttachments = draft.pendingAttachments.filter(
        (entry) => !taken.has(entry.id),
      );
    });
    return attachments;
  }

  async drop(): Promise<number> {
    const pending = [...this.list()];
    if (pending.length === 0) return 0;
    for (const entry of pending) {
      if (this.isStagedPath(entry.stagedPath)) {
        await unlinkQuietly(entry.stagedPath);
      }
    }
    const dropped = new Set(pending.map((entry) => entry.id));
    await this.options.store.update((draft) => {
      draft.pendingAttachments = draft.pendingAttachments.filter(
        (entry) => !dropped.has(entry.id),
      );
    });
    return pending.length;
  }

  /** Removes entries older than `PENDING_ATTACHMENT_TTL_MS`, and staged files no entry refers to. */
  async sweep(nowMs: number): Promise<void> {
    const pending = this.list();
    const expired = pending.filter(
      (entry) =>
        !this.isStagedPath(entry.stagedPath) ||
        nowMs - entry.receivedAtMs >= PENDING_ATTACHMENT_TTL_MS,
    );
    for (const entry of expired) {
      if (this.isStagedPath(entry.stagedPath)) {
        await unlinkQuietly(entry.stagedPath);
      }
    }
    if (expired.length > 0) {
      const removed = new Set(expired.map((entry) => entry.id));
      await this.options.store.update((draft) => {
        draft.pendingAttachments = draft.pendingAttachments.filter(
          (entry) => !removed.has(entry.id),
        );
      });
    }
    await this.sweepOrphans(nowMs);
  }

  /** Files left behind by a crash between writing and recording them. */
  private async sweepOrphans(nowMs: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return;
    }
    const known = new Set(
      this.list().map((entry) => path.resolve(entry.stagedPath)),
    );
    for (const name of names) {
      if (!STAGED_NAME.test(name)) continue;
      const file = path.join(this.directory, name);
      if (known.has(file)) continue;
      try {
        const metadata = await stat(file);
        if (
          metadata.isFile() &&
          nowMs - metadata.mtimeMs >= PENDING_ATTACHMENT_TTL_MS
        ) {
          await unlinkQuietly(file);
        }
      } catch {
        // Gone meanwhile.
      }
    }
  }

  /** A path directly in the staging directory with a name `stage` generates. */
  private isStagedPath(file: string): boolean {
    if (typeof file !== "string" || !path.isAbsolute(file)) return false;
    const resolved = path.resolve(file);
    return (
      path.dirname(resolved) === this.directory &&
      STAGED_NAME.test(path.basename(resolved))
    );
  }

  private async download(
    media: StoredMedia,
    displayName: string,
    download: (
      ref: string,
      maxBytes: number,
      signal?: AbortSignal,
    ) => Promise<Buffer>,
  ): Promise<Buffer> {
    const tooLarge = () =>
      new AttachmentTooLargeError(
        displayName || defaultName(media.kind, Buffer.alloc(0)),
        FILE_MAX_BYTES,
        media.sizeBytes,
      );
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AttachmentTimeoutError());
      }, MEDIA_DOWNLOAD_TIMEOUT_MS);
    });
    let data: Buffer;
    try {
      data = await Promise.race([
        download(media.ref, FILE_MAX_BYTES, controller.signal),
        timedOut,
      ]);
    } catch (error) {
      if (error instanceof IlinkMediaTooLargeError) throw tooLarge();
      if (controller.signal.aborted) throw new AttachmentTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (data.byteLength > FILE_MAX_BYTES) throw tooLarge();
    return data;
  }
}
