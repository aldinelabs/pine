import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  LIVE_CONTEXT_SOURCES,
  type LiveContextError,
  type LiveContextEvent,
  type LiveContextMergeSpeakersRequest,
  type LiveContextRenameSpeakerRequest,
  type LiveContextSegment,
  type LiveContextSource,
  type LiveContextSpeakers,
  type LiveContextStartRequest,
  type LiveContextStatus,
  type LiveContextTarget,
  type LiveContextTranscript,
  type LiveContextTurn,
  type LiveContextUnavailableReason,
} from "../shared/liveContext";
import {
  emptySpeakers,
  isSpeakerKey,
  mergeSpeakers,
  parseSpeakerKey,
  parseTurns,
  renameSpeaker,
  resolveSpeaker,
} from "../shared/liveContextSpeakers";
import type { SpeakerModelPaths } from "./liveContextSpeakerModels";

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
  /** Speaker labels; without it they are unavailable. */
  speakers?: {
    /** The library ships with this build. */
    available(): boolean;
    /** The models' paths, downloading them first if needed. */
    models(onProgress: (fraction: number) => void): Promise<SpeakerModelPaths>;
  };
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

/**
 * The session's voice prints, one per speaker and source (a vector of
 * numbers derived from speech, never audio), so a later capture of the
 * session keeps the same speaker numbers. Deleted with the session.
 */
export function liveVoicesPath(projectRoot: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error("Invalid session id.");
  return path.join(projectRoot, "live-context", `${sessionId}.voices.json`);
}

export async function deleteLiveTranscript(
  projectRoot: string,
  sessionId: string,
): Promise<void> {
  await rm(liveTranscriptPath(projectRoot, sessionId), { force: true });
  await rm(liveVoicesPath(projectRoot, sessionId), { force: true });
}

function isSource(value: unknown): value is LiveContextSource {
  return LIVE_CONTEXT_SOURCES.some((source) => source === value);
}

/** Stored turns already carry speaker keys. */
function parseStoredTurns(value: unknown): LiveContextTurn[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const turns = (value as unknown[]).filter(
    (turn): turn is LiveContextTurn =>
      typeof turn === "object" &&
      turn !== null &&
      Number.isInteger((turn as LiveContextTurn).offset) &&
      (turn as LiveContextTurn).offset >= 0 &&
      isSpeakerKey((turn as LiveContextTurn).speaker),
  );
  return turns.length ? turns : undefined;
}

/**
 * Reads the transcript's records in order. Lines without a `type` are
 * final segments; later records relabel segments (`turns`), name speakers
 * (`speaker-name`) or merge them (`speaker-merge`). History is never
 * rewritten, only appended to.
 */
export function readTranscript(text: string): LiveContextTranscript {
  const segments: LiveContextSegment[] = [];
  const byId = new Map<string, LiveContextSegment>();
  let speakers = emptySpeakers();
  for (const line of text.split("\n")) {
    if (!line) continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    switch (value.type) {
      case undefined: {
        if (
          typeof value.id !== "string" ||
          !isSource(value.source) ||
          typeof value.start !== "number" ||
          typeof value.end !== "number" ||
          typeof value.text !== "string"
        )
          continue;
        const turns = parseStoredTurns(value.turns);
        const segment: LiveContextSegment = {
          id: value.id,
          source: value.source,
          start: value.start,
          end: value.end,
          text: value.text,
          final: true,
          ...(turns ? { turns } : {}),
        };
        segments.push(segment);
        byId.set(segment.id, segment);
        continue;
      }
      case "turns": {
        const segment =
          typeof value.id === "string" ? byId.get(value.id) : undefined;
        const turns = parseStoredTurns(value.turns);
        if (segment && turns) segment.turns = turns;
        continue;
      }
      case "speaker-name":
        if (isSpeakerKey(value.speaker) && typeof value.name === "string")
          speakers = renameSpeaker(speakers, value.speaker, value.name);
        continue;
      case "speaker-merge":
        if (isSpeakerKey(value.from) && isSpeakerKey(value.into))
          speakers = mergeSpeakers(speakers, value.from, value.into);
        continue;
      default:
        continue;
    }
  }
  return { segments, speakers };
}

interface StoredVoice {
  speaker: number;
  centroid: number[];
  count: number;
}
type StoredVoices = Partial<Record<LiveContextSource, StoredVoice[]>>;

function parseVoices(value: unknown): StoredVoice[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (voice): voice is StoredVoice =>
      typeof voice === "object" &&
      voice !== null &&
      Number.isInteger((voice as StoredVoice).speaker) &&
      Array.isArray((voice as StoredVoice).centroid) &&
      (voice as StoredVoice).centroid.every((x) => typeof x === "number") &&
      Number.isInteger((voice as StoredVoice).count),
  );
}

/**
 * Voice prints for the next capture, with the user's merges within a
 * source applied, so merged speakers come back as one.
 */
export function voicesForCapture(
  stored: StoredVoices,
  merges: LiveContextSpeakers["merges"],
): StoredVoices {
  const result: StoredVoices = {};
  for (const source of LIVE_CONTEXT_SOURCES) {
    const byKey = new Map<number, StoredVoice>();
    for (const voice of stored[source] ?? []) {
      const target = parseSpeakerKey(
        resolveSpeaker(`${source}-${voice.speaker}`, merges),
      );
      // Merged into the other source: the helper cannot use it there.
      const speaker = target.source === source ? target.speaker : voice.speaker;
      const existing = byKey.get(speaker);
      if (!existing) {
        byKey.set(speaker, { ...voice, speaker });
        continue;
      }
      const total = existing.count + voice.count;
      const sum = existing.centroid.map(
        (x, i) => x * existing.count + (voice.centroid[i] ?? 0) * voice.count,
      );
      const norm = Math.hypot(...sum) || 1;
      byKey.set(speaker, {
        speaker,
        centroid: sum.map((x) => x / norm),
        count: total,
      });
    }
    if (byKey.size) result[source] = [...byKey.values()];
  }
  return result;
}

interface Capture {
  target: LiveContextTarget;
  /** Prefix that keeps segment ids unique across captures of a session. */
  id: string;
  helper: LiveContextHelperProcess;
  exited: Promise<void>;
  file: string;
  voicesFile: string;
  /** Final segments written to the transcript (full ids). */
  saved: Set<string>;
  /** Labels for segments not final yet (full ids). */
  pendingTurns: Map<string, LiveContextTurn[]>;
}

/**
 * Runs the one Live Context capture app-wide: spawns the helper, relays its
 * segments to the renderer, and appends final ones to the session's
 * transcript. Each capture is its own helper process, which exits when
 * stdin closes, so it never outlives Pine.
 */
export class LiveContextService {
  private capture: Capture | undefined;
  /** Set while speaker models download before the helper starts. */
  private starting: { target: LiveContextTarget } | undefined;
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

  private speakersAvailable(): boolean {
    return this.options.speakers?.available() ?? false;
  }

  private idleStatus(lastError?: LiveContextError): LiveContextStatus {
    const reason = this.options.unavailableReason();
    return {
      available: reason === null,
      ...(reason ? { unavailableReason: reason } : {}),
      state: "idle",
      sources: [],
      speakersAvailable: this.speakersAvailable(),
      ...(lastError ? { lastError } : {}),
    };
  }

  status(): LiveContextStatus {
    // Availability can change while idle (e.g. the flag in tests).
    if (!this.capture && !this.starting)
      this.current = this.idleStatus(this.current.lastError);
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
    if (this.starting)
      throw new Error("Live Context is already capturing a conversation.");
    const target = {
      projectId: request.projectId,
      sessionId: request.sessionId,
    };
    const projectRoot = this.options.projectRoot(request.projectId);
    const file = liveTranscriptPath(projectRoot, request.sessionId);
    const voicesFile = liveVoicesPath(projectRoot, request.sessionId);
    await mkdir(path.dirname(file), { recursive: true });
    const sources = [...new Set(request.sources)];
    this.current = {
      available: true,
      state: "preparing",
      ...target,
      sources,
      locale: request.locale,
      speakersAvailable: this.speakersAvailable(),
    };

    // Speaker labels are a bonus: if their models cannot be had, the
    // capture runs without them and says why.
    let speakers: Record<string, unknown> | undefined;
    if (request.speakers && this.options.speakers && this.speakersAvailable()) {
      const token = { target };
      this.starting = token;
      this.options.emit({ kind: "status", status: this.status() });
      try {
        const models = await this.options.speakers.models((fraction) => {
          // Whole percents, so a download is about a hundred updates.
          const progress = Math.floor(fraction * 100) / 100;
          if (
            this.starting === token &&
            (this.current.state !== "downloading" ||
              this.current.downloadProgress !== progress)
          )
            this.update({
              state: "downloading",
              download: "speakers",
              downloadProgress: progress,
            });
        });
        const stored = await this.readVoices(voicesFile);
        const { speakers: names } = await this.readTranscriptFile(file);
        speakers = {
          segmentation: models.segmentation,
          embedding: models.embedding,
          voices: voicesForCapture(stored, names.merges),
        };
      } catch (error) {
        this.current.lastError = {
          code: "speaker_models_failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      // Stopped while downloading.
      if (this.starting !== token) return this.status();
      this.starting = undefined;
      this.current = {
        ...this.current,
        state: "preparing",
        download: undefined,
        downloadProgress: undefined,
      };
    }

    const helper = this.options.spawnHelper();
    const exited = new Promise<void>((resolve) => {
      helper.once("exit", (code) => {
        this.helperExited(helper, code);
        resolve();
      });
    });
    const capture: Capture = {
      target,
      id: this.now().toString(36),
      helper,
      exited,
      file,
      voicesFile,
      saved: new Set(),
      pendingTurns: new Map(),
    };
    this.capture = capture;
    createInterface({ input: helper.stdout }).on("line", (line) =>
      this.handleLine(capture, line),
    );
    // Diagnostics only; keep the pipe drained.
    helper.stderr.on("data", () => undefined);
    helper.stdin.on("error", () => undefined);

    this.options.emit({ kind: "status", status: this.status() });
    this.send({
      type: "start",
      sources,
      locale: request.locale,
      ...(speakers ? { speakers } : {}),
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
    if (!this.capture && this.starting) {
      this.starting = undefined;
      this.current = this.idleStatus(this.current.lastError);
      this.options.emit({ kind: "status", status: this.status() });
      return this.status();
    }
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

  async transcript(target: LiveContextTarget): Promise<LiveContextTranscript> {
    await this.writes;
    return this.readTranscriptFile(
      liveTranscriptPath(
        this.options.projectRoot(target.projectId),
        target.sessionId,
      ),
    );
  }

  private async readTranscriptFile(
    file: string,
  ): Promise<LiveContextTranscript> {
    try {
      return readTranscript(await readFile(file, "utf8"));
    } catch {
      return { segments: [], speakers: emptySpeakers() };
    }
  }

  async renameSpeaker(
    request: LiveContextRenameSpeakerRequest,
  ): Promise<LiveContextSpeakers> {
    return this.changeSpeakers(
      request,
      { type: "speaker-name", speaker: request.speaker, name: request.name },
      (speakers) => renameSpeaker(speakers, request.speaker, request.name),
    );
  }

  async mergeSpeakers(
    request: LiveContextMergeSpeakersRequest,
  ): Promise<LiveContextSpeakers> {
    return this.changeSpeakers(
      request,
      { type: "speaker-merge", from: request.from, into: request.into },
      (speakers) => mergeSpeakers(speakers, request.from, request.into),
    );
  }

  /** Appends the change to the transcript and tells every window. */
  private async changeSpeakers(
    target: LiveContextTarget,
    record: Record<string, unknown>,
    apply: (speakers: LiveContextSpeakers) => LiveContextSpeakers,
  ): Promise<LiveContextSpeakers> {
    const file = liveTranscriptPath(
      this.options.projectRoot(target.projectId),
      target.sessionId,
    );
    let result: LiveContextSpeakers = emptySpeakers();
    const change = this.writes.then(async () => {
      const { speakers } = await this.readTranscriptFile(file);
      result = apply(speakers);
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(
        file,
        `${JSON.stringify({ v: TRANSCRIPT_VERSION, ...record })}\n`,
      );
    });
    this.writes = change.catch(() => undefined);
    await change;
    this.options.emit({
      kind: "speakers",
      sessionId: target.sessionId,
      speakers: result,
    });
    return result;
  }

  private async readVoices(file: string): Promise<StoredVoices> {
    try {
      const value = JSON.parse(await readFile(file, "utf8")) as {
        voices?: Record<string, unknown>;
      };
      const voices: StoredVoices = {};
      for (const source of LIVE_CONTEXT_SOURCES) {
        const list = parseVoices(value.voices?.[source]);
        if (list.length) voices[source] = list;
      }
      return voices;
    } catch {
      return {};
    }
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
      case "speaker":
        this.handleSpeaker(capture, event);
        return;
      case "voices":
        this.handleVoices(capture, event);
        return;
      default:
        return;
    }
  }

  /** New labels for a segment; saved once the segment is final. */
  private handleSpeaker(
    capture: Capture,
    event: Record<string, unknown>,
  ): void {
    if (typeof event.id !== "string" || !isSource(event.source)) return;
    const turns =
      parseTurns(event.source, event.turns) ??
      parseTurns(event.source, [{ offset: 0, speaker: event.speaker }]);
    if (!turns) return;
    const segmentId = `${capture.id}-${event.id}`;
    this.options.emit({
      kind: "turns",
      sessionId: capture.target.sessionId,
      segmentId,
      turns,
    });
    if (!capture.saved.has(segmentId)) {
      capture.pendingTurns.set(segmentId, turns);
      return;
    }
    this.append(capture, { type: "turns", id: segmentId, turns });
  }

  /** The helper's voice prints at the end of a capture, kept per source. */
  private handleVoices(capture: Capture, event: Record<string, unknown>): void {
    if (!isSource(event.source)) return;
    const source = event.source;
    const voices = parseVoices(event.voices);
    this.writes = this.writes
      .then(async () => {
        const stored = await this.readVoices(capture.voicesFile);
        stored[source] = voices;
        await writeFile(
          capture.voicesFile,
          `${JSON.stringify({ v: TRANSCRIPT_VERSION, voices: stored })}\n`,
        );
      })
      .catch((error: unknown) =>
        console.error("Failed to save Live Context voices.", error),
      );
  }

  private append(capture: Capture, record: Record<string, unknown>): void {
    this.writes = this.writes
      .then(() =>
        appendFile(
          capture.file,
          `${JSON.stringify({ v: TRANSCRIPT_VERSION, ...record })}\n`,
        ),
      )
      .catch((error: unknown) =>
        console.error("Failed to save Live Context transcript.", error),
      );
  }

  private handleStatus(event: Record<string, unknown>): void {
    switch (event.state) {
      case "preparing":
        this.update({ state: "preparing" });
        return;
      case "downloading":
        this.update({
          state: "downloading",
          download: "speech",
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
          download: undefined,
          speakers: event.speakers === true,
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
    const turns = capture.pendingTurns.get(segment.id);
    capture.pendingTurns.delete(segment.id);
    if (turns) segment.turns = turns;
    this.options.emit({ kind: "segment", sessionId, segment });
    if (!segment.text) return;
    capture.saved.add(segment.id);
    this.append(capture, {
      id: segment.id,
      source: segment.source,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      ...(turns ? { turns } : {}),
    });
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
