import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { useContentTabsStore } from "@/stores/contentTabs";
import { injectTreeRootContext } from "reka-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { PROJECT_SIDEBAR_STORAGE_PREFIX } from "@/stores/projectSidebar";
import type {
  ListProjectDirectoryRequest,
  ListProjectDirectoryResult,
} from "@/shared/projectFiles";
import { PROJECT_ENTRY_DRAG_TYPE } from "@/lib/projectFileDrag";
import ProjectFileTree from "../ProjectFileTree.vue";
import { showProject } from "@/stores/__tests__/showProject";

// happy-dom has no layout. Keep the real tree and menus, rendering the visible
// tree items in place of viewport measurements only.
const virtualizer = defineComponent({
  setup(_, { slots }) {
    const context = injectTreeRootContext();
    return () =>
      h(
        "div",
        context.expandedItems.value.flatMap(
          (item) => slots.default?.({ item }) ?? [],
        ),
      );
  },
});
const wrappers: ReturnType<typeof mount>[] = [];
const folderId = "cde9a86c-7632-43ac-96d6-c41ddeddce0e";
beforeEach(() => localStorage.clear());
function mountTree(
  access: "read-only" | "read-write" = "read-write",
  readDirectory?: (
    request: ListProjectDirectoryRequest,
  ) => Promise<ListProjectDirectoryResult>,
  // A project with extra context folders keeps a row per folder root.
  withContextFolder = true,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  showProject({
    id: "p1",
    name: "Project",
    schemaVersion: 1,
    createdAt: "",
    updatedAt: "",
    defaultFolderId: folderId,
    folders: [
      {
        id: folderId,
        name: "project",
        path: "/project",
        access,
        isAvailable: true,
      },
      ...(withContextFolder
        ? [
            {
              id: "0a3f6a52-4f3b-4d6e-a3f6-6f6e2f2f7a11",
              name: "context",
              path: "/context",
              access: "read-only" as const,
              isAvailable: true,
            },
          ]
        : []),
    ],
  });
  const listProjectDirectory = vi.fn(
    readDirectory ??
      (({ relativePath }: ListProjectDirectoryRequest) =>
        Promise.resolve({
          entries: relativePath
            ? []
            : [
                { name: "docs", relativePath: "docs", kind: "directory" },
                { name: "notes.md", relativePath: "notes.md", kind: "file" },
              ],
        })),
  );
  const operateProjectFile = vi.fn(() => Promise.resolve());
  const startProjectFileDrag = vi.fn();
  const unsubscribeProjectFilesChanged = vi.fn();
  const onProjectFilesChanged = vi.fn<
    (listener: (event: unknown) => void) => () => void
  >(() => unsubscribeProjectFilesChanged);
  const setWatchedProjectDirectories = vi.fn(() => Promise.resolve());
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      listProjectDirectory,
      operateProjectFile,
      startProjectFileDrag,
      setWatchedProjectDirectories,
      onProjectFilesChanged,
      getPathForFile: (file: File) => `/external/${file.name}`,
    },
  });
  const wrapper = mount(ProjectFileTree, {
    attachTo: document.body,
    global: {
      plugins: [pinia, router, createAppI18n("zh-CN")],
      stubs: { TreeVirtualizer: virtualizer },
    },
  });
  wrappers.push(wrapper);
  return {
    router,
    wrapper,
    folderId,
    listProjectDirectory,
    operateProjectFile,
    startProjectFileDrag,
    onProjectFilesChanged,
    setWatchedProjectDirectories,
    unsubscribeProjectFilesChanged,
  };
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

function menuItem(text: string) {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (element) => element.textContent?.includes(text),
  );
  if (!item) throw new Error(`Missing menu item: ${text}`);
  return new DOMWrapper(item);
}

async function expandRoot(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-path=""]').trigger("click");
  await flushPromises();
}

describe("ProjectFileTree", () => {
  it("moves following rows when a directory opens and closes", async () => {
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect",
    );
    const originalAnimate = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "animate",
    );
    const animate = vi.fn((frames: Keyframe[]) => {
      void frames;
      return {
        addEventListener: vi.fn(),
        cancel: vi.fn(),
        finished: Promise.resolve(),
      };
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function (this: HTMLElement) {
        const rows = [...document.querySelectorAll("[data-tree-key]")];
        const top = rows.indexOf(this) * 28;
        return { top, bottom: top + 28, left: 0, width: 200, height: 28 };
      },
    });
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    try {
      const { wrapper } = mountTree("read-write", ({ relativePath }) =>
        Promise.resolve({
          entries:
            relativePath === ""
              ? [
                  { name: "docs", relativePath: "docs", kind: "directory" },
                  { name: "notes.md", relativePath: "notes.md", kind: "file" },
                ]
              : [
                  {
                    name: "readme.md",
                    relativePath: "docs/readme.md",
                    kind: "file",
                  },
                ],
        }),
      );
      await expandRoot(wrapper);
      animate.mockClear();
      await wrapper.get('[data-path="docs"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-path="docs/readme.md"]').exists()).toBe(true);
      expect(
        animate.mock.calls.some(
          ([frames]) =>
            JSON.stringify(frames).includes('"height":"0px"') &&
            JSON.stringify(frames).includes('"height":"28px"'),
        ),
      ).toBe(true);
      expect(
        animate.mock.calls.some(
          ([frames]) =>
            JSON.stringify(frames) === '[{"opacity":0},{"opacity":1}]',
        ),
      ).toBe(true);

      animate.mockClear();
      await wrapper.get('[data-path="docs"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-path="docs/readme.md"]').exists()).toBe(false);
      expect(
        animate.mock.calls.some(([frames]) =>
          JSON.stringify(frames).includes('"translate":"0 28px"'),
        ),
      ).toBe(true);
      expect(
        animate.mock.calls.some(
          ([frames]) =>
            JSON.stringify(frames).includes('"height":"28px"') &&
            JSON.stringify(frames).includes('"height":"0px"'),
        ),
      ).toBe(true);
      expect(
        animate.mock.calls.some(
          ([frames]) =>
            JSON.stringify(frames) === '[{"opacity":1},{"opacity":0}]',
        ),
      ).toBe(true);
    } finally {
      if (originalRect)
        Object.defineProperty(
          HTMLElement.prototype,
          "getBoundingClientRect",
          originalRect,
        );
      else
        delete (HTMLElement.prototype as Partial<HTMLElement>)
          .getBoundingClientRect;
      if (originalAnimate)
        Object.defineProperty(
          HTMLElement.prototype,
          "animate",
          originalAnimate,
        );
      else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
  });

  it("waits for a first directory read before expanding", async () => {
    let resolveDirectory:
      ((result: ListProjectDirectoryResult) => void) | undefined;
    const { wrapper } = mountTree(
      "read-write",
      () =>
        new Promise((resolve) => {
          resolveDirectory = resolve;
        }),
    );
    await wrapper.get('[data-path=""]').trigger("click");
    expect(wrapper.get('[data-path=""]').attributes("aria-expanded")).toBe(
      "false",
    );
    expect(wrapper.find('[data-slot="skeleton"]').exists()).toBe(false);
    resolveDirectory?.({
      entries: [{ name: "notes.md", relativePath: "notes.md", kind: "file" }],
    });
    await flushPromises();
    expect(wrapper.get('[data-path=""]').attributes("aria-expanded")).toBe(
      "true",
    );
    expect(wrapper.find('[data-path="notes.md"]').exists()).toBe(true);
    expect(wrapper.find('[data-slot="skeleton"]').exists()).toBe(false);
  });

  it("omits dot directories at every level, including previously expanded ones, while keeping dotfiles", async () => {
    localStorage.setItem(
      PROJECT_SIDEBAR_STORAGE_PREFIX + "p1",
      JSON.stringify({
        tab: "files",
        expanded: [
          `${folderId}:`,
          `${folderId}:.git`,
          `${folderId}:src`,
          `${folderId}:src/.cache`,
        ],
      }),
    );
    const { wrapper, listProjectDirectory } = mountTree(
      "read-write",
      ({ relativePath }) =>
        Promise.resolve({
          entries:
            relativePath === ""
              ? [
                  { name: ".git", relativePath: ".git", kind: "directory" },
                  { name: ".pine", relativePath: ".pine", kind: "directory" },
                  { name: "src", relativePath: "src", kind: "directory" },
                  { name: ".env", relativePath: ".env", kind: "file" },
                  {
                    name: ".gitignore",
                    relativePath: ".gitignore",
                    kind: "file",
                  },
                  ...[
                    ".DS_Store",
                    "Thumbs.db",
                    "desktop.ini",
                    "._notes.md",
                  ].map((name) => ({
                    name,
                    relativePath: name,
                    kind: "file" as const,
                  })),
                ]
              : [
                  {
                    name: ".cache",
                    relativePath: "src/.cache",
                    kind: "directory",
                  },
                  {
                    name: "main.ts",
                    relativePath: "src/main.ts",
                    kind: "file",
                  },
                  {
                    name: ".DS_Store",
                    relativePath: "src/.DS_Store",
                    kind: "file",
                  },
                ],
        }),
    );
    await flushPromises();
    expect(wrapper.find('[data-path=".git"]').exists()).toBe(false);
    expect(wrapper.find('[data-path=".pine"]').exists()).toBe(false);
    expect(wrapper.find('[data-path="src/.cache"]').exists()).toBe(false);
    expect(wrapper.find('[data-path=".env"]').exists()).toBe(true);
    expect(wrapper.find('[data-path=".gitignore"]').exists()).toBe(true);
    for (const path of [
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      "._notes.md",
      "src/.DS_Store",
    ]) {
      expect(wrapper.find(`[data-path="${path}"]`).exists()).toBe(false);
    }
    expect(wrapper.find('[data-path="src/main.ts"]').exists()).toBe(true);
    expect(
      listProjectDirectory.mock.calls.map(([request]) => request.relativePath),
    ).toEqual(["", "src"]);
  });

  it("opens a file on left click and reuses its tab without invoking an external app", async () => {
    const { wrapper, router, operateProjectFile } = mountTree();
    await expandRoot(wrapper);
    expect(useContentTabsStore().tabs).toHaveLength(1);
    await wrapper.get('[data-path="notes.md"]').trigger("click");
    await flushPromises();
    const tab = useContentTabsStore().tabs.find((tab) => tab.kind === "file");
    expect(tab).toMatchObject({
      projectId: "p1",
      folderId,
      relativePath: "notes.md",
    });
    expect(router.currentRoute.value.query.tab).toBe(tab?.id);
    await wrapper.get('[data-path="notes.md"]').trigger("click");
    await flushPromises();
    expect(useContentTabsStore().tabs).toHaveLength(2);
    expect(operateProjectFile).not.toHaveBeenCalled();
  });
  it("restores expanded folders without playing disclosure animations", async () => {
    localStorage.setItem(
      PROJECT_SIDEBAR_STORAGE_PREFIX + "p1",
      JSON.stringify({
        tab: "files",
        expanded: [`${folderId}:`],
      }),
    );
    const originalAnimate = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "animate",
    );
    const animate = vi.fn(() => ({
      addEventListener: vi.fn(),
      cancel: vi.fn(),
      finished: Promise.resolve(),
    }));
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    try {
      const { wrapper } = mountTree();
      expect(wrapper.find(".overflow-hidden").classes()).not.toContain(
        "transition-[height]",
      );
      expect(wrapper.get('[data-path=""] svg').classes()).not.toContain(
        "transition-transform",
      );

      await flushPromises();

      expect(animate).not.toHaveBeenCalled();
      expect(wrapper.find(".overflow-hidden").classes()).toContain(
        "transition-[height]",
      );
      expect(wrapper.get('[data-path=""] svg').classes()).toContain(
        "transition-transform",
      );
    } finally {
      if (originalAnimate)
        Object.defineProperty(
          HTMLElement.prototype,
          "animate",
          originalAnimate,
        );
      else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
  });
  it("restores expanded folders after remounting with a fresh store", async () => {
    const first = mountTree();
    await expandRoot(first.wrapper);
    await first.wrapper.get('[data-path="docs"]').trigger("click");
    await flushPromises();
    first.wrapper.unmount();
    wrappers.pop();
    const restored = mountTree();
    await flushPromises();
    expect(
      restored.wrapper.get('[data-path=""]').attributes("aria-expanded"),
    ).toBe("true");
    expect(restored.listProjectDirectory).toHaveBeenCalledWith({
      folderId: restored.folderId,
      projectId: "p1",
      relativePath: "docs",
    });
    expect(restored.wrapper.find('[data-path="notes.md"]').exists()).toBe(true);
    expect(restored.wrapper.find('[data-slot="skeleton"]').exists()).toBe(
      false,
    );
  });

  it.each([true, false])(
    "replaces nested skeletons after delayed reads with persisted root expansion %s",
    async (rootExpanded) => {
      localStorage.setItem(
        PROJECT_SIDEBAR_STORAGE_PREFIX + "p1",
        JSON.stringify({
          tab: "files",
          expanded: [
            ...(rootExpanded ? [`${folderId}:`] : []),
            `${folderId}:docs`,
            `${folderId}:docs/nested`,
          ],
        }),
      );
      const pending = new Map<
        string,
        (result: ListProjectDirectoryResult) => void
      >();
      const { wrapper, listProjectDirectory } = mountTree(
        "read-write",
        ({ relativePath }) =>
          new Promise((resolve) => pending.set(relativePath, resolve)),
      );
      if (!rootExpanded) await expandRoot(wrapper);
      pending.get("")!({
        entries: [{ name: "docs", relativePath: "docs", kind: "directory" }],
      });
      await flushPromises();
      if (rootExpanded) {
        expect(
          wrapper.get('[data-path="docs"]').attributes("aria-expanded"),
        ).toBe("true");
        expect(wrapper.find('[data-slot="skeleton"]').exists()).toBe(true);
      } else {
        expect(wrapper.get('[data-path=""]').attributes("aria-expanded")).toBe(
          "false",
        );
        expect(wrapper.find('[data-path="docs"]').exists()).toBe(false);
      }

      pending.get("docs")!({
        entries: [
          { name: "nested", relativePath: "docs/nested", kind: "directory" },
        ],
      });
      await flushPromises();
      if (rootExpanded) {
        expect(wrapper.find('[data-path="docs/nested"]').exists()).toBe(true);
        expect(wrapper.find('[data-slot="skeleton"]').exists()).toBe(true);
      } else {
        expect(wrapper.get('[data-path=""]').attributes("aria-expanded")).toBe(
          "false",
        );
      }

      pending.get("docs/nested")!({
        entries: [
          {
            name: "readme.md",
            relativePath: "docs/nested/readme.md",
            kind: "file",
          },
        ],
      });
      await flushPromises();
      expect(wrapper.find('[data-path="docs/nested/readme.md"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-slot="skeleton"]').exists()).toBe(false);
      expect(listProjectDirectory).toHaveBeenCalledTimes(3);
    },
  );

  it("drags an internal reference and moves it onto a folder", async () => {
    const {
      wrapper,
      folderId,
      operateProjectFile,
      listProjectDirectory,
      startProjectFileDrag,
    } = mountTree();
    await expandRoot(wrapper);
    const data = new Map<string, string>();
    const transfer = {
      types: [PROJECT_ENTRY_DRAG_TYPE],
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type),
      effectAllowed: "none",
      dropEffect: "none",
    };
    await wrapper
      .get('[data-path="notes.md"]')
      .trigger("dragstart", { dataTransfer: transfer });
    expect(transfer.effectAllowed).toBe("copyMove");
    expect(JSON.parse(data.get(PROJECT_ENTRY_DRAG_TYPE)!)).toEqual([
      { folderId, projectId: "p1", relativePath: "notes.md" },
    ]);
    expect(startProjectFileDrag).toHaveBeenCalledWith({
      folderId,
      projectId: "p1",
      relativePath: "notes.md",
    });
    await wrapper
      .get('[data-path="docs"]')
      .trigger("dragover", { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe("move");
    await wrapper
      .get('[data-path="docs"]')
      .trigger("drop", { dataTransfer: transfer });
    await flushPromises();
    expect(operateProjectFile).toHaveBeenCalledWith({
      action: "move",
      target: { folderId, projectId: "p1", relativePath: "docs" },
      sources: [{ folderId, projectId: "p1", relativePath: "notes.md" }],
    });
    expect(listProjectDirectory).toHaveBeenCalledWith({
      folderId,
      projectId: "p1",
      relativePath: "docs",
    });
  });

  it("moves external drops into the target folder", async () => {
    const { wrapper, folderId, operateProjectFile } = mountTree();
    await expandRoot(wrapper);
    await wrapper.get('[data-path="docs"]').trigger("drop", {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["data"], "notes.md")],
      },
    });
    await flushPromises();
    expect(operateProjectFile).toHaveBeenCalledWith({
      action: "move-external",
      target: { folderId, projectId: "p1", relativePath: "docs" },
      paths: ["/external/notes.md"],
    });
  });

  it("opens the shadcn menu and renames through the name dialog", async () => {
    const { wrapper, folderId, operateProjectFile } = mountTree();
    await expandRoot(wrapper);
    await wrapper
      .get('[data-path="notes.md"] [data-slot="context-menu-trigger"]')
      .trigger("contextmenu", { button: 2, clientX: 20, clientY: 20 });
    await flushPromises();
    expect(
      wrapper.get('[data-path="notes.md"]').attributes("data-context-open"),
    ).toBe("");
    expect(document.body.textContent).not.toContain("新建文件\n");
    await menuItem("重命名").trigger("click");
    await flushPromises();
    const input = new DOMWrapper(
      document.querySelector<HTMLInputElement>("#project-entry-name"),
    );
    await input.setValue("renamed.md");
    await new DOMWrapper(
      document.querySelector('[role="dialog"] form'),
    ).trigger("submit");
    await flushPromises();
    expect(operateProjectFile).toHaveBeenCalledWith({
      action: "rename",
      target: { folderId, projectId: "p1", relativePath: "notes.md" },
      name: "renamed.md",
    });
  });

  it("disables mutations and rejects drops in read-only folders while allowing attachment drags", async () => {
    const { wrapper, operateProjectFile } = mountTree("read-only");
    await expandRoot(wrapper);
    expect(wrapper.get('[data-path="notes.md"]').attributes("draggable")).toBe(
      "true",
    );
    const transfer = {
      types: ["Files"],
      files: [new File([], "notes.md")],
      dropEffect: "move",
    };
    await wrapper
      .get('[data-path="docs"]')
      .trigger("dragover", { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe("none");
    await wrapper
      .get('[data-path="docs"]')
      .trigger("drop", { dataTransfer: transfer });
    await wrapper
      .get('[data-path="notes.md"] [data-slot="context-menu-trigger"]')
      .trigger("contextmenu", { button: 2 });
    await flushPromises();
    expect(menuItem("重命名").attributes("data-disabled")).toBeDefined();
    expect(operateProjectFile).not.toHaveBeenCalled();
  });

  it("reloads affected directories when the file watcher reports changes", async () => {
    const { wrapper, folderId, listProjectDirectory, onProjectFilesChanged } =
      mountTree();
    await expandRoot(wrapper);
    listProjectDirectory.mockClear();
    const listener = onProjectFilesChanged.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");
    listener({ folders: [{ folderId, projectId: "p1", changedDirs: [""] }] });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();
    expect(listProjectDirectory).toHaveBeenCalledWith({
      folderId,
      projectId: "p1",
      relativePath: "",
    });
  });

  it("queues watcher events that arrive while a refresh is in flight", async () => {
    let watcherRead = 0;
    const releases: Array<() => void> = [];
    const { wrapper, listProjectDirectory, onProjectFilesChanged } = mountTree(
      "read-write",
      ({ relativePath }) => {
        if (relativePath || watcherRead === 0) {
          watcherRead += 1;
          return Promise.resolve({ entries: [] });
        }
        return new Promise((resolve) => {
          releases.push(() => resolve({ entries: [] }));
        });
      },
    );
    await expandRoot(wrapper);
    listProjectDirectory.mockClear();
    const listener = onProjectFilesChanged.mock.calls[0]?.[0];
    listener({ folders: [{ folderId, projectId: "p1", changedDirs: [""] }] });
    await flushPromises();
    listener({ folders: [{ folderId, projectId: "p1", changedDirs: [""] }] });
    expect(listProjectDirectory).toHaveBeenCalledTimes(1);
    releases.shift()?.();
    await flushPromises();
    expect(listProjectDirectory).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await flushPromises();
  });

  it("unsubscribes and clears the main-process watch set on unmount", () => {
    const {
      wrapper,
      setWatchedProjectDirectories,
      unsubscribeProjectFilesChanged,
    } = mountTree();
    wrapper.unmount();
    wrappers.pop();
    expect(unsubscribeProjectFilesChanged).toHaveBeenCalledOnce();
    expect(setWatchedProjectDirectories).toHaveBeenLastCalledWith({
      folders: [],
    });
  });

  it("lists a single-folder project's entries without a root row", async () => {
    const { wrapper, operateProjectFile } = mountTree(
      "read-write",
      undefined,
      false,
    );
    await flushPromises();

    expect(wrapper.find('[data-path=""]').exists()).toBe(false);
    expect(wrapper.find('[data-path="docs"]').exists()).toBe(true);
    expect(wrapper.find('[data-path="notes.md"]').exists()).toBe(true);

    // Dropping the project root somewhere is ignored rather than an error.
    const target = wrapper.get('[data-path="docs"]');
    const data = new Map<string, string>([
      [
        PROJECT_ENTRY_DRAG_TYPE,
        JSON.stringify([{ folderId, projectId: "p1", relativePath: "" }]),
      ],
    ]);
    await target.trigger("drop", {
      dataTransfer: {
        types: [PROJECT_ENTRY_DRAG_TYPE],
        getData: (type: string) => data.get(type) ?? "",
        files: [],
      },
    });
    await flushPromises();
    expect(operateProjectFile).not.toHaveBeenCalled();
  });
});
