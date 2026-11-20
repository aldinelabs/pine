import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  LIVE_CONTEXT_SOURCES,
  type LiveContextError,
  type LiveContextEvent,
  type LiveContextLevels,
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
  aliasSpeaker,
  emptySpeakers,
  isSpeakerKey,
  mergeSpeakers,
  parseTurns,
  renameSpeaker,
} from "../shared/liveContextSpeakers";
import type {
  LiveContextAgentSource,
  LiveContextCaptureSettings,
} from "../shared/liveContextAgent";
import {
  SpeakerSession,
  type SourcedLabel,
  type SpeakerRecord,
} from "./liveContextDiarizer";
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
    /** The library and the models ship with this build. */
    available(): boolean;
    /** The bundled models' paths. */
    models(): SpeakerModelPaths;
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
 * What the session's speaker labels were made from: analysis windows,
 * voice embeddings (192 numbers derived from speech, never audio, about
 * 1 MB an hour) and the final pass's result, so a later capture keeps the
 * same speakers and the labels can be recomputed. Deleted with the session.
 */
export function liveSpeakersPath(
  projectRoot: string,
  sessionId: string,
): string {
  if (!SESSION_ID.test(sessionId)) throw new Error("Invalid session id.");
  return path.join(projectRoot, "live-context", `${sessionId}.speakers.jsonl`);
}

export async function deleteLiveTranscript(
  projectRoot: string,
  sessionId: string,
): Promise<void> {
  await rm(liveTranscriptPath(projectRoot, sessionId), { force: true });
  await rm(liveSpeakersPath(projectRoot, sessionId), { force: true });
}

function isSource(value: unknown): value is LiveContextSource {
  return LIVE_CONTEXT_SOURCES.some((source) => source === value);
}

/**
 * Reads the transcript's records in order. Lines without a `type` are
 * final segments; later records relabel segments (`turns`), name speakers
 * (`speaker-name`), merge them (`speaker-merge`, the user's) or alias them
 * (`speaker-alias`, Pine's: one voice found under two numbers). History is
 * never rewritten, only appended to.
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
        const turns = parseTurns(value.turns);
        const segment: LiveContextSegment = {
          id: value.id,
          source: value.source,
          start: value.start,
          end: value.end,
          text: value.text,
          final: true,
          ...(turns ? { turns } : {}),
          ...(value.echo === true ? { echo: true } : {}),
        };
        segments.push(segment);
        byId.set(segment.id, segment);
        continue;
      }
      case "turns": {
        const segment =
          typeof value.id === "string" ? byId.get(value.id) : undefined;
        const turns = parseTurns(value.turns);
        if (segment && turns) {
          segment.turns = turns;
          if (value.echo === true) segment.echo = true;
          else delete segment.echo;
        }
        continue;
      }
      case "speaker-alias":
        if (isSpeakerKey(value.from) && isSpeakerKey(value.into))
          speakers = aliasSpeaker(speakers, value.from, value.into);
        continue;
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

/** The speaker file's records, oldest first; damaged lines are skipped. */
export function readSpeakerRecords(text: string): SpeakerRecord[] {
  const records: SpeakerRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (typeof value.type === "string") records.push(value as SpeakerRecord);
    } catch {
      continue;
    }
  }
  return records;
}

interface PendingLabel {
  turns: LiveContextTurn[];
  echo?: boolean;
}

interface Capture {
  target: LiveContextTarget;
  /** Prefix that keeps segment ids unique across captures of a session. */
  id: string;
  helper: LiveContextHelperProcess;
  exited: Promise<void>;
  file: string;
  /** Final segments written to the transcript (full ids). */
  saved: Set<string>;
  /** Labels for segments not final yet (full ids). */
  pendingTurns: Map<string, PendingLabel>;
  /** Speaker clustering, when this capture labels speakers. */
  speakers?: SpeakerSession;
  speakersFile: string;
}

/**
 * Runs the one Live Context capture app-wide: spawns the helper, relays its
 * segments to the renderer, and appends final ones to the session's
 * transcript. Each capture is its own helper process, which exits when
 * stdin closes, so it never outlives Pine.
 */
export class LiveContextService {
  private capture: Capture | undefined;
  /** Set while speaker labels get ready before the helper starts. */
  private starting: { target: LiveContextTarget } | undefined;
  private current: LiveContextStatus;
  private writes: Promise<void> = Promise.resolve();
  private readonly pendingVolatile = new Map<
    LiveContextSource,
    LiveContextSegment
  >();
  private volatileTimer: ReturnType<typeof setTimeout> | undefined;
  /** The last capture's settings, which an agent-started one defaults to. */
  private lastSettings: Partial<LiveContextCaptureSettings> = {};

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

  /** What the last capture in this run of Pine listened with, if any. */
  lastCaptureSettings(): Partial<LiveContextCaptureSettings> {
    return { ...this.lastSettings };
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
    const speakersFile = liveSpeakersPath(projectRoot, request.sessionId);
    await mkdir(path.dirname(file), { recursive: true });
    const sources = [...new Set(request.sources)];
    this.lastSettings = {
      sources,
      locale: request.locale,
      speakers: request.speakers === true,
    };
    this.current = {
      available: true,
      state: "preparing",
      ...target,
      sources,
      locale: request.locale,
      speakersAvailable: this.speakersAvailable(),
    };

    // Speaker labels are a bonus: if they cannot start, the capture runs
    // without them and says so.
    let speakers: Record<string, unknown> | undefined;
    let session: SpeakerSession | undefined;
    if (request.speakers && this.options.speakers && this.speakersAvailable()) {
      const token = { target };
      this.starting = token;
      this.options.emit({ kind: "status", status: this.status() });
      try {
        const models = this.options.speakers.models();
        session = await this.loadSpeakerSession(
          file,
          speakersFile,
          request.expectedSpeakers,
        );
        speakers = {
          segmentation: models.segmentation,
          embedding: models.embedding,
        };
      } catch (error) {
        // The technical detail is for the log; the notice says it plainly.
        console.warn("Live Context speaker labels are off.", error);
        this.current.lastError = {
          code: "speakers_unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
        session = undefined;
      }
      // Stopped meanwhile.
      if (this.starting !== token) return this.status();
      this.starting = undefined;
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
      saved: new Set(),
      pendingTurns: new Map(),
      speakersFile,
      ...(session && speakers ? { speakers: session } : {}),
    };
    this.capture = capture;
    if (capture.speakers)
      this.appendSpeakerRecords(capture, [capture.speakers.beginCapture()]);
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

  /**
   * What the session's agent may see: the transcript, and the capture's
   * state while this session captures. Another session's capture shows
   * nothing here.
   */
  async agentSource(
    target: LiveContextTarget,
  ): Promise<LiveContextAgentSource> {
    const transcript = await this.transcript(target);
    const status = this.status();
    const here =
      status.sessionId === target.sessionId &&
      status.projectId === target.projectId &&
      status.state !== "idle";
    return {
      transcript,
      ...(here
        ? { capture: { state: status.state, sources: [...status.sources] } }
        : {}),
      now: this.now(),
    };
  }

  /**
   * Deletes the session's transcript and speaker data. A capture into it
   * stops first, so nothing is written after the files are gone.
   */
  async deleteTranscript(
    target: LiveContextTarget,
  ): Promise<LiveContextStatus> {
    const capturing =
      this.capture?.target.sessionId === target.sessionId ||
      this.starting?.target.sessionId === target.sessionId;
    if (capturing) await this.stop();
    await this.writes;
    await deleteLiveTranscript(
      this.options.projectRoot(target.projectId),
      target.sessionId,
    );
    this.options.emit({ kind: "deleted", sessionId: target.sessionId });
    return this.status();
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
      (speakers) => {
        if (this.capture?.target.sessionId === request.sessionId)
          this.capture.speakers?.userMerged(request.from, request.into);
        return mergeSpeakers(speakers, request.from, request.into);
      },
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

  /**
   * The session's speakers so far, replayed from its speaker file, with
   * what the transcript already shows as the starting point.
   */
  private async loadSpeakerSession(
    file: string,
    speakersFile: string,
    expectedSpeakers?: number,
  ): Promise<SpeakerSession> {
    const session = new SpeakerSession(
      expectedSpeakers ? { expectedSpeakers } : {},
    );
    let text = "";
    try {
      text = await readFile(speakersFile, "utf8");
    } catch {
      // A first capture with speakers.
    }
    session.replay(readSpeakerRecords(text));
    const transcript = await this.readTranscriptFile(file);
    for (const segment of transcript.segments)
      if (segment.turns)
        session.setEmitted(segment.source, segment.id, {
          turns: segment.turns,
          ...(segment.echo ? { echo: true } : {}),
        });
    for (const [from, into] of Object.entries(transcript.speakers.merges))
      if (into) session.userMerged(from, into);
    return session;
  }

  private appendSpeakerRecords(
    capture: Capture,
    records: readonly SpeakerRecord[],
  ): void {
    if (!records.length) return;
    const text = records
      .map(
        (record) => `${JSON.stringify({ v: TRANSCRIPT_VERSION, ...record })}\n`,
      )
      .join("");
    this.writes = this.writes
      .then(() => appendFile(capture.speakersFile, text))
      .catch((error: unknown) =>
        console.error("Failed to save Live Context speakers.", error),
      );
  }

  /** A measurement from the helper: store it, then show changed labels. */
  private handleSpeakerEvent(
    capture: Capture,
    event: Record<string, unknown>,
    segmentId?: string,
  ): void {
    const session = capture.speakers;
    if (!session) return;
    const { record, labels, aliases } = session.handle(event, segmentId);
    if (record) this.appendSpeakerRecords(capture, [record]);
    this.applyLabels(capture, labels);
    for (const [from, into] of aliases)
      void this.changeSpeakers(
        capture.target,
        { type: "speaker-alias", from, into },
        (speakers) =>
          isSpeakerKey(from) && isSpeakerKey(into)
            ? aliasSpeaker(speakers, from, into)
            : speakers,
      ).catch((error: unknown) =>
        console.error("Failed to save a Live Context speaker alias.", error),
      );
  }

  private applyLabels(capture: Capture, labels: readonly SourcedLabel[]): void {
    for (const { id, turns, echo } of labels) {
      this.options.emit({
        kind: "turns",
        sessionId: capture.target.sessionId,
        segmentId: id,
        turns,
        ...(echo ? { echo: true } : {}),
      });
      if (!capture.saved.has(id)) {
        capture.pendingTurns.set(id, {
          turns,
          ...(echo ? { echo: true } : {}),
        });
        continue;
      }
      this.append(capture, {
        type: "turns",
        id,
        turns,
        ...(echo ? { echo: true } : {}),
      });
    }
  }

  /**
   * The capture ended: the final pass over the session's embeddings, with
   * the user's renames and merges as hard constraints.
   */
  private finishSpeakers(capture: Capture): void {
    const session = capture.speakers;
    if (!session) return;
    this.writes = this.writes
      .then(async () => {
        const { speakers } = await this.readTranscriptFile(capture.file);
        const { labels, records } = session.finish(speakers);
        this.applyLabels(capture, labels);
        this.appendSpeakerRecords(capture, records);
      })
      .catch((error: unknown) =>
        console.error("Failed to finish Live Context speakers.", error),
      );
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
    this.finishSpeakers(this.capture);
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
        // Labels first, so a final segment is saved with them.
        if (typeof event.id === "string")
          this.handleSpeakerEvent(capture, event, `${capture.id}-${event.id}`);
        this.handleSegment(capture, event);
        return;
      case "window":
      case "embedding":
      case "echo":
      case "device":
        this.handleSpeakerEvent(capture, event);
        return;
      case "level": {
        // Only for the waveform: broadcast as it comes, never saved.
        if (this.current.state !== "listening") return;
        const levels = parseLevels(event.levels);
        if (levels) this.options.emit({ kind: "levels", levels });
        return;
      }
      case "speakers-state":
        this.update({
          speakersDegraded:
            event.level === 4
              ? "paused"
              : typeof event.level === "number" && event.level > 0
                ? "reduced"
                : undefined,
        });
        return;
      default:
        return;
    }
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
    const label = capture.pendingTurns.get(segment.id);
    if (label) {
      segment.turns = label.turns;
      if (label.echo) segment.echo = true;
    }
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
    capture.pendingTurns.delete(segment.id);
    this.options.emit({ kind: "segment", sessionId, segment });
    if (!segment.text) return;
    capture.saved.add(segment.id);
    this.append(capture, {
      id: segment.id,
      source: segment.source,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      ...(label ? { turns: label.turns } : {}),
      ...(label?.echo ? { echo: true } : {}),
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

function clampLevel(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

/** The helper's `level` event, per source we know, levels kept to 0…1. */
function parseLevels(value: unknown): LiveContextLevels | undefined {
  if (!value || typeof value !== "object") return undefined;
  const levels: LiveContextLevels = {};
  for (const [source, level] of Object.entries(value)) {
    if (!isSource(source) || !level || typeof level !== "object") continue;
    const { rms, peak } = level as Record<string, unknown>;
    levels[source] = { rms: clampLevel(rms), peak: clampLevel(peak) };
  }
  return Object.keys(levels).length > 0 ? levels : undefined;
}
