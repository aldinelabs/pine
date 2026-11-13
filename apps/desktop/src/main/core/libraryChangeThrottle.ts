/** How long further notices for one key collapse into a single trailing one. */
export const LIBRARY_CHANGE_THROTTLE_MS = 500;

interface ThrottleWindow {
  timer: ReturnType<typeof setTimeout>;
  pending: boolean;
}

/**
 * Throttles a notice per key: the first call goes out at once, further calls
 * within the window collapse into one trailing call when it closes. A
 * session that appends an entry per streamed message would otherwise make
 * every other interface reload its session lists per entry.
 */
export class LibraryChangeThrottle<Key> {
  private readonly windows = new Map<Key, ThrottleWindow>();

  constructor(
    private readonly send: (key: Key) => void,
    private readonly intervalMs = LIBRARY_CHANGE_THROTTLE_MS,
  ) {}

  /** Sends now, or once at the end of the open window for this key. */
  notify(key: Key): void {
    const open = this.windows.get(key);
    if (open) {
      open.pending = true;
      return;
    }
    this.send(key);
    this.openWindow(key);
  }

  /**
   * Sends a pending notice for this key now and closes its window. Returns
   * whether a notice was sent.
   */
  flush(key: Key): boolean {
    const open = this.windows.get(key);
    if (!open) return false;
    clearTimeout(open.timer);
    this.windows.delete(key);
    if (!open.pending) return false;
    this.send(key);
    return true;
  }

  /** Cancels every timer without sending what is pending. */
  dispose(): void {
    for (const open of this.windows.values()) clearTimeout(open.timer);
    this.windows.clear();
  }

  private openWindow(key: Key): void {
    const open: ThrottleWindow = {
      pending: false,
      timer: setTimeout(() => {
        this.windows.delete(key);
        if (!open.pending) return;
        this.send(key);
        this.openWindow(key);
      }, this.intervalMs),
    };
    this.windows.set(key, open);
  }
}
