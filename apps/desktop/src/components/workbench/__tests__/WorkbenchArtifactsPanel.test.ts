import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UI_PRESENT_FILE_TOOL_NAME } from "@/shared/agent";
import type { FilePreviewTarget } from "@/shared/projectFiles";
import { showProject } from "@/stores/__tests__/showProject";
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

function mountPanel(
  target: FilePreviewTarget = projectTarget,
  access: "read-only" | "read-write" = "read-write",
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
  session.messages = [
    {
      createdAt: "2026-10-31T00:00:00.000Z",
      id: "m1",
      role: "assistant",
      status: "complete",
      blocks: [
        {
          type: "toolCall",
          toolCall: {
            id: "present-1",
            name: UI_PRESENT_FILE_TOOL_NAME,
            input: { path: "/project/out/report.md" },
            status: "complete",
          },
        },
      ],
    },
  ];
  const operateProjectFile = vi.fn(() => Promise.resolve());
  const operatePresentedFile = vi.fn(() => Promise.resolve());
  const reopenPresentedToolFile = vi.fn(() => Promise.resolve(target));
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      platform: "darwin",
      operateProjectFile,
      operatePresentedFile,
      reopenPresentedToolFile,
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
  return { wrapper, operateProjectFile, operatePresentedFile };
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

  it("disables changes in read-only project folders", async () => {
    const { wrapper } = mountPanel(projectTarget, "read-only");
    await openMenu(wrapper);
    expect(menuItem("重命名").attributes("data-disabled")).toBeDefined();
  });
});
