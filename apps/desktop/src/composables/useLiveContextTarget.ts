import { computed, type ComputedRef } from "vue";
import type { LiveContextTarget } from "@/shared/liveContext";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";

/** The conversation the Live Context card shows: the active session. */
export function useLiveContextTarget(): ComputedRef<
  LiveContextTarget | undefined
> {
  const sessionStore = useSessionStore();
  const projectStore = useProjectStore();
  return computed(() => {
    const sessionId = sessionStore.activeSession?.id;
    if (!sessionId) return undefined;
    const projectId =
      sessionStore.projectOf(sessionId) ?? projectStore.currentProjectId;
    return projectId ? { projectId, sessionId } : undefined;
  });
}
