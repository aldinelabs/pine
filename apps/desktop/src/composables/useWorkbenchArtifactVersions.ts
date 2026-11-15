import { computed } from "vue";
import {
  useArtifactVersionStore,
  workbenchVersionKey,
  type ArtifactVersionSource,
} from "@/stores/artifactVersions";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";

/**
 * The submitted artifact the workbench preview shows, if any, and the key
 * its version state is kept under.
 */
export function useWorkbenchArtifactVersions() {
  const workbench = useWorkbenchStore();
  const sessionStore = useSessionStore();
  const projectStore = useProjectStore();
  const versions = useArtifactVersionStore();

  const key = computed(() => {
    const sessionId = sessionStore.activeSession?.id;
    return sessionId ? workbenchVersionKey(sessionId) : undefined;
  });
  const source = computed<ArtifactVersionSource | undefined>(() => {
    const artifactPath = workbench.activeLayout.preview?.artifactPath;
    const sessionId = sessionStore.activeSession?.id;
    if (!artifactPath || !sessionId) return undefined;
    return {
      projectId:
        sessionStore.projectOf(sessionId) ?? projectStore.currentProjectId,
      sessionId,
      path: artifactPath,
    };
  });
  const view = computed(() =>
    key.value ? versions.viewOf(key.value) : undefined,
  );
  return { key, source, view };
}
