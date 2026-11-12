// Numbered references (CMD §4.1) and the `.more` cursor. Pure: no I/O.
import { HANDLE_TTL_MS, PAGER_TTL_MS } from "./constants";
import type {
  HandleKind,
  HandleRow,
  HandleTable,
  WeChatPersistedState,
} from "./types";

/** Tables that belong to one session; using them after the current session changed is `E-REF`. */
export const SESSION_SCOPED_HANDLES: ReadonlySet<HandleKind> = new Set([
  "file",
  "task",
  "queue",
]);
/** Tables kept in `wechat-remote.json`; the others die on restart. */
export const PERSISTED_HANDLES = ["session", "project"] as const;
export type PersistedHandleKind = (typeof PERSISTED_HANDLES)[number];
export type HandleSnapshot = WeChatPersistedState["handles"];

type Entry = HandleTable;

export interface HandleTablesOptions {
  now?: () => number;
}

/**
 * One table per kind. Only replies call `set` / `noteDelivered`; pushes never
 * touch a table (CMD §4.1).
 *
 * `set` stores a pending table; `noteDelivered` makes it the table of its
 * kind. Until then `resolve`, `table` and `last()` keep answering from the
 * table the user last received, so a list reply that could not be sent never
 * changes what a number means ("row N of the list of that kind I saw last").
 * A delivered table expires 30 minutes after its delivery time.
 */
export class HandleTables {
  private readonly now: () => number;
  private readonly tables = new Map<HandleKind, Entry>();
  private readonly pending = new Map<HandleKind, Entry>();
  private lastNumbered: { kind: HandleKind; deliveredAtMs: number } | undefined;

  constructor(options: HandleTablesOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /** `sessionId` is required for `file`, `task` and `queue` tables. */
  set(kind: HandleKind, rows: readonly HandleRow[], sessionId?: string): void {
    if (SESSION_SCOPED_HANDLES.has(kind) && sessionId === undefined) {
      throw new Error(`A ${kind} table belongs to a session.`);
    }
    const entry: Entry = {
      rows: rows.map((row) => ({ ...row })),
      sentAtMs: this.now(),
    };
    if (sessionId !== undefined) entry.sessionId = sessionId;
    this.pending.set(kind, entry);
  }

  /** Row `n` (1-based) of the delivered table of `kind`; undefined when missing, expired, out of range or of another session. */
  resolve(
    kind: HandleKind,
    n: number,
    sessionId?: string,
  ): HandleRow | undefined {
    const entry = this.live(kind);
    if (!entry) return undefined;
    if (entry.sessionId !== undefined && entry.sessionId !== sessionId)
      return undefined;
    if (!Number.isInteger(n) || n < 1) return undefined;
    const row = entry.rows[n - 1];
    return row ? { ...row } : undefined;
  }

  /** The delivered table of `kind`, if still valid. */
  table(kind: HandleKind): Readonly<HandleTable> | undefined {
    const entry = this.live(kind);
    if (!entry) return undefined;
    return copy(entry);
  }

  /** The reply that carried the pending table of `kind` was sent at `atMs`. */
  noteDelivered(kind: HandleKind, atMs: number): void {
    const entry = this.pending.get(kind);
    if (!entry) return;
    this.pending.delete(kind);
    this.tables.set(kind, { ...entry, sentAtMs: atMs });
    this.lastNumbered = { kind, deliveredAtMs: atMs };
  }

  /** The latest delivered list, if its table is still valid. */
  last(): { kind: HandleKind; deliveredAtMs: number } | undefined {
    const last = this.lastNumbered;
    if (!last) return undefined;
    if (!this.live(last.kind)) return undefined;
    return { ...last };
  }

  clear(kind?: HandleKind): void {
    if (kind === undefined) {
      this.tables.clear();
      this.pending.clear();
      this.lastNumbered = undefined;
      return;
    }
    this.tables.delete(kind);
    this.pending.delete(kind);
    if (this.lastNumbered?.kind === kind) this.lastNumbered = undefined;
  }

  /** Delivered, unexpired session and project tables, for the state file. */
  snapshot(): HandleSnapshot {
    const snapshot: HandleSnapshot = {};
    for (const kind of PERSISTED_HANDLES) {
      const entry = this.live(kind);
      if (!entry) continue;
      snapshot[kind] = {
        rows: entry.rows.map((row) => ({ ...row })),
        sentAtMs: entry.sentAtMs,
      };
    }
    return snapshot;
  }

  /** Loads persisted tables as delivered; expired ones are dropped. `last()` stays empty after a restart. */
  restore(snapshot: HandleSnapshot | undefined): void {
    for (const kind of PERSISTED_HANDLES) {
      const table = snapshot?.[kind];
      if (!table) continue;
      if (this.now() - table.sentAtMs > HANDLE_TTL_MS) continue;
      this.tables.set(kind, {
        rows: table.rows.map((row) => ({ ...row })),
        sentAtMs: table.sentAtMs,
      });
    }
  }

  private live(kind: HandleKind): Entry | undefined {
    const entry = this.tables.get(kind);
    if (!entry) return undefined;
    if (this.now() - entry.sentAtMs > HANDLE_TTL_MS) {
      this.tables.delete(kind);
      return undefined;
    }
    return entry;
  }
}

function copy(entry: Entry): HandleTable {
  const table: HandleTable = {
    rows: entry.rows.map((row) => ({ ...row })),
    sentAtMs: entry.sentAtMs,
  };
  if (entry.sessionId !== undefined) table.sessionId = entry.sessionId;
  return table;
}

/** A page `.more` sends. `list` is set for a page of a numbered list: sending it replaces that table. */
export interface PagerPage {
  text: string;
  list?: { kind: HandleKind; rows: HandleRow[]; sessionId?: string };
}

export interface PagerOptions {
  now?: () => number;
}

/**
 * The one `.more` cursor (CMD §7.1). `set` takes the pages still to come (the
 * caller sends the first page itself) and replaces any earlier cursor. The
 * cursor expires `PAGER_TTL_MS` after it was set or last advanced.
 */
export class Pager {
  private readonly now: () => number;
  private pages: PagerPage[] = [];
  private touchedAtMs = 0;

  constructor(options: PagerOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  set(pages: readonly (string | PagerPage)[]): void {
    this.pages = pages.map((page) =>
      typeof page === "string" ? { text: page } : { ...page },
    );
    this.touchedAtMs = this.now();
  }

  /** The next page, or undefined when there is none or the cursor expired. */
  next(): PagerPage | undefined {
    if (!this.valid()) {
      this.pages = [];
      return undefined;
    }
    const page = this.pages.shift();
    this.touchedAtMs = this.now();
    return page;
  }

  /** Pages left behind the cursor. */
  remaining(): number {
    return this.valid() ? this.pages.length : 0;
  }

  clear(): void {
    this.pages = [];
  }

  private valid(): boolean {
    return (
      this.pages.length > 0 && this.now() - this.touchedAtMs <= PAGER_TTL_MS
    );
  }
}
