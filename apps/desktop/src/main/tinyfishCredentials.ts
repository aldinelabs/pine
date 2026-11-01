import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface TinyFishSafeStorage {
  decryptString(encrypted: Buffer): string;
  encryptString(plainText: string): Buffer;
  isEncryptionAvailable(): boolean;
}

const MAX_API_KEY_LENGTH = 4_096;

/**
 * Stores the TinyFish credential encrypted with the given storage: the
 * operating system's credential store on the desktop. The plaintext key is kept only in this main-process
 * object and is passed to the agent worker when a session is created.
 */
export class TinyFishCredentialStore {
  private apiKey: string | undefined;

  constructor(
    private readonly filePath: string,
    private readonly storage: TinyFishSafeStorage,
  ) {}

  async load(): Promise<void> {
    this.apiKey = undefined;
    try {
      if (!this.storage.isEncryptionAvailable()) return;
      const encoded = (await readFile(this.filePath, "utf8")).trim();
      if (!encoded) return;
      const decrypted = this.storage.decryptString(
        Buffer.from(encoded, "base64"),
      );
      const normalized = decrypted.trim();
      if (normalized.length > 0 && normalized.length <= MAX_API_KEY_LENGTH) {
        this.apiKey = normalized;
      }
    } catch {
      // A missing or unreadable credential must not prevent Pine from opening.
      // The user can replace it from Preferences.
    }
  }

  getApiKey(): string | undefined {
    return this.apiKey;
  }

  isConfigured(): boolean {
    return this.apiKey !== undefined;
  }

  async setApiKey(apiKey: string): Promise<void> {
    const normalized = apiKey.trim();
    if (!normalized || normalized.length > MAX_API_KEY_LENGTH) {
      throw new Error(
        "TinyFish API key must be between 1 and 4096 characters.",
      );
    }
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error(
        "The operating system secure credential store is unavailable. TinyFish cannot be configured safely on this system.",
      );
    }

    const encoded = this.storage.encryptString(normalized).toString("base64");
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, encoded, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
    this.apiKey = normalized;
  }
}
