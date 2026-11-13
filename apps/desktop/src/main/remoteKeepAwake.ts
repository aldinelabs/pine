import type { RemoteKeepAwakeStatus } from "../shared/remoteKeepAwake";

/**
 * Whether any remote access is on. Browser access covers Remote Control via
 * Aldine too (paired devices reach Pine through the web server). WeChat counts
 * while it receives tasks, but not while it waits for a new scan here.
 */
export function isRemoteAccessOn(input: {
  browserAccess: boolean;
  wechatListening: boolean;
  wechatNeedsScan: boolean;
}): boolean {
  return (
    input.browserAccess || (input.wechatListening && !input.wechatNeedsScan)
  );
}

export interface RemoteKeepAwakeOptions {
  /** Reads the current remote state; cheap, called only on events. */
  remoteOn(): boolean;
  /** Holds (`true`) or releases (`false`) the system sleep blocker; must be idempotent. */
  block(on: boolean): void;
  /** The status changed. */
  changed(status: RemoteKeepAwakeStatus): void;
}

/**
 * Holds the computer awake while the setting is on and some remote access is
 * on. Event driven: callers `refresh()` when a remote changes; no timers.
 */
export class RemoteKeepAwake {
  private on = false;
  private disposed = false;
  private last: RemoteKeepAwakeStatus | undefined;

  constructor(private readonly options: RemoteKeepAwakeOptions) {}

  get enabled(): boolean {
    return this.on;
  }

  status(): RemoteKeepAwakeStatus {
    return { enabled: this.on, remoteOn: this.options.remoteOn() };
  }

  setEnabled(enabled: boolean): RemoteKeepAwakeStatus {
    this.on = enabled;
    return this.refresh();
  }

  refresh(): RemoteKeepAwakeStatus {
    const status = this.status();
    if (this.disposed) return status;
    this.options.block(status.enabled && status.remoteOn);
    if (
      !this.last ||
      this.last.enabled !== status.enabled ||
      this.last.remoteOn !== status.remoteOn
    ) {
      this.last = status;
      this.options.changed({ ...status });
    }
    return status;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.block(false);
  }
}

/**
 * Reads the stored value; the first time (nothing stored yet) it takes the old
 * WeChat-only switch and writes the result, so this runs once.
 */
export async function migrateRemoteKeepAwake(input: {
  stored: boolean | undefined;
  legacy(): Promise<boolean>;
  write(value: boolean): Promise<void>;
}): Promise<boolean> {
  if (input.stored !== undefined) return input.stored;
  const value = await input.legacy();
  await input.write(value);
  return value;
}

/**
 * The stored setting: starts the one-time migration without blocking startup
 * and orders every later change after it, so an early toggle (tray or
 * Preferences) always wins over the migrated value.
 */
export function createRemoteKeepAwakeSetting(input: {
  migrate(): Promise<boolean>;
  write(value: boolean): Promise<void>;
  apply(value: boolean): RemoteKeepAwakeStatus;
  onError(error: unknown): void;
}): {
  ready: Promise<void>;
  set(enabled: boolean): Promise<RemoteKeepAwakeStatus>;
} {
  let chosen = false;
  const ready = input.migrate().then(
    (value) => {
      if (!chosen) input.apply(value);
    },
    // Left off for this run; the migration is tried again next start.
    (error: unknown) => input.onError(error),
  );
  return {
    ready,
    async set(enabled) {
      chosen = true;
      await ready;
      await input.write(enabled);
      return input.apply(enabled);
    },
  };
}
