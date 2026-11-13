import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  LIVE_PREFERENCE_KEYS,
  MAX_PREFERENCE_KEY_LENGTH,
  PREFERENCES_CHANGED_CHANNEL,
  MAX_PREFERENCE_VALUE_LENGTH,
  PREFERENCE_KEY_PREFIX,
} from "../shared/preferenceStorage";

/**
 * The renderer's small UI preferences (theme, layout, favourites) as one JSON
 * file in userData. Reads are synchronous because renderer stores read them
 * while they are created; writes are small and replace the file atomically,
 * so nothing is lost if Pine quits right after a change.
 */
export class PreferenceStore {
  private values: Record<string, string>;

  constructor(private readonly filePath: string) {
    this.values = PreferenceStore.load(filePath);
  }

  private static load(filePath: string): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
      if (typeof parsed !== "object" || parsed === null) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] =>
            PreferenceStore.validKey(entry[0]) && typeof entry[1] === "string",
        ),
      );
    } catch {
      // A missing or damaged file starts from empty preferences.
      return {};
    }
  }

  private static validKey(key: unknown): key is string {
    return (
      typeof key === "string" &&
      key.startsWith(PREFERENCE_KEY_PREFIX) &&
      key.length <= MAX_PREFERENCE_KEY_LENGTH
    );
  }

  snapshot(): Record<string, string> {
    return { ...this.values };
  }

  /** Returns true when the stored value changed. */
  set(key: unknown, value: unknown): boolean {
    if (
      !PreferenceStore.validKey(key) ||
      typeof value !== "string" ||
      value.length > MAX_PREFERENCE_VALUE_LENGTH
    ) {
      return false;
    }
    if (this.values[key] === value) return false;
    this.values[key] = value;
    this.persist();
    return true;
  }

  /** Returns true when something was removed. */
  remove(key: unknown): boolean {
    if (!PreferenceStore.validKey(key) || !(key in this.values)) return false;
    delete this.values[key];
    this.persist();
    return true;
  }

  private persist(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(this.values)}\n`);
      renameSync(temporary, this.filePath);
    } catch {
      // Keep the in-memory values; the next change retries the write.
    }
  }
}

/** The part of a window's webContents a change notice needs. */
export interface PreferenceChangeTarget {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

/**
 * Tells every other window that a preference changed, so settings such as
 * the working glow apply everywhere at once. The window that made the
 * change already has it. Only keys in LIVE_PREFERENCE_KEYS are sent.
 */
export function notifyPreferenceChange(
  targets: readonly PreferenceChangeTarget[],
  senderId: number,
  key: string,
  value: string | null,
): void {
  if (!LIVE_PREFERENCE_KEYS.has(key)) return;
  for (const target of targets) {
    if (target.id === senderId || target.isDestroyed()) continue;
    try {
      target.send(PREFERENCES_CHANGED_CHANNEL, key, value);
    } catch {
      // A window closing right now misses nothing it still needs.
    }
  }
}
