// WeChat remote's state on this computer, in two files:
// - the sealed blob (token, owner, settings, paused), encrypted with the
//   host's credential storage, because these values decide what WeChat may do;
// - wechat-remote.json (cursor, caches, queues), which never widens what
//   WeChat may do. Both are written 0600 through a temporary file and rename.
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { APPROVAL_MODE_ORDER } from "../../shared/agent";
import type { PineApprovalMode } from "../../shared/agent";
import {
  DEFAULT_WECHAT_SETTINGS,
  clampWeChatSettings,
  resetWeChatPermissions,
  type WeChatSettings,
} from "../../shared/wechatRemote";
import type { TinyFishSafeStorage } from "../tinyfishCredentials";
import {
  ASK_MIN,
  INBOX_MAX,
  ORIGINS_MAX,
  OUT_QUEUE_MAX,
  PENDING_ATTACHMENTS_MAX,
  SEEN_MAX,
  STATE_WRITE_DEBOUNCE_MS,
  TOKEN_MAX_LENGTH,
  TRACKED_MAX,
} from "./constants";
import type {
  WeChatPersistedState,
  WeChatSecureState,
  WeChatStateStore,
} from "./types";

/** Per-session `.mode` overrides kept at most; the oldest entries go first. */
const MODE_OVERRIDES_MAX = 200;

const ENCRYPTION_UNAVAILABLE =
  "The operating system secure credential store is unavailable. WeChat remote cannot be configured safely on this system.";

const modeSchema = z.enum(
  APPROVAL_MODE_ORDER as [PineApprovalMode, ...PineApprovalMode[]],
);
const mediaKindSchema = z.enum(["image", "file", "video"]);

const storedMediaSchema = z.object({
  kind: mediaKindSchema,
  fileName: z.string().optional(),
  sizeBytes: z.number().optional(),
  ref: z.string(),
});

const storedInboundSchema = z.object({
  id: z.string(),
  createdAtMs: z.number(),
  pollStartedAtMs: z.number(),
  text: z.string().optional(),
  voice: z.boolean().optional(),
  quotedText: z.string().optional(),
  media: z.array(storedMediaSchema),
  startedAtMs: z.number().optional(),
});

const pendingAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  sizeBytes: z.number(),
  kind: mediaKindSchema,
  stagedPath: z.string(),
  receivedAtMs: z.number(),
});

const trackedSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  origin: z.enum(["wechat", "adopted", "spawned"]),
  trackedAtMs: z.number(),
  lastUsedAtMs: z.number(),
});

const originSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  kind: z.enum(["started", "used", "spawned"]),
  atMs: z.number(),
  touchedLocally: z.boolean().optional(),
});

const handleTableSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      projectId: z.string().optional(),
    }),
  ),
  sentAtMs: z.number(),
  sessionId: z.string().optional(),
});

const digestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("done"), title: z.string() }),
  z.object({ kind: z.literal("failed"), title: z.string() }),
  z.object({ kind: z.literal("ask"), number: z.number() }),
  z.object({
    kind: z.literal("autorun"),
    name: z.string(),
    result: z.string(),
  }),
  z.object({
    kind: z.literal("auto-on"),
    name: z.string(),
    result: z.enum(["approved", "denied", "timeout"]),
  }),
]);

const queuedSchema = z.object({
  key: z.string(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  digest: digestSchema,
  queuedAtMs: z.number(),
});

const sessionRefSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
});

/** A field that fails validation falls back on its own; the rest of the file is kept. */
function field<T extends z.ZodType>(schema: T, fallback: () => z.output<T>) {
  return schema
    .optional()
    .catch(undefined)
    .transform((value) => (value === undefined ? fallback() : value));
}

const plainSchema = z.object({
  language: field(z.enum(["zh", "en", "auto"]), () => "auto" as const),
  cursor: field(z.string(), () => ""),
  contextToken: z
    .object({
      value: z.string().min(1).max(TOKEN_MAX_LENGTH),
      receivedAtMs: z.number(),
      sent: z.number(),
      budgetNoticeSent: z.boolean(),
    })
    .optional()
    .catch(undefined),
  seenMessageIds: field(z.array(z.string()), () => []),
  inbox: field(z.array(storedInboundSchema), () => []),
  pendingAttachments: field(z.array(pendingAttachmentSchema), () => []),
  currentProjectId: z.string().optional().catch(undefined),
  current: sessionRefSchema
    .extend({ usedAtMs: z.number() })
    .optional()
    .catch(undefined),
  tracked: field(z.array(trackedSchema), () => []),
  origins: field(z.array(originSchema), () => []),
  lastPush: sessionRefSchema
    .extend({ atMs: z.number() })
    .optional()
    .catch(undefined),
  lastAcceptedAtMs: z.number().optional().catch(undefined),
  handles: field(
    z.object({
      session: handleTableSchema.optional(),
      project: handleTableSchema.optional(),
    }),
    () => ({}),
  ),
  nextAsk: field(z.number().int(), () => ASK_MIN),
  modeOverride: field(z.record(z.string(), modeSchema), () => ({})),
  outQueue: field(z.array(queuedSchema), () => []),
  lastPausedNoticeAtMs: z.number().optional().catch(undefined),
});

const settingsSchema = z.object({
  ceilingMode: modeSchema.default(DEFAULT_WECHAT_SETTINGS.ceilingMode),
  defaultMode: modeSchema.default(DEFAULT_WECHAT_SETTINGS.defaultMode),
  defaultProjectId: z.string().min(1).optional(),
  allowHighRiskApprovals: z
    .boolean()
    .default(DEFAULT_WECHAT_SETTINGS.allowHighRiskApprovals),
  allowFileSending: z
    .boolean()
    .default(DEFAULT_WECHAT_SETTINGS.allowFileSending),
  /** Old WeChat-only keep-awake switch: read for migration, never kept. */
  keepAwake: z.boolean().optional(),
});

/** Strict: anything unexpected in the sealed blob resets it (paused, default settings). */
const secureSchema = z.object({
  version: z.literal(1),
  token: z.string().min(1).max(TOKEN_MAX_LENGTH).optional(),
  owner: z
    .object({
      userId: z.string().min(1),
      botId: z.string().min(1),
      baseUrl: z.string().min(1),
      boundAt: z.number(),
    })
    .optional(),
  settings: settingsSchema.default({ ...DEFAULT_WECHAT_SETTINGS }),
  paused: z.boolean().default(false),
});

export function defaultPersistedState(): WeChatPersistedState {
  return {
    version: 1,
    language: "auto",
    cursor: "",
    seenMessageIds: [],
    inbox: [],
    pendingAttachments: [],
    tracked: [],
    origins: [],
    handles: {},
    nextAsk: ASK_MIN,
    modeOverride: {},
    outQueue: [],
  };
}

function defaultSecureState(paused: boolean): WeChatSecureState {
  return { version: 1, settings: { ...DEFAULT_WECHAT_SETTINGS }, paused };
}

function withoutUndefined<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function parsePlain(raw: unknown): WeChatPersistedState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return defaultPersistedState();
  }
  const parsed = plainSchema.safeParse(raw);
  if (!parsed.success) return defaultPersistedState();
  const state = withoutUndefined({ version: 1 as const, ...parsed.data });
  for (const ref of ["current", "lastPush", "contextToken"] as const) {
    if (state[ref]) withoutUndefined(state[ref]);
  }
  return bounded(state);
}

function newest<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(items.length - max) : items;
}

/** Keeps every list within its limit, newest last, before a write. */
function bounded(state: WeChatPersistedState): WeChatPersistedState {
  state.seenMessageIds = newest(state.seenMessageIds, SEEN_MAX);
  state.inbox = newest(state.inbox, INBOX_MAX);
  state.pendingAttachments = newest(
    state.pendingAttachments,
    PENDING_ATTACHMENTS_MAX,
  );
  state.tracked = newest(state.tracked, TRACKED_MAX);
  state.origins = newest(state.origins, ORIGINS_MAX);
  state.outQueue = newest(state.outQueue, OUT_QUEUE_MAX);
  const overrides = Object.entries(state.modeOverride);
  if (overrides.length > MODE_OVERRIDES_MAX) {
    state.modeOverride = Object.fromEntries(
      newest(overrides, MODE_OVERRIDES_MAX),
    );
  }
  return state;
}

function clampSettings(settings: WeChatSettings): WeChatSettings {
  return withoutUndefined(clampWeChatSettings(settings));
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function writePrivate(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, filePath);
    await chmod(filePath, 0o600);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export interface WeChatStoreOptions {
  /** wechat-remote.json in the agent directory. */
  statePath: string;
  /** The sealed blob in the data directory. */
  securePath: string;
  storage: TinyFishSafeStorage;
  /** Default STATE_WRITE_DEBOUNCE_MS. */
  debounceMs?: number;
}

type SecureRead = { result: "ok" | "reset"; state: WeChatSecureState };

export class WeChatStore implements WeChatStateStore {
  private state: WeChatPersistedState = defaultPersistedState();
  private secureState: WeChatSecureState = defaultSecureState(false);
  private plainQueue: Promise<unknown> = Promise.resolve();
  private secureQueue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  /** Sticky: a blob read in this run held the old keep-awake switch on. */
  private legacy = false;

  constructor(private readonly options: WeChatStoreOptions) {}

  async load(): Promise<"ok" | "reset"> {
    this.state = await this.readPlain();
    return this.reloadSecure();
  }

  get(): Readonly<WeChatPersistedState> {
    return this.state;
  }

  update(mutate: (draft: WeChatPersistedState) => void): Promise<void> {
    return this.enqueuePlain(async () => {
      this.cancelTimer();
      mutate(this.state);
      bounded(this.state);
      await this.writePlain();
    });
  }

  updateSoon(mutate: (draft: WeChatPersistedState) => void): void {
    mutate(this.state);
    bounded(this.state);
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.enqueuePlain(() => this.writePlain()).catch(
        (error: unknown) => {
          console.error("WeChat remote could not save its state.", error);
        },
      );
    }, this.options.debounceMs ?? STATE_WRITE_DEBOUNCE_MS);
    this.timer.unref?.();
  }

  flush(): Promise<void> {
    this.cancelTimer();
    return this.enqueuePlain(async () => {
      if (this.dirty) await this.writePlain();
    });
  }

  canEncrypt(): boolean {
    try {
      return this.options.storage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  legacyKeepAwake(): boolean {
    return this.legacy;
  }

  secure(): Readonly<WeChatSecureState> {
    return this.secureState;
  }

  updateSecure(mutate: (draft: WeChatSecureState) => void): Promise<void> {
    return this.enqueueSecure(async () => {
      if (!this.canEncrypt()) throw new Error(ENCRYPTION_UNAVAILABLE);
      // Re-read first, so a change written by another process is kept.
      const draft = structuredClone((await this.readSecure()).state);
      mutate(draft);
      draft.settings = clampSettings(draft.settings);
      withoutUndefined(draft);
      await this.writeSecure(draft);
      this.secureState = draft;
    });
  }

  reloadSecure(): Promise<"ok" | "reset"> {
    return this.enqueueSecure(async () => {
      const read = await this.readSecure();
      this.secureState = read.state;
      return read.result;
    });
  }

  reloadLanguage(): Promise<void> {
    return this.enqueuePlain(async () => {
      const read = await this.readPlain();
      this.state.language = read.language;
    });
  }

  async clearBinding(): Promise<void> {
    await this.updateSecure((draft) => {
      delete draft.token;
      delete draft.owner;
      draft.settings = resetWeChatPermissions(draft.settings);
    });
    await this.update((draft) => {
      const language = draft.language;
      for (const key of Object.keys(draft)) {
        delete (draft as unknown as Record<string, unknown>)[key];
      }
      Object.assign(draft, defaultPersistedState(), { language });
    });
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private enqueuePlain<T>(run: () => Promise<T>): Promise<T> {
    const pending = this.plainQueue.then(run);
    this.plainQueue = pending.catch(() => undefined);
    return pending;
  }

  private enqueueSecure<T>(run: () => Promise<T>): Promise<T> {
    const pending = this.secureQueue.then(run);
    this.secureQueue = pending.catch(() => undefined);
    return pending;
  }

  private async readPlain(): Promise<WeChatPersistedState> {
    try {
      const text = await readFile(this.options.statePath, "utf8");
      return parsePlain(JSON.parse(text));
    } catch {
      // A missing or corrupt state file only loses caches and the cursor.
      return defaultPersistedState();
    }
  }

  private async writePlain(): Promise<void> {
    this.dirty = false;
    try {
      await writePrivate(
        this.options.statePath,
        `${JSON.stringify(this.state)}\n`,
      );
    } catch (error) {
      this.dirty = true;
      throw error;
    }
  }

  private async readSecure(): Promise<SecureRead> {
    let encoded: string;
    try {
      encoded = (await readFile(this.options.securePath, "utf8")).trim();
    } catch (error) {
      if (isMissing(error)) {
        return { result: "ok", state: defaultSecureState(false) };
      }
      return { result: "reset", state: defaultSecureState(true) };
    }
    try {
      if (!encoded || !this.canEncrypt()) throw new Error("unreadable");
      const json = this.options.storage.decryptString(
        Buffer.from(encoded, "base64"),
      );
      const parsed = secureSchema.parse(JSON.parse(json));
      const { keepAwake, ...settings } = parsed.settings;
      this.legacy ||= keepAwake === true;
      const state: WeChatSecureState = withoutUndefined({
        ...parsed,
        settings: clampSettings(withoutUndefined(settings)),
      });
      return { result: "ok", state };
    } catch {
      // Tampered, undecryptable or invalid: start paused with defaults.
      return { result: "reset", state: defaultSecureState(true) };
    }
  }

  private async writeSecure(state: WeChatSecureState): Promise<void> {
    const encoded = this.options.storage
      .encryptString(JSON.stringify(state))
      .toString("base64");
    await writePrivate(this.options.securePath, encoded);
  }
}
