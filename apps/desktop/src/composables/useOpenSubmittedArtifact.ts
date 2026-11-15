import { artifactKey } from "@/shared/artifacts";
import {
  useArtifactVersionStore,
  workbenchVersionKey,
} from "@/stores/artifactVersions";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useWorkbenchStore } from "@/stores/workbench";

export interface SubmittedArtifactRequest {
  projectId: string;
  sessionId: string;
  /** The `ui_submit_artifact` call. */
  toolCallId: string;
  /** The path the submission recorded. */
  path: string;
}

/**
 * Previews a submitted file in the workbench as that submission left it: the
 * version it kept, or the file itself when it has not changed since, or when
 * no copy was kept.
 */
export function useOpenSubmittedArtifact() {
  const contentTabs = useContentTabsStore();
  const workbench = useWorkbenchStore();
  const versions = useArtifactVersionStore();

  /**
   * Resolves to false when the file cannot be opened. Showing the version is
   * best effort: if it fails, the preview stays on the current file.
   */
  return async function openSubmittedArtifact(
    request: SubmittedArtifactRequest,
  ): Promise<boolean> {
    const { projectId, sessionId, toolCallId, path } = request;
    const key = artifactKey(toolCallId, path);
    const target =
      contentTabs.presentedTargetFor(key) ??
      (await window.pine
        .reopenPresentedToolFile({ projectId, sessionId, toolCallId, path })
        .catch(() => null));
    if (!target) return false;
    contentTabs.rememberPresentedTarget(key, target);
    workbench.preview({ target, toolCallId, path, artifactPath: path });

    const viewKey = workbenchVersionKey(sessionId);
    versions.bind(viewKey, { projectId, sessionId, path });
    versions.showCurrent(viewKey);
    try {
      await versions.load(viewKey);
      const version = versions
        .viewOf(viewKey)
        ?.history?.versions.find(
          (candidate) =>
            candidate.ref.kind === "submission" &&
            candidate.ref.toolCallId === toolCallId,
        );
      if (version?.state === "available" && !version.current)
        await versions.show(viewKey, version);
    } catch {
      // The file itself is already on screen.
    }
    return true;
  };
}
