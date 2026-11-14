import { watch, type FSWatcher } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  PiProviderSkip,
  PiProvidersFileError,
  PiProvidersStatus,
} from "../../shared/piProviders";
import { readPineAgentSettings } from "../pineSettings";
import {
  readPiProviders,
  resolvePiAgentDir,
  type PiAgentDirLocation,
} from "./pi-providers";

export interface PiProviderSyncOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Delay between a change to models.json and the reload. */
  debounceMs?: number;
  /** How often to look for Pi's agent folder while it does not exist yet. */
  retryMs?: number;
}

type RegisteringRuntime = Pick<
  ModelRuntime,
  "registerProvider" | "unregisterProvider" | "getProvider"
>;

/**
 * Keeps the providers from Pi's models.json (written by Pi or CC Switch)
 * registered on one Pine model runtime while the Pine setting is on. The file
 * is only read; keys stay in this process and never reach the renderer.
 */
export class PiProviderSync {
  private readonly registered = new Set<string>();
  private enabled = false;
  private location: PiAgentDirLocation;
  private found = false;
  private skipped: PiProviderSkip[] = [];
  private error: PiProvidersFileError | undefined;
  private watcher: FSWatcher | undefined;
  private watchedDir: string | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly runtime: RegisteringRuntime,
    private readonly pineAgentDir: string,
    private readonly options: PiProviderSyncOptions = {},
  ) {
    this.location = resolvePiAgentDir(undefined, options.env, options.home);
  }

  /** Whether Pine registered this provider id from Pi's models.json. */
  has(providerId: string): boolean {
    return this.registered.has(providerId);
  }

  status(): PiProvidersStatus {
    return {
      enabled: this.enabled,
      agentDir: this.location.agentDir,
      agentDirSource: this.location.source,
      path: path.join(this.location.agentDir, "models.json"),
      found: this.found,
      count: this.registered.size,
      skipped: [...this.skipped],
      ...(this.error ? { error: this.error } : {}),
    };
  }

  /** Re-reads the Pine setting, then registers or removes Pi's providers. */
  sync(): Promise<PiProvidersStatus> {
    return this.enqueue(async () => {
      const setting = (await readPineAgentSettings(this.pineAgentDir))
        .piProviders;
      this.enabled = setting?.enabled === true;
      this.location = resolvePiAgentDir(
        setting?.agentDir,
        this.options.env,
        this.options.home,
      );
      if (!this.enabled) {
        this.stopWatching();
        this.unregisterAll();
        this.skipped = [];
        this.error = undefined;
        this.found = await exists(this.modelsPath());
        return this.status();
      }
      this.watchAgentDir();
      await this.load();
      return this.status();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stopWatching();
  }

  private modelsPath(): string {
    return path.join(this.location.agentDir, "models.json");
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<void> {
    const snapshot = await readPiProviders(this.location.agentDir);
    if (!this.enabled || this.disposed) return;
    this.unregisterAll();
    this.found = snapshot.found;
    this.error = snapshot.error;
    this.skipped = [...snapshot.skipped];
    for (const [providerId, config] of snapshot.providers) {
      const key = providerId.slice("pi-".length);
      // A provider Pine already knows under this id wins; Pi's copy is skipped.
      if (this.runtime.getProvider(providerId)) {
        this.skipped.push({ key, reason: "conflict" });
        continue;
      }
      try {
        this.runtime.registerProvider(providerId, config);
        this.registered.add(providerId);
      } catch {
        this.runtime.unregisterProvider(providerId);
        this.skipped.push({ key, reason: "invalid" });
      }
    }
  }

  private unregisterAll(): void {
    for (const providerId of this.registered) {
      this.runtime.unregisterProvider(providerId);
    }
    this.registered.clear();
  }

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.enqueue(() => this.load()).catch(() => undefined);
    }, this.options.debounceMs ?? 300);
  }

  /**
   * Watches the folder rather than the file: CC Switch and Pi replace
   * models.json by renaming a temporary file over it, and the file may not
   * exist yet when the setting is turned on.
   */
  private watchAgentDir(): void {
    const directory = this.location.agentDir;
    if (this.watcher && this.watchedDir === directory) return;
    this.stopWatching();
    if (this.disposed) return;
    this.watchedDir = directory;
    try {
      this.watcher = watch(directory, (_event, filename) => {
        if (!filename || filename.toString() === "models.json") {
          this.scheduleReload();
        }
      });
      this.watcher.on("error", () => this.retryWatch(directory));
    } catch {
      this.retryWatch(directory);
    }
  }

  private retryWatch(directory: string): void {
    this.watcher?.close();
    this.watcher = undefined;
    if (this.retryTimer || this.disposed || !this.enabled) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.enabled || this.watchedDir !== directory) return;
      this.watcher = undefined;
      this.watchedDir = undefined;
      this.watchAgentDir();
      if (this.watcher) this.scheduleReload();
    }, this.options.retryMs ?? 5_000);
  }

  private stopWatching(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.watchedDir = undefined;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
