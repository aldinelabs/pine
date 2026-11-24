import { computed } from "vue";
import {
  useArtifactVersionStore,
  workbenchVersionKey,
  type ArtifactVersionSource,
} from "@/stores/artifactVersions";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";
import { useSubmissionCounts } from "./useSubmittedArtifacts";

/**
 * The submitted artifact the workbench preview shows, if any, and the key
 * its version state is kept under.
 */
export function useWorkbenchArtifactVersions() {
  const workbench = useWorkbenchStore();
  const sessionStore = useSessionStore();
  const projectStore = useProjectStore();
  const versions = useArtifactVersionStore();
  const submissionCounts = useSubmissionCounts();

  const key = computed(() => {
    const sessionId = sessionStore.activeSession?.id;
    return sessionId ? workbenchVersionKey(sessionId) : undefined;
  });
  /**
   * The submitted path the preview shows: the one it was opened as, or the
   * file the agent presented once the session submitted it, so a preview
   * left open gains its history without being reopened.
   */
  const artifactPath = computed(() => {
    const preview = workbench.activeLayout.preview;
    if (preview?.artifactPath) return preview.artifactPath;
    return preview?.path && submissionCounts.value.has(preview.path)
      ? preview.path
      : undefined;
  });
  const source = computed<ArtifactVersionSource | undefined>(() => {
    const path = artifactPath.value;
    const sessionId = sessionStore.activeSession?.id;
    if (!path || !sessionId) return undefined;
    return {
      projectId:
        sessionStore.projectOf(sessionId) ?? projectStore.currentProjectId,
      sessionId,
      path,
    };
  });
  /** Changes each time the session submits the shown file again. */
  const submissions = computed(() =>
    artifactPath.value
      ? (submissionCounts.value.get(artifactPath.value) ?? 0)
      : 0,
  );
  const view = computed(() =>
    key.value ? versions.viewOf(key.value) : undefined,
  );
  return { key, source, submissions, view };
}
