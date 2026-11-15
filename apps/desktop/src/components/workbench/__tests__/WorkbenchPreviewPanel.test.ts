import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  useArtifactVersionStore,
  workbenchVersionKey,
} from "@/stores/artifactVersions";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";
import WorkbenchPreviewPanel from "../WorkbenchPreviewPanel.vue";

/** Electron structured-clones IPC arguments; reactive proxies fail that. */
function ipc<T>(result: T) {
  return vi.fn((request: unknown) => {
    structuredClone(request);
    return Promise.resolve(result);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

it("loads the stored target through IPC-safe arguments", async () => {
  const readProjectFilePreview = ipc({ kind: "unsupported", size: 4 });
  const setWatchedFilePreview = ipc(undefined);
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      onFilePreviewChanged: vi.fn(() => () => undefined),
      readProjectFilePreview,
      readPresentedFilePreview: ipc({ kind: "unsupported", size: 4 }),
      setWatchedFilePreview,
    },
  });
  const target = {
    source: "project" as const,
    projectId: "project-1",
    folderId: "folder-1",
    relativePath: "out6/b1.png",
  };
  useWorkbenchStore().preview({ target, toolCallId: "call-1" });

  const wrapper = mount(WorkbenchPreviewPanel, {
    global: { plugins: [createAppI18n("en-US")] },
  });
  await flushPromises();

  expect(setWatchedFilePreview).toHaveBeenCalledWith(
    expect.objectContaining({ target }),
  );
  expect(readProjectFilePreview).toHaveBeenCalledWith({
    projectId: "project-1",
    folderId: "folder-1",
    relativePath: "out6/b1.png",
  });
  // The read settled: the skeleton gave way to the unsupported notice.
  expect(wrapper.text()).toContain("This file can’t be previewed");
  wrapper.unmount();
});

function watchedPreview(relativePath: string, texts: string[]) {
  let notify: ((event: { watchId: string }) => void) | undefined;
  const reads = texts.map((text) => ({
    kind: "text",
    text,
    encoding: "UTF-8",
    size: text.length,
    modifiedAt: "2026-10-22T00:00:00Z",
  }));
  const readProjectFilePreview = vi.fn(() =>
    Promise.resolve(reads.length > 1 ? reads.shift() : reads[0]),
  );
  const setWatchedFilePreview = ipc(undefined);
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      onFilePreviewChanged: vi.fn((listener: typeof notify) => {
        notify = listener;
        return () => undefined;
      }),
      readProjectFilePreview,
      readPresentedFilePreview: ipc({ kind: "unsupported", size: 4 }),
      setWatchedFilePreview,
    },
  });
  useWorkbenchStore().preview({
    target: {
      source: "project",
      projectId: "project-1",
      folderId: "folder-1",
      relativePath,
    },
    toolCallId: "call-1",
  });
  const wrapper = mount(WorkbenchPreviewPanel, {
    global: { plugins: [createAppI18n("en-US")] },
  });
  return {
    wrapper,
    change: async () => {
      const [request] = setWatchedFilePreview.mock.calls.at(-1) as [
        { watchId: string },
      ];
      notify?.({ watchId: request.watchId });
      await flushPromises();
    },
  };
}

it("tints the lines a watched source file gained and pulses the card", async () => {
  const { wrapper, change } = watchedPreview("src/main.py", [
    "a\nb\nc",
    "a\nB\nc\nd",
  ]);
  await flushPromises();
  expect(wrapper.find('[data-slot="code-line-change"]').exists()).toBe(false);

  await change();
  const bands = wrapper.findAll('[data-slot="code-line-change"]');
  expect(bands.map((band) => band.attributes("style"))).toEqual([
    expect.stringContaining("+ 1 * var(--code-preview-line)"),
    expect.stringContaining("+ 3 * var(--code-preview-line)"),
  ]);
  expect(wrapper.emitted("contentChanged")).toHaveLength(1);
  wrapper.unmount();
});

it("pulses the card for a change with no lines to tint", async () => {
  const { wrapper, change } = watchedPreview("notes.md", [
    "# Title",
    "# Title\n\nMore",
    "# Title\n\nMore",
  ]);
  await flushPromises();

  await change();
  expect(wrapper.find('[data-slot="code-line-change"]').exists()).toBe(false);
  expect(wrapper.emitted("contentChanged")).toHaveLength(1);

  // Saving the same content again changes nothing.
  await change();
  expect(wrapper.emitted("contentChanged")).toHaveLength(1);
  wrapper.unmount();
});

it("shows a kept version of a submitted artifact in place of the file", async () => {
  const readProjectFilePreview = ipc({ kind: "unsupported", size: 4 });
  const readPresentedFilePreview = ipc({ kind: "unsupported", size: 2 });
  const version = {
    ref: { kind: "submission" as const, toolCallId: "call-1" },
    time: Date.UTC(2026, 10, 1),
    size: 2,
    state: "available" as const,
    current: false,
  };
  const copy = { source: "presented" as const, path: "/tmp/v/report.md" };
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      onFilePreviewChanged: vi.fn(() => () => undefined),
      readProjectFilePreview,
      readPresentedFilePreview,
      setWatchedFilePreview: ipc(undefined),
      artifactVersions: ipc({
        path: "/project/report.md",
        versions: [version],
        missing: false,
        modified: true,
        restorable: true,
      }),
      openArtifactVersion: ipc(copy),
      diffArtifactVersion: ipc({ status: "identical" }),
    },
  });
  const session = useSessionStore();
  session.activeSession = {
    id: "s1",
    createdAt: "",
    updatedAt: "",
    messageCount: 1,
  };
  useWorkbenchStore().preview({
    target: {
      source: "project",
      projectId: "project-1",
      folderId: "folder-1",
      relativePath: "report.md",
    },
    toolCallId: "call-1",
    artifactPath: "/project/report.md",
  });
  const wrapper = mount(WorkbenchPreviewPanel, {
    global: { plugins: [createAppI18n("en-US")] },
  });
  await flushPromises();
  const versions = useArtifactVersionStore();
  const key = workbenchVersionKey("s1");
  expect(versions.viewOf(key)?.source.path).toBe("/project/report.md");
  expect(wrapper.find('[data-testid="artifact-version-bar"]').exists()).toBe(
    false,
  );

  await versions.show(key, version);
  await flushPromises();

  expect(readPresentedFilePreview).toHaveBeenCalledWith({
    path: "/tmp/v/report.md",
  });
  expect(wrapper.get('[data-testid="artifact-version-bar"]').text()).toContain(
    "Version from",
  );

  await wrapper
    .get('[data-testid="artifact-version-compare"]')
    .trigger("click");
  await flushPromises();
  expect(wrapper.get('[data-testid="artifact-version-diff"]').text()).toContain(
    "same as the current file",
  );

  await wrapper.get('[data-testid="artifact-version-back"]').trigger("click");
  await flushPromises();
  expect(wrapper.find('[data-testid="artifact-version-bar"]').exists()).toBe(
    false,
  );
  expect(readProjectFilePreview).toHaveBeenCalledTimes(2);
  wrapper.unmount();
});
