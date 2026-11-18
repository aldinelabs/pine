import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import {
  IDLE_LIVE_CONTEXT_STATUS,
  type LiveContextEvent,
  type LiveContextSegment,
  type LiveContextSource,
  type LiveContextStatus,
  type LiveContextTarget,
} from "@/shared/liveContext";

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

  const available = computed(() => Boolean(api) && status.value.available);
  const isCapturing = computed(() => status.value.state !== "idle");

  function apply(event: LiveContextEvent): void {
    if (event.kind === "status") {
      status.value = event.status;
      if (event.status.state === "idle") volatile.clear();
      return;
    }
    const { segment, sessionId } = event;
    if (!segment.final) {
      volatile.set(segment.source, segment);
      return;
    }
    if (volatile.get(segment.source)?.id === segment.id)
      volatile.delete(segment.source);
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
    const ids = new Set(saved.map(({ id }) => id));
    transcripts.set(target.sessionId, [
      ...saved,
      ...live.filter(({ id }) => !ids.has(id)),
    ]);
  }

  function segmentsOf(sessionId: string): LiveContextSegment[] {
    return transcripts.get(sessionId) ?? [];
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
    status.value = await api.start({ ...target, sources, locale });
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
    load,
    segmentsOf,
    volatileOf,
    start,
    pause,
    resume,
    stop,
    apply,
  };
});
