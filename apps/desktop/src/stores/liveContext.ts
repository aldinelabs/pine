import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { preferenceStorage } from "@/lib/preferenceStorage";
import {
  IDLE_LIVE_CONTEXT_STATUS,
  LIVE_CONTEXT_TRANSLATION_LANGUAGES,
  type LiveContextEvent,
  type LiveContextLevels,
  type LiveContextSegment,
  type LiveContextSource,
  type LiveContextSpeakerKey,
  type LiveContextSpeakers,
  type LiveContextStatus,
  type LiveContextTarget,
  type LiveContextTranslations,
  type LiveContextTurn,
} from "@/shared/liveContext";
import { emptySpeakers } from "@/shared/liveContextSpeakers";

/** One reading of the input levels and when it arrived (performance.now). */
export interface LiveContextLevelSample {
  at: number;
  levels: LiveContextLevels;
}

/** Levels kept for the waveform: a little over its few seconds. */
export const LIVE_CONTEXT_LEVEL_HISTORY_MS = 6000;

/** Whether captures translate, and into which language. */
export const LIVE_CONTEXT_TRANSLATION_PREFERENCE_KEY =
  "pine.live-context-translation";

export interface LiveContextTranslationPreference {
  enabled: boolean;
  /** Unset: the language Pine's interface speaks. */
  language?: string;
}

function isTranslationLanguage(value: unknown): value is string {
  return LIVE_CONTEXT_TRANSLATION_LANGUAGES.some(
    (language) => language === value,
  );
}

function readTranslationPreference(): LiveContextTranslationPreference {
  try {
    const stored = preferenceStorage.getItem(
      LIVE_CONTEXT_TRANSLATION_PREFERENCE_KEY,
    );
    if (!stored) return { enabled: false };
    const value = JSON.parse(stored) as Record<string, unknown>;
    return {
      enabled: value.enabled === true,
      ...(isTranslationLanguage(value.language)
        ? { language: value.language }
        : {}),
    };
  } catch {
    return { enabled: false };
  }
}

/**
 * The app-wide Live Context capture and the transcripts of the sessions the
 * workbench has shown. Only desktop windows have the API; elsewhere the
 * store stays unavailable.
 */
export const useLiveContextStore = defineStore("liveContext", () => {
  const api =
    typeof window === "undefined" ? undefined : window.pine?.liveContext;
  const status = ref<LiveContextStatus>({ ...IDLE_LIVE_CONTEXT_STATUS });
  /** Final segments per session, oldest first. */
  const transcripts = reactive(new Map<string, LiveContextSegment[]>());
  /** The text still forming, per source, for the capturing session. */
  const volatile = reactive(new Map<LiveContextSource, LiveContextSegment>());
  /** Speaker names and merges per session. */
  const speakers = reactive(new Map<string, LiveContextSpeakers>());
  /** Whether the next capture labels speakers; off until the user opts in. */
  const identifySpeakers = ref(false);
  /** Translating final segments; off until the user turns it on. */
  const translation = ref<LiveContextTranslationPreference>(
    readTranslationPreference(),
  );
  watch(
    translation,
    (value) => {
      try {
        preferenceStorage.setItem(
          LIVE_CONTEXT_TRANSLATION_PREFERENCE_KEY,
          JSON.stringify(value),
        );
      } catch {
        // Not kept; it still applies in this window.
      }
    },
    { deep: true },
  );
  /** Translations per session, by language and segment id. */
  const translations = reactive(new Map<string, LiveContextTranslations>());
  /** Segments of the capturing session waiting for their translation. */
  const pendingTranslations = reactive(new Map<string, Set<string>>());

  function addTranslations(
    sessionId: string,
    language: string,
    entries: Record<string, string>,
  ): void {
    if (!Object.keys(entries).length) return;
    const bySession = translations.get(sessionId) ?? {};
    bySession[language] = { ...bySession[language], ...entries };
    translations.set(sessionId, bySession);
  }

  const available = computed(() => Boolean(api) && status.value.available);
  const isCapturing = computed(() => status.value.state !== "idle");

  /**
   * Recent input levels, oldest first. A plain array, not reactive state:
   * they arrive 25 times a second and only the waveform's frame loop reads
   * them.
   */
  const levelSamples: LiveContextLevelSample[] = [];

  function addLevels(levels: LiveContextLevels): void {
    const at = performance.now();
    levelSamples.push({ at, levels });
    const cutoff = at - LIVE_CONTEXT_LEVEL_HISTORY_MS;
    let stale = 0;
    while (stale < levelSamples.length && levelSamples[stale].at < cutoff)
      stale += 1;
    if (stale > 0) levelSamples.splice(0, stale);
  }

  /** The levels heard in the last few seconds, oldest first. */
  function levelHistory(): readonly LiveContextLevelSample[] {
    return levelSamples;
  }

  /** Time spent paused in this capture, and when the current pause began. */
  let pausedMs = 0;
  let pausedSince: number | undefined;

  function setStatus(next: LiveContextStatus): void {
    const now = Date.now();
    if (next.state === "idle" || next.startedAt !== status.value.startedAt) {
      pausedMs = 0;
      pausedSince = undefined;
    }
    if (next.state === "paused") pausedSince ??= now;
    else if (pausedSince !== undefined) {
      pausedMs += now - pausedSince;
      pausedSince = undefined;
    }
    status.value = next;
  }

  /**
   * How long this capture has listened, paused time left out; undefined
   * before listening begins.
   */
  function elapsedAt(now: number): number | undefined {
    const startedAt = status.value.startedAt;
    if (startedAt === undefined || status.value.state === "idle")
      return undefined;
    const end = pausedSince ?? now;
    return Math.max(0, end - startedAt - pausedMs);
  }

  function applyTurns(
    sessionId: string,
    segmentId: string,
    turns: LiveContextTurn[],
    echo: boolean,
  ): void {
    const label = (segment: LiveContextSegment): LiveContextSegment => {
      const next: LiveContextSegment = { ...segment, turns };
      if (echo) next.echo = true;
      else delete next.echo;
      return next;
    };
    for (const [source, segment] of volatile)
      if (segment.id === segmentId) volatile.set(source, label(segment));
    const list = transcripts.get(sessionId);
    const index = list?.findIndex(({ id }) => id === segmentId) ?? -1;
    if (list && index >= 0) list[index] = label(list[index]);
  }

  function apply(event: LiveContextEvent): void {
    if (event.kind === "levels") {
      addLevels(event.levels);
      return;
    }
    if (event.kind === "status") {
      setStatus(event.status);
      if (event.status.state === "idle") {
        volatile.clear();
        levelSamples.length = 0;
        pendingTranslations.clear();
      }
      return;
    }
    if (event.kind === "translation") {
      addTranslations(event.sessionId, event.language, event.translations);
      // Pending lists come whole; a translation takes its own segment out.
      if (event.pending)
        pendingTranslations.set(event.sessionId, new Set(event.pending));
      else
        for (const id of Object.keys(event.translations))
          pendingTranslations.get(event.sessionId)?.delete(id);
      return;
    }
    if (event.kind === "turns") {
      applyTurns(
        event.sessionId,
        event.segmentId,
        event.turns,
        event.echo === true,
      );
      return;
    }
    if (event.kind === "speakers") {
      speakers.set(event.sessionId, event.speakers);
      return;
    }
    if (event.kind === "deleted") {
      forget(event.sessionId);
      return;
    }
    const { segment, sessionId } = event;
    if (!segment.final) {
      volatile.set(segment.source, segment);
      return;
    }
    // A label that reached the volatile text first carries over.
    const forming = volatile.get(segment.source);
    if (forming?.id === segment.id) {
      volatile.delete(segment.source);
      if (!segment.turns && forming.turns) {
        segment.turns = forming.turns;
        if (forming.echo) segment.echo = true;
      }
    }
    const list = transcripts.get(sessionId);
    if (list && segment.text && !list.some(({ id }) => id === segment.id))
      list.push(segment);
  }

  if (api) {
    api.subscribe(apply);
    void api
      .status()
      .then(setStatus)
      .catch(() => undefined);
  }

  async function load(target: LiveContextTarget): Promise<void> {
    if (!api) return;
    const saved = await api.transcript(target);
    // Segments that arrived while reading stay, without duplicates.
    const live = transcripts.get(target.sessionId) ?? [];
    const ids = new Set(saved.segments.map(({ id }) => id));
    transcripts.set(target.sessionId, [
      ...saved.segments,
      ...live.filter(({ id }) => !ids.has(id)),
    ]);
    speakers.set(target.sessionId, saved.speakers);
    for (const [language, entries] of Object.entries(saved.translations ?? {}))
      if (entries) {
        // Translations that arrived while reading are newer.
        const live = translations.get(target.sessionId)?.[language] ?? {};
        addTranslations(target.sessionId, language, { ...entries, ...live });
      }
  }

  /** The session's translations into `language`, by segment id. */
  function translationsOf(
    sessionId: string,
    language: string,
  ): Record<string, string> {
    return translations.get(sessionId)?.[language] ?? {};
  }

  /** Segments waiting for a translation, in the capturing session. */
  function pendingTranslationsOf(sessionId: string): ReadonlySet<string> {
    return pendingTranslations.get(sessionId) ?? new Set();
  }

  /**
   * Starts or stops translating the session's capture (no-op when it is not
   * the one capturing); the preference is the caller's to change.
   */
  async function setTranslation(
    target: LiveContextTarget,
    language: string | null,
  ): Promise<void> {
    if (!api) return;
    if (!language) pendingTranslations.delete(target.sessionId);
    setStatus(await api.setTranslation({ ...target, language }));
  }

  function segmentsOf(sessionId: string): LiveContextSegment[] {
    return transcripts.get(sessionId) ?? [];
  }

  function speakersOf(sessionId: string): LiveContextSpeakers {
    return speakers.get(sessionId) ?? emptySpeakers();
  }

  async function renameSpeaker(
    target: LiveContextTarget,
    speaker: LiveContextSpeakerKey,
    name: string,
  ): Promise<void> {
    if (!api) return;
    speakers.set(
      target.sessionId,
      await api.renameSpeaker({ ...target, speaker, name }),
    );
  }

  async function mergeSpeakers(
    target: LiveContextTarget,
    from: LiveContextSpeakerKey,
    into: LiveContextSpeakerKey,
  ): Promise<void> {
    if (!api) return;
    speakers.set(
      target.sessionId,
      await api.mergeSpeakers({ ...target, from, into }),
    );
  }

  /** Volatile text, shown only in the capturing session. */
  function volatileOf(sessionId: string): LiveContextSegment[] {
    if (status.value.sessionId !== sessionId) return [];
    return [...volatile.values()].sort((a, b) => a.start - b.start);
  }

  async function start(
    target: LiveContextTarget,
    sources: LiveContextSource[],
    locale: string,
    /** Translate final segments into this language. */
    translateTo?: string,
  ): Promise<void> {
    if (!api) return;
    if (!transcripts.has(target.sessionId))
      transcripts.set(target.sessionId, []);
    setStatus(
      await api.start({
        ...target,
        // A plain copy: the panel's sources are a reactive (Proxy) array,
        // which Electron cannot clone into an IPC message.
        sources: [...sources],
        locale,
        speakers: identifySpeakers.value && status.value.speakersAvailable,
        ...(translateTo ? { translation: translateTo } : {}),
      }),
    );
  }

  async function pause(): Promise<void> {
    if (api) setStatus(await api.pause());
  }

  async function resume(): Promise<void> {
    if (api) setStatus(await api.resume());
  }

  async function stop(): Promise<void> {
    if (api) setStatus(await api.stop());
  }

  /** Drops what this window holds of a deleted transcript. */
  function forget(sessionId: string): void {
    if (transcripts.has(sessionId)) transcripts.set(sessionId, []);
    speakers.delete(sessionId);
    translations.delete(sessionId);
    pendingTranslations.delete(sessionId);
  }

  /**
   * Deletes the conversation's transcript and speaker names for good,
   * stopping its capture first; the panel goes back to its setup.
   */
  async function deleteTranscript(target: LiveContextTarget): Promise<void> {
    if (!api) return;
    setStatus(await api.deleteTranscript({ ...target }));
    forget(target.sessionId);
  }

  async function openPrivacySettings(source: LiveContextSource): Promise<void> {
    await api?.openPrivacySettings(source);
  }

  return {
    status,
    available,
    isCapturing,
    identifySpeakers,
    translation,
    translationsOf,
    pendingTranslationsOf,
    setTranslation,
    load,
    segmentsOf,
    speakersOf,
    renameSpeaker,
    mergeSpeakers,
    volatileOf,
    start,
    pause,
    resume,
    stop,
    deleteTranscript,
    elapsedAt,
    levelHistory,
    openPrivacySettings,
    apply,
  };
});
