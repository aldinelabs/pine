import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MAX_PREFERENCE_KEY_LENGTH,
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

  set(key: unknown, value: unknown): void {
    if (
      !PreferenceStore.validKey(key) ||
      typeof value !== "string" ||
      value.length > MAX_PREFERENCE_VALUE_LENGTH
    ) {
      return;
    }
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.persist();
  }

  remove(key: unknown): void {
    if (!PreferenceStore.validKey(key) || !(key in this.values)) return;
    delete this.values[key];
    this.persist();
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
