import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
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
