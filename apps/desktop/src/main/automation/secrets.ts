import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedSecret } from "../../shared/automationRedaction";
import type { TinyFishSafeStorage } from "../tinyfishCredentials";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_VALUE_LENGTH = 16_384;

export interface AutomationSecretRecord {
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface SecretsFile {
  secrets: AutomationSecretRecord[];
  /** Values encrypted with the credential storage, base64. */
  values: Record<string, string>;
}

export type { ResolvedSecret } from "../../shared/automationRedaction";
export {
  MIN_REDACTED_SECRET_LENGTH,
  redactJson,
  redactText,
} from "../../shared/automationRedaction";

/**
 * Secrets the user saves for a project's automations. Only the user sets
 * values; agents refer to secrets by name and never read them.
 */
export class AutomationSecretStore {
  private readonly queue = new Map<string, Promise<unknown>>();

  constructor(
    private readonly fileFor: (projectId: string) => string,
    private readonly storage: TinyFishSafeStorage,
  ) {}

  private async read(projectId: string): Promise<SecretsFile> {
    try {
      const parsed = JSON.parse(
        await readFile(this.fileFor(projectId), "utf8"),
      ) as Partial<SecretsFile>;
      return {
        secrets: Array.isArray(parsed.secrets) ? parsed.secrets : [],
        values:
          parsed.values && typeof parsed.values === "object"
            ? parsed.values
            : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { secrets: [], values: {} };
      throw error;
    }
  }

  private async write(projectId: string, file: SecretsFile): Promise<void> {
    const target = this.fileFor(projectId);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private serialize<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queue.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    this.queue.set(projectId, next);
    return next;
  }

  async list(
    projectId: string,
  ): Promise<(AutomationSecretRecord & { hasValue: boolean })[]> {
    const file = await this.read(projectId);
    return file.secrets.map((secret) => ({
      ...secret,
      hasValue: typeof file.values[secret.name] === "string",
    }));
  }

  set(
    projectId: string,
    name: string,
    description: string | undefined,
    value: string | undefined,
  ): Promise<void> {
    const problem =
      !NAME_PATTERN.test(name) || name.length > 64
        ? "Secret names use lowercase letters, digits and hyphens, at most 64 characters."
        : value !== undefined &&
            (value.length === 0 || value.length > MAX_VALUE_LENGTH)
          ? "A secret value must be 1–16,384 characters."
          : value !== undefined && !this.storage.isEncryptionAvailable()
            ? "The operating system's secure credential store is unavailable."
            : undefined;
    if (problem) return Promise.reject(new Error(problem));
    return this.serialize(projectId, async () => {
      const file = await this.read(projectId);
      const now = new Date().toISOString();
      const existing = file.secrets.find((secret) => secret.name === name);
      const trimmed = description?.trim();
      if (existing) {
        existing.updatedAt = now;
        if (description !== undefined) {
          if (trimmed) existing.description = trimmed.slice(0, 500);
          else delete existing.description;
        }
      } else {
        file.secrets.push({
          name,
          ...(trimmed ? { description: trimmed.slice(0, 500) } : {}),
          createdAt: now,
          updatedAt: now,
        });
      }
      if (value !== undefined)
        file.values[name] = this.storage
          .encryptString(value)
          .toString("base64");
      await this.write(projectId, file);
    });
  }

  delete(projectId: string, name: string): Promise<boolean> {
    return this.serialize(projectId, async () => {
      const file = await this.read(projectId);
      const before = file.secrets.length;
      file.secrets = file.secrets.filter((secret) => secret.name !== name);
      delete file.values[name];
      await this.write(projectId, file);
      return file.secrets.length !== before;
    });
  }

  /** Values for the given names; a missing or unreadable one is omitted. */
  async resolve(
    projectId: string,
    names: readonly string[],
  ): Promise<ResolvedSecret[]> {
    if (names.length === 0) return [];
    const file = await this.read(projectId);
    return names.flatMap((name) => {
      const encoded = file.values[name];
      if (!encoded || !file.secrets.some((secret) => secret.name === name))
        return [];
      try {
        return [
          {
            name,
            value: this.storage.decryptString(Buffer.from(encoded, "base64")),
          },
        ];
      } catch {
        return [];
      }
    });
  }
}

/** Replaces secret values with `[secret:<name>]`. */
