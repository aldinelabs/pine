import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PROJECT_ENTRY_DRAG_TYPE } from "@/lib/projectFileDrag";
import { UI_PRESENT_FILE_TOOL_NAME } from "@/shared/agent";
import type { FilePreviewTarget } from "@/shared/projectFiles";
import type { PineToolCall } from "@/shared/sessions";
import { showProject } from "@/stores/__tests__/showProject";
import { useArtifactVersionStore } from "@/stores/artifactVersions";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";
import WorkbenchArtifactsPanel from "../WorkbenchArtifactsPanel.vue";

const folderId = "cde9a86c-7632-43ac-96d6-c41ddeddce0e";
const projectTarget: FilePreviewTarget = {
  source: "project",
  folderId,
  projectId: "p1",
  relativePath: "out/report.md",
};
const wrappers: ReturnType<typeof mount>[] = [];

const legacyPresentation: PineToolCall = {
  id: "present-1",
  name: UI_PRESENT_FILE_TOOL_NAME,
  input: { path: "/project/out/report.md" },
  status: "complete",
};

function presentation(id: string, path: string): PineToolCall {
  return {
    id,
    name: UI_PRESENT_FILE_TOOL_NAME,
    input: { path },
    output: { details: { path, display: "sidebar", artifact: false } },
    status: "complete",
  };
}

const storedSnapshot = {
  status: "stored",
  integrity: "sha512-abc",
  size: 10,
  mtimeMs: 1,
  time: 1,
};

function submission(
  id: string,
  files: {
    path: string;
    title?: string;
    description?: string;
    folder?: string;
    snapshot?: typeof storedSnapshot;
  }[],
): PineToolCall {
  return {
    id,
    name: "ui_submit_artifact",
    input: { files },
    output: {
      details: {
        files: files.map((file) => ({ ...file, requestedPath: file.path })),
        rejected: [],
      },
    },
    status: "complete",
  };
}

function message(id: string, calls: PineToolCall[]) {
  return {
    createdAt: "2026-10-31T00:00:00.000Z",
    id,
    role: "assistant" as const,
    status: "complete" as const,
    blocks: calls.map((toolCall) => ({ type: "toolCall" as const, toolCall })),
  };
}

function mountPanel(
  target: FilePreviewTarget = projectTarget,
  access: "read-only" | "read-write" = "read-write",
  calls: PineToolCall[][] = [[legacyPresentation]],
) {
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
    ],
  });
  const session = useSessionStore();
  session.activeSession = {
    id: "s1",
    createdAt: "",
    updatedAt: "",
    messageCount: 1,
  };
  session.messages = calls.map((list, index) => message(`m${index + 1}`, list));
  const operateProjectFile = vi.fn(() => Promise.resolve());
  const operatePresentedFile = vi.fn(() => Promise.resolve());
  const reopenPresentedToolFile = vi.fn(() => Promise.resolve(target));
  const startProjectFileDrag = vi.fn();
  const startPresentedFileDrag = vi.fn();
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      platform: "darwin",
      operateProjectFile,
      operatePresentedFile,
      reopenPresentedToolFile,
      startProjectFileDrag,
      startPresentedFileDrag,
    },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
  });
  const Host = defineComponent(
    () => () =>
      h(TooltipProvider, () =>
        h(SidebarProvider, () => h(WorkbenchArtifactsPanel)),
      ),
  );
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n("zh-CN")] },
  });
  wrappers.push(wrapper);
  return {
    wrapper,
    operateProjectFile,
    operatePresentedFile,
    reopenPresentedToolFile,
    startProjectFileDrag,
    startPresentedFileDrag,
  };
}

function rowTexts(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-testid="workbench-artifact"]:not([data-motion])')
    .map((row) => row.text());
}

function menuItem(text: string) {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (element) => element.textContent?.includes(text),
  );
  if (!item) throw new Error(`Missing menu item: ${text}`);
  return new DOMWrapper(item);
}

async function openMenu(wrapper: ReturnType<typeof mount>) {
  await wrapper
    .get(
      '[data-testid="workbench-artifact"] [data-slot="context-menu-trigger"]',
    )
    .trigger("contextmenu", { button: 2, clientX: 20, clientY: 20 });
  await flushPromises();
}

describe("WorkbenchArtifactsPanel", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = "";
  });

  it("reveals a presented file through its resolved target", async () => {
    const { wrapper, operateProjectFile } = mountPanel();
    await openMenu(wrapper);
    await menuItem("在文件管理器中显示").trigger("click");
    await flushPromises();
    expect(operateProjectFile).toHaveBeenCalledWith({
      action: "reveal",
      target: { folderId, projectId: "p1", relativePath: "out/report.md" },
    });
  });

  it("renames a project file and lists it under its new name", async () => {
    const { wrapper, operateProjectFile } = mountPanel();
    await openMenu(wrapper);
    await menuItem("重命名").trigger("click");
    await flushPromises();
    const input = new DOMWrapper(
      document.querySelector<HTMLInputElement>("#workbench-artifact-name"),
    );
    expect(input.element.value).toBe("report.md");
    await input.setValue("summary.md");
    await new DOMWrapper(
      document.querySelector('[role="dialog"] form'),
    ).trigger("submit");
    await flushPromises();
    expect(operateProjectFile).toHaveBeenCalledWith({
      action: "rename",
      target: { folderId, projectId: "p1", relativePath: "out/report.md" },
      name: "summary.md",
    });
    expect(wrapper.text()).toContain("summary.md");
    expect(useContentTabsStore().presentedTargetFor("present-1")).toEqual({
      ...projectTarget,
      relativePath: "out/summary.md",
    });
  });

  it("moves a file to the trash and drops it from the list and preview", async () => {
    const { wrapper, operateProjectFile } = mountPanel();
    const workbench = useWorkbenchStore();
    workbench.preview({ target: projectTarget, toolCallId: "present-1" });
    await openMenu(wrapper);
    await menuItem("移到废纸篓").trigger("click");
    await flushPromises();
    const confirm = [
      ...document.querySelectorAll('[role="alertdialog"] button'),
    ].find((button) => button.textContent?.includes("移到废纸篓"));
    if (!confirm) throw new Error("Missing trash confirmation");
    await new DOMWrapper(confirm).trigger("click");
    await flushPromises();
    expect(operateProjectFile).toHaveBeenCalledWith({
      action: "trash",
      target: { folderId, projectId: "p1", relativePath: "out/report.md" },
    });
    expect(wrapper.find('[data-testid="workbench-artifact"]').exists()).toBe(
      false,
    );
    expect(workbench.activeLayout.preview).toBeNull();
  });

  it("keeps files outside the project read-only", async () => {
    const { wrapper, operatePresentedFile } = mountPanel({
      source: "presented",
      path: "/tmp/outside.md",
    });
    await openMenu(wrapper);
    expect(menuItem("重命名").attributes("data-disabled")).toBeDefined();
    expect(menuItem("移到废纸篓").attributes("data-disabled")).toBeDefined();
    await menuItem("复制路径").trigger("click");
    await flushPromises();
    expect(operatePresentedFile).toHaveBeenCalledWith({
      action: "copy-path",
      path: "/tmp/outside.md",
    });
  });

  it("drags a project file out as a tree entry and a native file", async () => {
    const { wrapper, reopenPresentedToolFile, startProjectFileDrag } =
      mountPanel();
    const button = wrapper.get('[data-testid="workbench-artifact"] button');
    expect(button.attributes("draggable")).toBe("true");
    await button.trigger("pointerdown", { button: 0 });
    await button.trigger("click");
    await flushPromises();
    expect(reopenPresentedToolFile).toHaveBeenCalledTimes(1);
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "uninitialized",
      setData: (type: string, value: string) => data.set(type, value),
    };
    const event = new Event("dragstart", { cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    button.element.dispatchEvent(event);
    const reference = {
      folderId,
      projectId: "p1",
      relativePath: "out/report.md",
    };
    expect(JSON.parse(data.get(PROJECT_ENTRY_DRAG_TYPE) ?? "")).toEqual([
      reference,
    ]);
    expect(event.defaultPrevented).toBe(true);
    expect(startProjectFileDrag).toHaveBeenCalledWith(reference);
  });

  it("drags a presented file outside the project once it resolves", async () => {
    const { wrapper, startPresentedFileDrag, startProjectFileDrag } =
      mountPanel({ source: "presented", path: "/tmp/outside.md" });
    const button = wrapper.get('[data-testid="workbench-artifact"] button');
    const event = new Event("dragstart", { cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { setData: vi.fn() },
    });
    button.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await flushPromises();
    expect(startPresentedFileDrag).toHaveBeenCalledWith({
      path: "/tmp/outside.md",
    });
    expect(startProjectFileDrag).not.toHaveBeenCalled();
  });

  it("disables changes in read-only project folders", async () => {
    const { wrapper } = mountPanel(projectTarget, "read-only");
    await openMenu(wrapper);
    expect(menuItem("重命名").attributes("data-disabled")).toBeDefined();
  });

  it("shows the empty state when the agent only presented files", () => {
    const { wrapper } = mountPanel(projectTarget, "read-write", [
      [presentation("present-2", "/project/out/step.md")],
    ]);
    expect(wrapper.find('[data-testid="workbench-artifact"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain(
      "Pine 在此对话中提交的产出文件会出现在这里。",
    );
  });

  it("lists submitted files with their titles and descriptions, newest batch first", () => {
    const { wrapper } = mountPanel(projectTarget, "read-write", [
      [legacyPresentation],
      [
        submission("submit-1", [
          { path: "/project/out/report.md", title: "Report" },
          { path: "/project/out/data.csv", description: "Raw numbers" },
        ]),
      ],
      [
        submission("submit-2", [{ path: "/project/out/chart.png" }]),
        presentation("present-3", "/project/out/compare.md"),
      ],
    ]);
    expect(rowTexts(wrapper)).toEqual([
      "chart.png",
      "Report",
      "data.csvRaw numbers",
    ]);
    expect(
      wrapper.find('[data-testid="workbench-artifact-description"]').text(),
    ).toBe("Raw numbers");
  });

  it("reopens a submitted file by its path and previews it as that artifact", async () => {
    const { wrapper, reopenPresentedToolFile } = mountPanel(
      projectTarget,
      "read-write",
      [[submission("submit-1", [{ path: "/project/out/report.md" }])]],
    );
    await wrapper
      .get('[data-testid="workbench-artifact"] button')
      .trigger("click");
    await flushPromises();
    expect(reopenPresentedToolFile).toHaveBeenCalledWith({
      projectId: "p1",
      sessionId: "s1",
      toolCallId: "submit-1",
      path: "/project/out/report.md",
    });
    expect(useWorkbenchStore().activeLayout.preview).toEqual({
      target: projectTarget,
      toolCallId: "submit-1",
      path: "/project/out/report.md",
      artifactPath: "/project/out/report.md",
    });
    expect(
      wrapper
        .get('[data-testid="workbench-artifact"] button')
        .attributes("data-active"),
    ).toBeDefined();
  });

  it("marks the submitted file the agent presented in parallel", async () => {
    const { wrapper } = mountPanel(projectTarget, "read-write", [
      [
        submission("submit-1", [
          { path: "/project/out/report.md" },
          { path: "/project/out/data.csv" },
        ]),
        presentation("present-1", "/project/out/data.csv"),
      ],
    ]);
    // As useWorkbenchEvents stores the present-file event.
    useWorkbenchStore().preview({
      target: { ...projectTarget, relativePath: "out/data.csv" },
      toolCallId: "present-1",
      path: "/project/out/data.csv",
    });
    await flushPromises();
    const rows = wrapper.findAll('[data-testid="workbench-artifact"] button');
    expect(rows.map((row) => row.attributes("data-active"))).toEqual([
      undefined,
      "true",
    ]);
  });

  it("renames and trashes a submitted file under its artifact key", async () => {
    const key = "submit-1\n/project/out/report.md";
    const { wrapper } = mountPanel(projectTarget, "read-write", [
      [submission("submit-1", [{ path: "/project/out/report.md" }])],
    ]);
    await openMenu(wrapper);
    await menuItem("重命名").trigger("click");
    await flushPromises();
    const input = new DOMWrapper(
      document.querySelector<HTMLInputElement>("#workbench-artifact-name"),
    );
    await input.setValue("summary.md");
    await new DOMWrapper(
      document.querySelector('[role="dialog"] form'),
    ).trigger("submit");
    await flushPromises();
    const contentTabs = useContentTabsStore();
    expect(contentTabs.presentedTargetFor(key)).toEqual({
      ...projectTarget,
      relativePath: "out/summary.md",
    });

    await openMenu(wrapper);
    await menuItem("移到废纸篓").trigger("click");
    await flushPromises();
    const confirm = [
      ...document.querySelectorAll('[role="alertdialog"] button'),
    ].find((button) => button.textContent?.includes("移到废纸篓"));
    if (!confirm) throw new Error("Missing trash confirmation");
    await new DOMWrapper(confirm).trigger("click");
    await flushPromises();
    expect(contentTabs.isPresentationRemoved(key)).toBe(true);
    expect(wrapper.find('[data-testid="workbench-artifact"]').exists()).toBe(
      false,
    );
  });

  it("keeps the same list when a later message streams without artifacts", async () => {
    const { wrapper } = mountPanel(projectTarget, "read-write", [
      [submission("submit-1", [{ path: "/project/out/report.md" }])],
    ]);
    const panel = wrapper.findComponent(WorkbenchArtifactsPanel);
    const before = (panel.vm as unknown as { artifacts: unknown[] }).artifacts;
    const session = useSessionStore();
    session.messages = [
      ...session.messages,
      message("m2", [presentation("present-2", "/project/out/step.md")]),
    ];
    await flushPromises();
    session.messages = [
      session.messages[0],
      message("m2", [presentation("present-2", "/project/out/step.md")]),
    ];
    await flushPromises();
    expect((panel.vm as unknown as { artifacts: unknown[] }).artifacts).toBe(
      before,
    );
  });

  it("opens the preview with its version menu from Version history", async () => {
    const { wrapper } = mountPanel(projectTarget, "read-write", [
      [submission("submit-2", [{ path: "/project/out/report.md" }])],
    ]);
    await openMenu(wrapper);
    await menuItem("版本历史").trigger("click");
    await flushPromises();

    expect(useWorkbenchStore().activeLayout.preview).toMatchObject({
      target: projectTarget,
      artifactPath: "/project/out/report.md",
    });
    expect(useArtifactVersionStore().viewOf("workbench:s1")).toMatchObject({
      source: {
        projectId: "p1",
        sessionId: "s1",
        path: "/project/out/report.md",
      },
      menuRequested: true,
    });
  });

  it("shows how many versions a file kept", async () => {
    const { wrapper } = mountPanel(projectTarget, "read-write", [
      [
        submission("submit-1", [
          { path: "/project/out/report.md", snapshot: storedSnapshot },
        ]),
      ],
      [
        submission("submit-2", [
          { path: "/project/out/report.md", snapshot: storedSnapshot },
        ]),
      ],
    ]);
    await flushPromises();

    expect(
      wrapper.get('[data-testid="workbench-artifact-version-count"]').text(),
    ).toContain("2");
  });

  it("lists filed artifacts in folders and remembers collapsed ones", async () => {
    const calls = [
      [
        submission("submit-1", [
          { path: "/project/out/week1.md", folder: "Reports/Week 1" },
          { path: "/project/out/data.csv", folder: "Data" },
          { path: "/project/out/notes.md" },
        ]),
      ],
    ];
    const folderNames = (wrapper: ReturnType<typeof mount>) =>
      wrapper
        .findAll(
          '[data-testid="workbench-artifact-folder"]:not([data-motion]) [data-testid="workbench-artifact-folder-name"]',
        )
        .map((name) => name.text());
    const { wrapper } = mountPanel(projectTarget, "read-write", calls);
    expect(folderNames(wrapper)).toEqual(["Reports", "Week 1", "Data"]);
    expect(rowTexts(wrapper)).toEqual(["week1.md", "data.csv", "notes.md"]);

    const reports = wrapper.findAll(
      '[data-testid="workbench-artifact-folder"] button',
    )[0];
    expect(reports.attributes("aria-expanded")).toBe("true");
    await reports.trigger("click");
    expect(folderNames(wrapper)).toEqual(["Reports", "Data"]);
    expect(rowTexts(wrapper)).toEqual(["data.csv", "notes.md"]);

    wrapper.unmount();
    const remounted = mountPanel(projectTarget, "read-write", calls).wrapper;
    expect(folderNames(remounted)).toEqual(["Reports", "Data"]);
    expect(
      remounted
        .findAll('[data-testid="workbench-artifact-folder"] button')[0]
        .attributes("aria-expanded"),
    ).toBe("false");
  });

  it("folds rows in and out as artifacts change, but not on load or a session switch", async () => {
    const animate = vi.spyOn(HTMLElement.prototype, "animate");
    const first = submission("submit-1", [
      { path: "/project/out/a.md" },
      { path: "/project/out/b.md" },
    ]);
    const { wrapper } = mountPanel(projectTarget, "read-write", [[first]]);
    await flushPromises();
    expect(animate).not.toHaveBeenCalled();

    const session = useSessionStore();
    // Resubmitting b.md moves it to the top: it folds out below a.md.
    session.messages = [
      message("m1", [first]),
      message("m2", [submission("submit-2", [{ path: "/project/out/b.md" }])]),
    ];
    await flushPromises();
    expect(
      wrapper
        .findAll('[data-testid="workbench-artifact"]')
        .map((row) => `${row.attributes("data-motion") ?? ""}${row.text()}`),
    ).toEqual(["b.md", "a.md", "leaveb.md"]);
    const ghost = wrapper.get(
      '[data-testid="workbench-artifact"][data-motion]',
    );
    expect(ghost.attributes("inert")).toBeDefined();
    expect(animate).toHaveBeenCalledTimes(2);

    animate.mockClear();
    session.activeSession = {
      id: "s2",
      createdAt: "",
      updatedAt: "",
      messageCount: 1,
    };
    session.messages = [
      message("m1", [submission("submit-3", [{ path: "/project/out/c.md" }])]),
    ];
    await flushPromises();
    expect(animate).not.toHaveBeenCalled();
    expect(rowTexts(wrapper)).toEqual(["c.md"]);
    expect(wrapper.find("[data-motion]").exists()).toBe(false);

    // An earlier transcript page arrives with older artifacts.
    session.isLoadingMessages = true;
    session.messages = [
      message("m0", [
        submission("submit-0", [{ path: "/project/out/old.md" }]),
      ]),
      ...session.messages,
    ];
    session.isLoadingMessages = false;
    await flushPromises();
    expect(rowTexts(wrapper)).toEqual(["c.md", "old.md"]);
    expect(animate).not.toHaveBeenCalled();
  });

  it("offers no version history for a legacy presentation", async () => {
    const { wrapper } = mountPanel();
    await openMenu(wrapper);

    expect(
      [...document.querySelectorAll('[role="menuitem"]')].some((item) =>
        item.textContent?.includes("版本历史"),
      ),
    ).toBe(false);
  });
});
