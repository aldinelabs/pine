import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactVersion,
  ArtifactVersionHistory,
} from "@/shared/artifacts";
import { useArtifactVersionStore } from "../artifactVersions";

const source = { projectId: "p1", sessionId: "s1", path: "/project/report.md" };
const older: ArtifactVersion = {
  ref: { kind: "submission", toolCallId: "submit-1" },
  time: 1,
  size: 3,
  state: "available",
  current: false,
};
const history: ArtifactVersionHistory = {
  path: source.path,
  versions: [
    {
      ...older,
      ref: { kind: "submission", toolCallId: "submit-2" },
      current: true,
    },
    older,
  ],
  missing: false,
  modified: false,
  restorable: true,
};
const copy = { source: "presented" as const, path: "/tmp/v/report.md" };

/** Electron structured-clones every IPC argument, which rejects proxies. */
function ipc<T>(result: T) {
  return vi.fn((request: unknown) => {
    structuredClone(request);
    return Promise.resolve(result);
  });
}

let pine: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  pine = {
    artifactVersions: ipc(history),
    openArtifactVersion: ipc(copy),
    diffArtifactVersion: ipc({ status: "identical" }),
    restoreArtifactVersion: ipc(undefined),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
});

async function loaded() {
  const store = useArtifactVersionStore();
  store.bind("k", source);
  await store.load("k");
  return store;
}

describe("artifact version store", () => {
  it("shows a kept version in place of the file and returns to it", async () => {
    const store = await loaded();
    const version = store.viewOf("k")!.history!.versions[1];

    await store.show("k", version);

    expect(pine.openArtifactVersion).toHaveBeenCalledWith({
      ...source,
      version: { kind: "submission", toolCallId: "submit-1" },
    });
    expect(store.viewOf("k")).toMatchObject({ viewing: older, target: copy });

    store.showCurrent("k");
    expect(store.viewOf("k")?.viewing).toBeUndefined();
    expect(store.viewOf("k")?.target).toBeUndefined();
  });

  it("returns to the file when a version cannot be opened", async () => {
    const store = await loaded();
    pine.openArtifactVersion.mockRejectedValueOnce(new Error("gone"));

    await expect(
      store.show("k", store.viewOf("k")!.history!.versions[1]),
    ).rejects.toThrow("gone");
    expect(store.viewOf("k")?.viewing).toBeUndefined();
  });

  it("reads the diff once while comparing", async () => {
    const store = await loaded();
    await store.show("k", store.viewOf("k")!.history!.versions[1]);

    await store.setComparing("k", true);
    await store.setComparing("k", false);
    await store.setComparing("k", true);

    expect(store.viewOf("k")).toMatchObject({
      comparing: true,
      diff: { status: "identical" },
    });
    expect(pine.diffArtifactVersion).toHaveBeenCalledTimes(1);
  });

  it("restores the shown version, then shows the file and its new history", async () => {
    const store = await loaded();
    await store.show("k", store.viewOf("k")!.history!.versions[1]);

    await store.restore("k");

    expect(pine.restoreArtifactVersion).toHaveBeenCalledWith({
      ...source,
      version: { kind: "submission", toolCallId: "submit-1" },
    });
    expect(store.viewOf("k")?.viewing).toBeUndefined();
    expect(pine.artifactVersions).toHaveBeenCalledTimes(2);
  });

  it("starts over when the preview shows another artifact", async () => {
    const store = await loaded();
    await store.show("k", store.viewOf("k")!.history!.versions[1]);

    store.bind("k", source);
    expect(store.viewOf("k")?.viewing).toEqual(older);
    store.bind("k", { ...source, path: "/project/other.md" });
    expect(store.viewOf("k")?.viewing).toBeUndefined();
    expect(store.viewOf("k")?.history).toBeUndefined();
    store.bind("k", undefined);
    expect(store.viewOf("k")).toBeUndefined();
  });
});
