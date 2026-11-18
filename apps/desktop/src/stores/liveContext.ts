import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import {
  IDLE_LIVE_CONTEXT_STATUS,
  type LiveContextEvent,
  type LiveContextSegment,
  type LiveContextSource,
  type LiveContextSpeakerKey,
  type LiveContextSpeakers,
  type LiveContextStatus,
  type LiveContextTarget,
  type LiveContextTurn,
} from "@/shared/liveContext";
import { emptySpeakers } from "@/shared/liveContextSpeakers";

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

  const available = computed(() => Boolean(api) && status.value.available);
  const isCapturing = computed(() => status.value.state !== "idle");

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
    if (event.kind === "status") {
      status.value = event.status;
      if (event.status.state === "idle") volatile.clear();
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
      .then((next) => (status.value = next))
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
  ): Promise<void> {
    if (!api) return;
    if (!transcripts.has(target.sessionId))
      transcripts.set(target.sessionId, []);
    status.value = await api.start({
      ...target,
      sources,
      locale,
      speakers: identifySpeakers.value && status.value.speakersAvailable,
    });
  }

  async function pause(): Promise<void> {
    if (api) status.value = await api.pause();
  }

  async function resume(): Promise<void> {
    if (api) status.value = await api.resume();
  }

  async function stop(): Promise<void> {
    if (api) status.value = await api.stop();
  }

  return {
    status,
    available,
    isCapturing,
    identifySpeakers,
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
    apply,
  };
});
