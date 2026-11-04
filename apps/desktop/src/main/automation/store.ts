import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { PineJsonValue } from "../../shared/agent";
import type {
  AutomationEvent,
  AutomationPauseReason,
  AutomationPollRecord,
  AutomationRunReport,
  AutomationRunStatus,
  AutomationSpec,
  AutomationTriggerKind,
} from "../../shared/automation";

export const AUTOMATIONS_DIRECTORY = "automations";
export const AUTOMATION_SECRETS_FILE = "automation-secrets.json";
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_POLL_RECORDS = 200;
export const RUN_RETENTION = { days: 90, count: 200 } as const;

/** A definition as stored: `action.permissions.tools` holds tool IDs. */
export interface StoredAutomation {
  id: string;
  projectId: string;
  revision: number;
  spec: AutomationSpec;
  createdAt: string;
  updatedAt: string;
  pause?: { reason: AutomationPauseReason; at: string };
}

export interface AutomationTriggerState {
  /** Folder: processed files and their `size:mtimeMs` signatures. */
  files?: Record<string, string>;
  scriptCursor?: PineJsonValue | null;
  scriptSeen?: string[];
  scriptFailures?: number;
  lastPollAt?: string;
  /** Schedule: the last occurrence handled; system: the last fire. */
  lastFiredAt?: string;
  lastPeriod?: string;
}

export interface AutomationState {
  triggers: Record<string, AutomationTriggerState>;
  agentCursor: PineJsonValue | null;
  lastRunAt?: string;
  lastSuccessAt?: string;
  consecutiveFailures: number;
  runsByDay?: { day: string; count: number };
  /** The day the user was told the daily run limit was reached. */
  limitNotifiedDay?: string;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  projectId: string;
  revision: number;
  automationName: string;
  status: AutomationRunStatus;
  trigger: AutomationTriggerKind | "batch";
  startedAt: string;
  endedAt?: string;
  events: AutomationEvent[];
  eventCount: number;
  payload: PineJsonValue;
  sessionId?: string;
  sessionFile?: string;
  report?: AutomationRunReport;
  error?: string;
  discardedEvents?: number;
  changedOutputs?: string[];
  read: boolean;
  kept: boolean;
  continued?: boolean;
  usedPrivileged?: boolean;
}

export function emptyState(): AutomationState {
  return {
    triggers: {},
    agentCursor: null,
    consecutiveFailures: 0,
  };
}

export function newAutomationId(): string {
  return randomUUID().slice(0, 18).replaceAll("-", "");
}

/** Sortable by start time; unique within an automation. */
export function newRunId(now = Date.now()): string {
  return `${now.toString(36).padStart(9, "0")}-${randomUUID().slice(0, 8)}`;
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Automations of every project, under `<projectsRoot>/<id>/automations`. */
export class AutomationStore {
  constructor(private readonly projectsRoot: string) {}

  projectRoot(projectId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(projectId) || projectId.startsWith("."))
      throw new Error("Invalid project ID.");
    return path.join(this.projectsRoot, projectId);
  }

  directory(projectId: string, automationId: string): string {
    if (!ID_PATTERN.test(automationId))
      throw new Error("Invalid automation ID.");
    return path.join(
      this.projectRoot(projectId),
      AUTOMATIONS_DIRECTORY,
      automationId,
    );
  }

  /** The run's working directory and its only implicit write grant. */
  workspace(projectId: string, automationId: string): string {
    return path.join(this.directory(projectId, automationId), "workspace");
  }

  secretsFile(projectId: string): string {
    return path.join(this.projectRoot(projectId), AUTOMATION_SECRETS_FILE);
  }

  async listProjectIds(): Promise<string[]> {
    const entries = await readdir(this.projectsRoot, {
      withFileTypes: true,
    }).catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  }

  async list(projectId: string): Promise<StoredAutomation[]> {
    const root = path.join(this.projectRoot(projectId), AUTOMATIONS_DIRECTORY);
    const entries = await readdir(root, { withFileTypes: true }).catch(
      () => [],
    );
    const automations = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
        .map((entry) =>
          this.read(projectId, entry.name).catch(() => undefined),
        ),
    );
    return automations.filter(
      (automation): automation is StoredAutomation => automation !== undefined,
    );
  }

  read(
    projectId: string,
    automationId: string,
  ): Promise<StoredAutomation | undefined> {
    return readJson<StoredAutomation>(
      path.join(this.directory(projectId, automationId), "automation.json"),
    );
  }

  async write(
    automation: StoredAutomation,
    newRevision: boolean,
  ): Promise<void> {
    const directory = this.directory(automation.projectId, automation.id);
    const content = `${JSON.stringify(automation, null, 2)}\n`;
    if (newRevision)
      await writeAtomic(
        path.join(directory, "revisions", `${automation.revision}.json`),
        content,
      );
    await writeAtomic(path.join(directory, "automation.json"), content);
  }

  async readRevision(
    projectId: string,
    automationId: string,
    revision: number,
  ): Promise<StoredAutomation | undefined> {
    return readJson<StoredAutomation>(
      path.join(
        this.directory(projectId, automationId),
        "revisions",
        `${revision}.json`,
      ),
    );
  }

  async delete(projectId: string, automationId: string): Promise<void> {
    // Run sessions live with the project's; the ones the user never wrote in
    // go with the automation.
    for (const run of await this.listRuns(projectId, automationId))
      if (run.sessionFile && !run.continued)
        await rm(run.sessionFile, { force: true });
    await rm(this.directory(projectId, automationId), {
      recursive: true,
      force: true,
    });
  }

  async readState(
    projectId: string,
    automationId: string,
  ): Promise<AutomationState> {
    return (
      (await readJson<AutomationState>(
        path.join(this.directory(projectId, automationId), "state.json"),
      )) ?? emptyState()
    );
  }

  writeState(
    projectId: string,
    automationId: string,
    state: AutomationState,
  ): Promise<void> {
    return writeAtomic(
      path.join(this.directory(projectId, automationId), "state.json"),
      `${JSON.stringify(state)}\n`,
    );
  }

  async appendPoll(
    projectId: string,
    automationId: string,
    record: AutomationPollRecord,
  ): Promise<void> {
    const file = path.join(
      this.directory(projectId, automationId),
      "polls.jsonl",
    );
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    if (lines.length > MAX_POLL_RECORDS * 2)
      await writeAtomic(file, `${lines.slice(-MAX_POLL_RECORDS).join("\n")}\n`);
  }

  async readPolls(
    projectId: string,
    automationId: string,
  ): Promise<AutomationPollRecord[]> {
    const file = path.join(
      this.directory(projectId, automationId),
      "polls.jsonl",
    );
    const text = await readFile(file, "utf8").catch(() => "");
    return text
      .split("\n")
      .filter(Boolean)
      .slice(-MAX_POLL_RECORDS)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AutomationPollRecord];
        } catch {
          return [];
        }
      });
  }

  private runFile(
    projectId: string,
    automationId: string,
    runId: string,
  ): string {
    if (!/^[a-z0-9]+-[a-f0-9]{8}$/.test(runId))
      throw new Error("Invalid run ID.");
    return path.join(
      this.directory(projectId, automationId),
      "runs",
      `${runId}.json`,
    );
  }

  writeRun(run: AutomationRunRecord): Promise<void> {
    return writeAtomic(
      this.runFile(run.projectId, run.automationId, run.id),
      `${JSON.stringify(run)}\n`,
    );
  }

  readRun(
    projectId: string,
    automationId: string,
    runId: string,
  ): Promise<AutomationRunRecord | undefined> {
    return readJson<AutomationRunRecord>(
      this.runFile(projectId, automationId, runId),
    );
  }

  async listRuns(
    projectId: string,
    automationId: string,
  ): Promise<AutomationRunRecord[]> {
    const root = path.join(this.directory(projectId, automationId), "runs");
    const names = await readdir(root).catch(() => [] as string[]);
    const runs = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .sort()
        .reverse()
        .map((name) =>
          readJson<AutomationRunRecord>(path.join(root, name)).catch(
            () => undefined,
          ),
        ),
    );
    return runs.filter((run): run is AutomationRunRecord => run !== undefined);
  }

  /** Drops runs past the retention window with their sessions. */
  async pruneRuns(
    projectId: string,
    automationId: string,
    now = Date.now(),
  ): Promise<void> {
    const runs = await this.listRuns(projectId, automationId);
    const cutoff = now - RUN_RETENTION.days * 86_400_000;
    for (const [index, run] of runs.entries()) {
      // Kept runs stay with their session; a continued one is the user's.
      if (run.status === "running" || run.kept) continue;
      if (index < RUN_RETENTION.count && Date.parse(run.startedAt) >= cutoff)
        continue;
      if (run.sessionFile && !run.continued)
        await rm(run.sessionFile, { force: true });
      await rm(this.runFile(projectId, automationId, run.id), { force: true });
    }
  }
}
