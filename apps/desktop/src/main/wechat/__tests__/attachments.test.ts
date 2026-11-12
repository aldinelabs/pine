// @vitest-environment node
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IlinkMediaTooLargeError } from "@pine/wechat-ilink";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseAttachmentMessage,
  serializeAttachmentMessage,
} from "../../../shared/attachments";
import {
  AttachmentLimitError,
  AttachmentTimeoutError,
  AttachmentTooLargeError,
  InboundAttachments,
  sanitiseDisplayName,
} from "../attachments";
import {
  FILE_MAX_BYTES,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  PENDING_ATTACHMENTS_MAX,
  PENDING_ATTACHMENT_TTL_MS,
} from "../constants";
import type {
  PendingAttachment,
  StoredMedia,
  WeChatPersistedState,
  WeChatStateStore,
} from "../types";

function memoryStore(): WeChatStateStore & { writes: number } {
  const state = {
    pendingAttachments: [] as PendingAttachment[],
  } as WeChatPersistedState;
  const store = {
    writes: 0,
    get: () => state,
    update(mutate: (draft: WeChatPersistedState) => void) {
      mutate(state);
      store.writes++;
      return Promise.resolve();
    },
  };
  return store as unknown as WeChatStateStore & { writes: number };
}

let root: string;
let inbox: string;
let project: string;
let store: ReturnType<typeof memoryStore>;
let now: number;
let attachments: InboundAttachments;

const media = (overrides: Partial<StoredMedia> = {}): StoredMedia => ({
  kind: "file",
  fileName: "report.pdf",
  ref: "secret-ref",
  ...overrides,
});
const serve = (data: Buffer | string) => () =>
  Promise.resolve(Buffer.isBuffer(data) ? data : Buffer.from(data));

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pine-wechat-attachments-"));
  inbox = path.join(root, "data", "wechat-inbox");
  project = path.join(root, "project", "attachments");
  store = memoryStore();
  now = 1_000_000;
  attachments = new InboundAttachments({
    store,
    directory: inbox,
    now: () => now,
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

describe("stage", () => {
  it("writes a generated name with private modes and records the entry", async () => {
    const download = vi.fn(serve("pdf bytes"));
    const staged = await attachments.stage(media(), download);

    expect(download).toHaveBeenCalledWith(
      "secret-ref",
      FILE_MAX_BYTES,
      expect.any(AbortSignal),
    );
    expect(staged).toMatchObject({
      name: "report.pdf",
      sizeBytes: 9,
      kind: "file",
      receivedAtMs: now,
    });
    expect(path.dirname(staged.stagedPath)).toBe(path.resolve(inbox));
    expect(path.basename(staged.stagedPath)).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(await readFile(staged.stagedPath, "utf8")).toBe("pdf bytes");
    expect((await stat(inbox)).mode & 0o777).toBe(0o700);
    expect((await stat(staged.stagedPath)).mode & 0o777).toBe(0o600);
    expect(attachments.list()).toEqual([staged]);
  });

  it("a ../ name cannot leave the directory", async () => {
    const staged = await attachments.stage(
      media({ fileName: "../../../etc/passwd\u202e.sh" }),
      serve("x"),
    );
    expect(path.dirname(staged.stagedPath)).toBe(path.resolve(inbox));
    expect(staged.name).toBe("passwd.sh");
    expect(await readdir(path.join(root, "data"))).toEqual(["wechat-inbox"]);

    const windows = await attachments.stage(
      media({ fileName: "..\\..\\evil.txt" }),
      serve("y"),
    );
    expect(windows.name).toBe("evil.txt");
    expect(path.dirname(windows.stagedPath)).toBe(path.resolve(inbox));
  });

  it("cuts the display name and names unnamed media", async () => {
    const long = await attachments.stage(
      media({ fileName: `${"a".repeat(300)}.txt` }),
      serve("x"),
    );
    expect(Array.from(long.name)).toHaveLength(200);

    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
    ]);
    const image = await attachments.stage(
      { kind: "image", ref: "r" },
      serve(png),
    );
    expect(image.name).toBe("image.png");
    expect(image.stagedPath.endsWith(".png")).toBe(true);
    const video = await attachments.stage(
      { kind: "video", ref: "r" },
      serve("v"),
    );
    expect(video.name).toBe("video.mp4");
  });

  it("refuses files over the cap", async () => {
    const download = vi.fn(serve("x"));
    await expect(
      attachments.stage(media({ sizeBytes: FILE_MAX_BYTES + 1 }), download),
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
    expect(download).not.toHaveBeenCalled();

    await expect(
      attachments.stage(media(), () =>
        Promise.reject(new IlinkMediaTooLargeError(FILE_MAX_BYTES)),
      ),
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
    expect(attachments.list()).toHaveLength(0);
  });

  it("a timeout aborts the download", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal: AbortSignal | undefined;
    const pending = attachments.stage(media(), (_ref, _max, s) => {
      signal = s;
      return new Promise<Buffer>(() => undefined);
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(
      AttachmentTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(MEDIA_DOWNLOAD_TIMEOUT_MS);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(attachments.list()).toHaveLength(0);
  });

  it("limits how many attachments wait", async () => {
    for (let index = 0; index < PENDING_ATTACHMENTS_MAX; index++) {
      await attachments.stage(media(), serve("x"));
    }
    await expect(attachments.stage(media(), serve("x"))).rejects.toBeInstanceOf(
      AttachmentLimitError,
    );
  });
});

describe("take", () => {
  it("moves the files under new names and clears the list", async () => {
    const first = await attachments.stage(media(), serve("one"));
    const second = await attachments.stage(
      media({ fileName: "notes.txt" }),
      serve("two"),
    );
    const taken = await attachments.take(project);

    expect(taken).toHaveLength(2);
    expect(taken.map((attachment) => attachment.name)).toEqual([
      "report.pdf",
      "notes.txt",
    ]);
    for (const attachment of taken) {
      expect(path.dirname(attachment.path)).toBe(path.resolve(project));
      expect(attachment.path).not.toBe(first.stagedPath);
      expect(attachment.path).not.toBe(second.stagedPath);
      expect(attachment.kind).toBe("file");
    }
    expect(taken[0]).toMatchObject({ extension: "pdf", size: 3 });
    expect(await readFile(taken[1]?.path ?? "", "utf8")).toBe("two");
    expect(await readdir(inbox)).toEqual([]);
    expect(attachments.list()).toEqual([]);

    const message = serializeAttachmentMessage(taken, "look");
    expect(
      parseAttachmentMessage(message).attachments.map((entry) => entry.path),
    ).toEqual(taken.map((entry) => entry.path));
    expect(await attachments.take(project)).toEqual([]);
  });

  it("never moves a path it did not stage", async () => {
    const outside = path.join(root, "secret.txt");
    await writeFile(outside, "secret");
    store.get().pendingAttachments.push({
      id: "forged",
      name: "secret.txt",
      sizeBytes: 6,
      kind: "file",
      stagedPath: outside,
      receivedAtMs: now,
    });
    expect(await attachments.take(project)).toEqual([]);
    expect(await readFile(outside, "utf8")).toBe("secret");
    expect(attachments.list()).toEqual([]);

    store.get().pendingAttachments.push({
      id: "forged-2",
      name: "secret.txt",
      sizeBytes: 6,
      kind: "file",
      stagedPath: outside,
      receivedAtMs: now,
    });
    expect(await attachments.drop()).toBe(1);
    expect(await readFile(outside, "utf8")).toBe("secret");
  });

  it("skips a staged file that is gone", async () => {
    const staged = await attachments.stage(media(), serve("x"));
    await rm(staged.stagedPath);
    expect(await attachments.take(project)).toEqual([]);
    expect(attachments.list()).toEqual([]);
  });
});

describe("drop and sweep", () => {
  it("drop unlinks the files", async () => {
    await attachments.stage(media(), serve("x"));
    await attachments.stage(media(), serve("y"));
    expect(await attachments.drop()).toBe(2);
    expect(await readdir(inbox)).toEqual([]);
    expect(attachments.list()).toEqual([]);
    expect(await attachments.drop()).toBe(0);
  });

  it("sweep removes expired entries and orphans", async () => {
    const old = await attachments.stage(media(), serve("old"));
    now += PENDING_ATTACHMENT_TTL_MS / 2;
    const fresh = await attachments.stage(media(), serve("fresh"));
    const orphan = path.join(inbox, "00000000-0000-4000-8000-000000000000.txt");
    await writeFile(orphan, "left behind");
    const foreign = path.join(inbox, "keep-me.txt");
    await writeFile(foreign, "not ours");
    const sweepAt = old.receivedAtMs + PENDING_ATTACHMENT_TTL_MS;
    const past = new Date(sweepAt - PENDING_ATTACHMENT_TTL_MS);
    await utimes(orphan, past, past);

    await attachments.sweep(sweepAt);
    expect(attachments.list()).toEqual([fresh]);
    const left = await readdir(inbox);
    expect(left).toContain(path.basename(fresh.stagedPath));
    expect(left).toContain("keep-me.txt");
    expect(left).not.toContain(path.basename(old.stagedPath));
    expect(left).not.toContain(path.basename(orphan));
  });

  it("sweep without a directory does nothing", async () => {
    await expect(attachments.sweep(now)).resolves.toBeUndefined();
  });
});

describe("sanitiseDisplayName", () => {
  it("keeps the last segment without control characters", () => {
    expect(sanitiseDisplayName("a/b\\c\u0000d.txt")).toBe("cd.txt");
    expect(sanitiseDisplayName("..")).toBe("");
    expect(sanitiseDisplayName(undefined)).toBe("");
  });
});
