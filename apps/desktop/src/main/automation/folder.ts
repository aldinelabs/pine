import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AutomationFileChange,
  AutomationFileEvent,
} from "../../shared/automation";

const MAX_SCANNED_FILES = 20_000;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".Trash"]);
const SKIPPED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
/** Polling catches what file watching misses on network and cloud drives. */
export const FOLDER_POLL_INTERVAL_MS = 60_000;

export interface FileSignature {
  size: number;
  mtimeMs: number;
}

export function signatureKey(signature: FileSignature): string {
  return `${signature.size}:${Math.trunc(signature.mtimeMs)}`;
}

export interface FolderScope {
  root: string;
  include?: string[];
  exclude?: string[];
}

function matches(relativePath: string, scope: FolderScope): boolean {
  const included =
    !scope.include?.length ||
    scope.include.some((pattern) =>
      path.posix.matchesGlob(relativePath, pattern),
    );
  return (
    included &&
    !(scope.exclude ?? []).some((pattern) =>
      path.posix.matchesGlob(relativePath, pattern),
    )
  );
}

/** Files under the scope root, keyed by portable relative path. */
export async function scanFolder(
  scope: FolderScope,
): Promise<{ files: Map<string, FileSignature>; truncated: boolean }> {
  const files = new Map<string, FileSignature>();
  let truncated = false;
  const visit = async (directory: string, prefix: string): Promise<void> => {
    if (truncated) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (files.size >= MAX_SCANNED_FILES) {
        truncated = true;
        return;
      }
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name))
          await visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || SKIPPED_FILES.has(entry.name)) continue;
      // Office lock files and partial downloads are never finished documents.
      if (/^~\$|\.(crdownload|part|download|tmp)$/i.test(entry.name)) continue;
      if (!matches(relativePath, scope)) continue;
      const info = await stat(absolutePath).catch(() => undefined);
      if (info)
        files.set(relativePath, { size: info.size, mtimeMs: info.mtimeMs });
    }
  };
  await visit(scope.root, "");
  return { files, truncated };
}

export interface FolderChange {
  path: string;
  change: AutomationFileChange;
  signature?: FileSignature;
}

/** What changed relative to the processed snapshot. */
export function diffFolder(
  processed: Readonly<Record<string, string>>,
  current: ReadonlyMap<string, FileSignature>,
): FolderChange[] {
  const changes: FolderChange[] = [];
  for (const [relativePath, signature] of current) {
    const previous = processed[relativePath];
    if (previous === undefined)
      changes.push({ path: relativePath, change: "added", signature });
    else if (previous !== signatureKey(signature))
      changes.push({ path: relativePath, change: "changed", signature });
  }
  for (const relativePath of Object.keys(processed))
    if (!current.has(relativePath))
      changes.push({ path: relativePath, change: "removed" });
  return changes;
}

export function fileEvent(
  folderId: string,
  scopePath: string,
  change: FolderChange,
): AutomationFileEvent {
  const fullPath = scopePath ? `${scopePath}/${change.path}` : change.path;
  const name = path.posix.basename(change.path);
  return {
    folderId,
    path: fullPath,
    name,
    ext: path.posix.extname(name).slice(1).toLowerCase(),
    size: change.signature?.size ?? 0,
    mtime: new Date(change.signature?.mtimeMs ?? Date.now()).toISOString(),
    change: change.change,
  };
}

export interface FolderMonitorOptions {
  scope: FolderScope;
  settleMs: number;
  batchMs: number;
  /** The snapshot of files already handled. */
  processed: () => Readonly<Record<string, string>>;
  /** Settled changes, at most once per batch window. */
  onBatch: (changes: FolderChange[]) => void;
  onError?: (error: unknown) => void;
}

/**
 * Watches one folder trigger. A change counts once its size and mtime have
 * stayed the same for the settle window; changes are then batched.
 */
export class FolderMonitor {
  private watcher?: FSWatcher;
  private pollTimer?: ReturnType<typeof setInterval>;
  private scanTimer?: ReturnType<typeof setTimeout>;
  private batchTimer?: ReturnType<typeof setTimeout>;
  private readonly pending = new Map<string, { key: string; since: number }>();
  private scanning = false;
  private rescan = false;
  private stopped = false;
  watchMode: "watch" | "poll" = "poll";

  constructor(private readonly options: FolderMonitorOptions) {}

  start(): void {
    try {
      this.watcher = watch(this.options.scope.root, { recursive: true }, () =>
        this.scheduleScan(250),
      );
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = undefined;
        this.watchMode = "poll";
      });
      this.watchMode = "watch";
    } catch {
      this.watchMode = "poll";
    }
    this.pollTimer = setInterval(
      () => this.scheduleScan(0),
      FOLDER_POLL_INTERVAL_MS,
    );
    this.scheduleScan(0);
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    clearInterval(this.pollTimer);
    clearTimeout(this.scanTimer);
    clearTimeout(this.batchTimer);
  }

  /** Scan soon, for example after the system resumes. */
  poke(): void {
    this.scheduleScan(0);
  }

  private scheduleScan(delayMs: number): void {
    if (this.stopped) return;
    if (this.scanTimer) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = undefined;
      void this.scan();
    }, delayMs);
  }

  private async scan(): Promise<void> {
    if (this.scanning) {
      this.rescan = true;
      return;
    }
    this.scanning = true;
    try {
      const { files } = await scanFolder(this.options.scope);
      if (this.stopped) return;
      const now = Date.now();
      const changes = diffFolder(this.options.processed(), files);
      const seen = new Set<string>();
      let waiting = false;
      for (const change of changes) {
        seen.add(change.path);
        const key = change.signature
          ? signatureKey(change.signature)
          : "removed";
        const pending = this.pending.get(change.path);
        if (!pending || pending.key !== key) {
          this.pending.set(change.path, { key, since: now });
          waiting = true;
        } else if (now - pending.since < this.options.settleMs) waiting = true;
      }
      for (const relativePath of this.pending.keys())
        if (!seen.has(relativePath)) this.pending.delete(relativePath);
      if (waiting) this.scheduleScan(this.options.settleMs);
      const settled = changes.filter((change) => {
        const pending = this.pending.get(change.path);
        return (
          pending !== undefined && now - pending.since >= this.options.settleMs
        );
      });
      if (settled.length > 0 && !this.batchTimer) {
        this.batchTimer = setTimeout(() => {
          this.batchTimer = undefined;
          void this.flush();
        }, this.options.batchMs);
      }
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.scanning = false;
      if (this.rescan) {
        this.rescan = false;
        this.scheduleScan(0);
      }
    }
  }

  private async flush(): Promise<void> {
    const { files } = await scanFolder(this.options.scope).catch(() => ({
      files: new Map<string, FileSignature>(),
    }));
    if (this.stopped) return;
    const now = Date.now();
    const settled = diffFolder(this.options.processed(), files).filter(
      (change) => {
        const pending = this.pending.get(change.path);
        const key = change.signature
          ? signatureKey(change.signature)
          : "removed";
        return (
          pending !== undefined &&
          pending.key === key &&
          now - pending.since >= this.options.settleMs
        );
      },
    );
    for (const change of settled) this.pending.delete(change.path);
    if (settled.length > 0) this.options.onBatch(settled);
    if (this.pending.size > 0) this.scheduleScan(this.options.settleMs);
  }
}
