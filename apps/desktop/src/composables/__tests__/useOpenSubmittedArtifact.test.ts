import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactVersionHistory } from "@/shared/artifacts";
import {
  useArtifactVersionStore,
  workbenchVersionKey,
} from "@/stores/artifactVersions";
import { useWorkbenchStore } from "@/stores/workbench";
import { useOpenSubmittedArtifact } from "../useOpenSubmittedArtifact";

const target = {
  source: "project" as const,
  projectId: "p1",
  folderId: "f1",
  relativePath: "report.md",
};
const request = {
  projectId: "p1",
  sessionId: "s1",
  toolCallId: "submit-1",
  path: "/project/report.md",
};

function history(current: boolean): ArtifactVersionHistory {
  return {
    path: request.path,
    versions: [
      {
        ref: { kind: "submission", toolCallId: "submit-2" },
        time: 2,
        state: "available",
        current: !current,
      },
      {
        ref: { kind: "submission", toolCallId: "submit-1" },
        time: 1,
        state: "available",
        current,
      },
    ],
    missing: false,
    modified: false,
    restorable: true,
  };
}

/** Electron structured-clones every IPC argument, which rejects proxies. */
function ipc<T>(result: T) {
  return vi.fn((value: unknown) => {
    structuredClone(value);
    return Promise.resolve(result);
  });
}

function setup(versions: ArtifactVersionHistory) {
  const pine = {
    reopenPresentedToolFile: ipc(target),
    artifactVersions: ipc(versions),
    openArtifactVersion: ipc({ source: "presented", path: "/tmp/v/report.md" }),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  return pine;
}

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

describe("useOpenSubmittedArtifact", () => {
  it("previews the version an older submission kept", async () => {
    const pine = setup(history(false));

    await expect(useOpenSubmittedArtifact()(request)).resolves.toBe(true);

    expect(pine.reopenPresentedToolFile).toHaveBeenCalledWith(request);
    expect(useWorkbenchStore().activeLayout.preview).toMatchObject({
      target,
      toolCallId: "submit-1",
      artifactPath: request.path,
    });
    expect(
      useArtifactVersionStore().viewOf(workbenchVersionKey("s1"))?.viewing?.ref,
    ).toEqual({ kind: "submission", toolCallId: "submit-1" });
  });

  it("previews the file itself when it is still that submission", async () => {
    const pine = setup(history(true));

    await useOpenSubmittedArtifact()(request);

    expect(pine.openArtifactVersion).not.toHaveBeenCalled();
    expect(
      useArtifactVersionStore().viewOf(workbenchVersionKey("s1"))?.viewing,
    ).toBeUndefined();
  });

  it("reports a file it cannot open", async () => {
    setup(history(false));
    window.pine.reopenPresentedToolFile = ipc(null);

    await expect(useOpenSubmittedArtifact()(request)).resolves.toBe(false);
    expect(useWorkbenchStore().activeLayout.preview).toBeFalsy();
  });
});
