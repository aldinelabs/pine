import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

type DiagnosticDetails = Record<string, string | number | boolean>;

const MAX_LOG_BYTES = 1_048_576;
const PENDING_REQUEST_MS = 15_000;

/** Local diagnostics only: never record IPC arguments or successful results. */
export class RuntimeDiagnostics {
  readonly logPath: string;
  private writes: Promise<void> = Promise.resolve();
  private nextRequestId = 0;

  constructor(logDirectory: string) {
    this.logPath = path.join(logDirectory, "runtime-diagnostics.jsonl");
  }

  record(event: string, details: DiagnosticDetails = {}): void {
    const line = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...details,
    })}\n`;
    this.writes = this.writes
      .then(async () => {
        await mkdir(path.dirname(this.logPath), { recursive: true });
        const size = await stat(this.logPath).then(
          (info) => info.size,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return 0;
            throw error;
          },
        );
        if (size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
          await rename(this.logPath, `${this.logPath}.1`);
        }
        await appendFile(this.logPath, line, { mode: 0o600 });
      })
      .catch((error: unknown) => {
        console.error("[Pine diagnostics] Failed to write local log.", error);
      });
  }

  async trace<T>(
    channel: string,
    senderId: number,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    const details = { channel, senderId, requestId: ++this.nextRequestId };
    const elapsedMs = () => Math.round(performance.now() - startedAt);
    this.record("ipc:start", details);
    // This is observational: long dialogs and operations remain valid.
    const timer = setTimeout(() => {
      this.record("ipc:pending", { ...details, elapsedMs: elapsedMs() });
    }, PENDING_REQUEST_MS);
    try {
      const result = await operation();
      this.record("ipc:complete", { ...details, elapsedMs: elapsedMs() });
      return result;
    } catch (error) {
      this.record("ipc:error", {
        ...details,
        elapsedMs: elapsedMs(),
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          4_096,
        ),
        ...(error instanceof Error && error.stack
          ? { stack: error.stack.slice(0, 8_192) }
          : {}),
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  flush(): Promise<void> {
    return this.writes;
  }
}
