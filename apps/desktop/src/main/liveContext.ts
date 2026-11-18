import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  LIVE_CONTEXT_SOURCES,
  type LiveContextError,
  type LiveContextEvent,
  type LiveContextSegment,
  type LiveContextSource,
  type LiveContextStartRequest,
  type LiveContextStatus,
  type LiveContextTarget,
  type LiveContextUnavailableReason,
} from "../shared/liveContext";

/** The helper process, as much of a ChildProcess as the service uses. */
export interface LiveContextHelperProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  kill(): boolean;
}

export interface LiveContextServiceOptions {
  /** Null when Live Context can run here. */
  unavailableReason(): LiveContextUnavailableReason | null;
  spawnHelper(): LiveContextHelperProcess;
  /** The project's folder in Pine's data directory. */
  projectRoot(projectId: string): string;
  emit(event: LiveContextEvent): void;
  now?(): number;
  /** How often a source's volatile text may reach the renderer. */
  volatileIntervalMs?: number;
  /** How long `stop` waits for the helper to flush before killing it. */
  stopTimeoutMs?: number;
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TRANSCRIPT_VERSION = 1;

/**
 * The session's transcript: final segments only, text only (never audio),
 * beside its side chats in the project's data folder and deleted with it.
 */
export function liveTranscriptPath(
  projectRoot: string,
  sessionId: string,
): string {
  if (!SESSION_ID.test(sessionId)) throw new Error("Invalid session id.");
  return path.join(projectRoot, "live-context", `${sessionId}.jsonl`);
}

export async function deleteLiveTranscript(
  projectRoot: string,
  sessionId: string,
): Promise<void> {
  await rm(liveTranscriptPath(projectRoot, sessionId), { force: true });
}

function isSource(value: unknown): value is LiveContextSource {
  return LIVE_CONTEXT_SOURCES.some((source) => source === value);
}

function parseStored(line: string): LiveContextSegment | undefined {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (
      typeof value.id !== "string" ||
      !isSource(value.source) ||
      typeof value.start !== "number" ||
      typeof value.end !== "number" ||
      typeof value.text !== "string"
    )
      return undefined;
    return {
      id: value.id,
      source: value.source,
      start: value.start,
      end: value.end,
      text: value.text,
      final: true,
    };
  } catch {
    return undefined;
  }
}

interface Capture {
  target: LiveContextTarget;
  /** Prefix that keeps segment ids unique across captures of a session. */
  id: string;
  helper: LiveContextHelperProcess;
  exited: Promise<void>;
  file: string;
}

/**
 * Runs the one Live Context capture app-wide: spawns the helper, relays its
 * segments to the renderer, and appends final ones to the session's
 * transcript. Each capture is its own helper process, which exits when
 * stdin closes, so it never outlives Pine.
 */
export class LiveContextService {
  private capture: Capture | undefined;
  private current: LiveContextStatus;
  private writes: Promise<void> = Promise.resolve();
  private readonly pendingVolatile = new Map<
    LiveContextSource,
    LiveContextSegment
  >();
  private volatileTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: LiveContextServiceOptions) {
    this.current = this.idleStatus();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private idleStatus(lastError?: LiveContextError): LiveContextStatus {
    const reason = this.options.unavailableReason();
    return {
      available: reason === null,
      ...(reason ? { unavailableReason: reason } : {}),
      state: "idle",
      sources: [],
      ...(lastError ? { lastError } : {}),
    };
  }

  status(): LiveContextStatus {
    // Availability can change while idle (e.g. the flag in tests).
    if (!this.capture) this.current = this.idleStatus(this.current.lastError);
    return { ...this.current, sources: [...this.current.sources] };
  }

  private update(patch: Partial<LiveContextStatus>): void {
    this.current = { ...this.current, ...patch };
    this.options.emit({ kind: "status", status: this.status() });
  }

  async start(request: LiveContextStartRequest): Promise<LiveContextStatus> {
    const reason = this.options.unavailableReason();
    if (reason) throw new Error(`Live Context is unavailable (${reason}).`);
    if (this.capture) {
      if (
        this.capture.target.sessionId === request.sessionId &&
        this.current.state === "paused"
      )
        return this.resume();
      throw new Error("Live Context is already capturing a conversation.");
    }
    const file = liveTranscriptPath(
      this.options.projectRoot(request.projectId),
      request.sessionId,
    );
    await mkdir(path.dirname(file), { recursive: true });

    const helper = this.options.spawnHelper();
    const exited = new Promise<void>((resolve) => {
      helper.once("exit", (code) => {
        this.helperExited(helper, code);
        resolve();
      });
    });
    const capture: Capture = {
      target: { projectId: request.projectId, sessionId: request.sessionId },
      id: this.now().toString(36),
      helper,
      exited,
      file,
    };
    this.capture = capture;
    createInterface({ input: helper.stdout }).on("line", (line) =>
      this.handleLine(capture, line),
    );
    // Diagnostics only; keep the pipe drained.
    helper.stderr.on("data", () => undefined);
    helper.stdin.on("error", () => undefined);

    this.current = {
      available: true,
      state: "preparing",
      projectId: request.projectId,
      sessionId: request.sessionId,
      sources: [...new Set(request.sources)],
      locale: request.locale,
    };
    this.options.emit({ kind: "status", status: this.status() });
    this.send({
      type: "start",
      sources: this.current.sources,
      locale: request.locale,
    });
    return this.status();
  }

  pause(): Promise<LiveContextStatus> {
    if (this.current.state === "listening") this.send({ type: "pause" });
    return Promise.resolve(this.status());
  }

  resume(): Promise<LiveContextStatus> {
    if (this.current.state === "paused") this.send({ type: "resume" });
    return Promise.resolve(this.status());
  }

  /** Stops and waits for the helper to flush its last segments. */
  async stop(): Promise<LiveContextStatus> {
    const capture = this.capture;
    if (!capture) return this.status();
    this.update({ state: "stopping" });
    this.send({ type: "stop" });
    capture.helper.stdin.end();
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), this.options.stopTimeoutMs ?? 5000),
    );
    if ((await Promise.race([capture.exited, timeout])) === "timeout")
      capture.helper.kill();
    await capture.exited;
    await this.writes;
    return this.status();
  }

  async transcript(target: LiveContextTarget): Promise<LiveContextSegment[]> {
    await this.writes;
    let text: string;
    try {
      text = await readFile(
        liveTranscriptPath(
          this.options.projectRoot(target.projectId),
          target.sessionId,
        ),
        "utf8",
      );
    } catch {
      return [];
    }
    return text
      .split("\n")
      .filter(Boolean)
      .map(parseStored)
      .filter((segment) => segment !== undefined);
  }

  /** Quitting: no flush, the helper must not outlive Pine. */
  dispose(): void {
    const capture = this.capture;
    if (!capture) return;
    capture.helper.stdin.end();
    capture.helper.kill();
  }

  private send(command: Record<string, unknown>): void {
    const helper = this.capture?.helper;
    if (!helper || helper.stdin.writableEnded) return;
    helper.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private helperExited(
    helper: LiveContextHelperProcess,
    code: number | null,
  ): void {
    if (this.capture?.helper !== helper) return;
    this.flushVolatile();
    const unexpected = this.current.state !== "stopping" && code !== 0;
    this.capture = undefined;
    this.current = this.idleStatus(
      unexpected
        ? {
            code: "helper_exited",
            message: `The transcription helper stopped (${code ?? "signal"}).`,
          }
        : this.current.lastError,
    );
    this.options.emit({ kind: "status", status: this.status() });
  }

  private handleLine(capture: Capture, line: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (this.capture !== capture) return;
    switch (event.type) {
      case "status":
        this.handleStatus(event);
        return;
      case "error":
        this.update({
          lastError: {
            code: typeof event.code === "string" ? event.code : "error",
            message: typeof event.message === "string" ? event.message : "",
            ...(isSource(event.source) ? { source: event.source } : {}),
          },
        });
        return;
      case "segment":
        this.handleSegment(capture, event);
        return;
      default:
        return;
    }
  }

  private handleStatus(event: Record<string, unknown>): void {
    switch (event.state) {
      case "preparing":
        this.update({ state: "preparing" });
        return;
      case "downloading":
        this.update({
          state: "downloading",
          downloadProgress:
            typeof event.progress === "number" ? event.progress : 0,
        });
        return;
      case "listening": {
        const sources = Array.isArray(event.sources)
          ? event.sources.filter(isSource)
          : this.current.sources;
        this.update({
          state: "listening",
          downloadProgress: undefined,
          sources,
          ...(typeof event.startedAt === "number"
            ? { startedAt: event.startedAt }
            : {}),
          ...(typeof event.locale === "string" ? { locale: event.locale } : {}),
        });
        return;
      }
      case "paused":
        this.flushVolatile();
        this.update({ state: "paused" });
        return;
      case "silent":
        this.update({ systemSilent: true });
        return;
      default:
        // "stopped" is followed by the helper's exit.
        return;
    }
  }

  private handleSegment(
    capture: Capture,
    event: Record<string, unknown>,
  ): void {
    const startedAt = this.current.startedAt;
    if (
      startedAt === undefined ||
      typeof event.id !== "string" ||
      !isSource(event.source) ||
      typeof event.text !== "string"
    )
      return;
    const t0 = typeof event.t0 === "number" ? event.t0 : 0;
    const t1 = typeof event.t1 === "number" ? event.t1 : t0;
    const segment: LiveContextSegment = {
      id: `${capture.id}-${event.id}`,
      source: event.source,
      start: startedAt + t0,
      end: startedAt + t1,
      text: event.text,
      final: event.final === true,
    };
    if (
      segment.source === "system" &&
      segment.text &&
      this.current.systemSilent
    )
      this.update({ systemSilent: false });
    const sessionId = capture.target.sessionId;
    if (!segment.final) {
      this.pendingVolatile.set(segment.source, segment);
      this.volatileTimer ??= setTimeout(
        () => this.flushVolatile(),
        this.options.volatileIntervalMs ?? 150,
      );
      return;
    }
    if (this.pendingVolatile.get(segment.source)?.id === segment.id)
      this.pendingVolatile.delete(segment.source);
    this.options.emit({ kind: "segment", sessionId, segment });
    if (!segment.text) return;
    const record = {
      v: TRANSCRIPT_VERSION,
      id: segment.id,
      source: segment.source,
      start: segment.start,
      end: segment.end,
      text: segment.text,
    };
    this.writes = this.writes
      .then(() => appendFile(capture.file, `${JSON.stringify(record)}\n`))
      .catch((error: unknown) =>
        console.error("Failed to save a Live Context segment.", error),
      );
  }

  private flushVolatile(): void {
    if (this.volatileTimer) clearTimeout(this.volatileTimer);
    this.volatileTimer = undefined;
    const sessionId = this.capture?.target.sessionId;
    if (sessionId)
      for (const segment of this.pendingVolatile.values())
        this.options.emit({ kind: "segment", sessionId, segment });
    this.pendingVolatile.clear();
  }
}
