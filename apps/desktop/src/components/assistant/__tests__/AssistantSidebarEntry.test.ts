import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import { useAssistantStore } from "@/stores/assistant";
import { useSessionStore } from "@/stores/session";
import AssistantSidebarEntry from "../AssistantSidebarEntry.vue";

const openAssistant = vi.hoisted(() => vi.fn());
const removeSession = vi.hoisted(() => vi.fn());
const activeTab = vi.hoisted(() => {
  const ref: { value: object | null } = { value: null };
  return ref;
});
vi.mock("@/composables/useAssistantEntry", () => ({
  useAssistantEntry: () => ({ openAssistant }),
}));
vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({ activeTab, removeSession }),
}));

function mountEntry(
  prepare: (
    sessions: ReturnType<typeof useSessionStore>,
    assistant: ReturnType<typeof useAssistantStore>,
  ) => void = () => {},
) {
  const pinia = createTestingPinia({ createSpy: vi.fn });
  const assistant = useAssistantStore(pinia);
  vi.mocked(assistant.load).mockResolvedValue({});
  const sessions = useSessionStore(pinia);
  prepare(sessions, assistant);
  const wrapper = mount(
    {
      components: { SidebarProvider, AssistantSidebarEntry },
      template:
        "<SidebarProvider><ul><AssistantSidebarEntry /></ul></SidebarProvider>",
    },
    {
      attachTo: document.body,
      global: { plugins: [createAppI18n("zh-CN"), pinia] },
    },
  );
  return { wrapper, assistant };
}

describe("AssistantSidebarEntry", () => {
  it("opens the Assistant from above every project", async () => {
    activeTab.value = null;
    const { wrapper, assistant } = mountEntry();
    await flushPromises();

    const entry = wrapper.get('[data-testid="assistant-entry"]');
    expect(entry.text()).toBe("指挥中心");
    expect(assistant.load).toHaveBeenCalled();
    await entry.trigger("click");
    expect(openAssistant).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("shows when its conversation waits for the user", async () => {
    activeTab.value = {
      id: "t",
      kind: "session",
      state: "bound",
      projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
      sessionId: "s1",
      orchestrator: true,
    };
    const { wrapper } = mountEntry((sessions) => {
      vi.mocked(sessions.isSessionAwaitingApproval).mockImplementation(
        (id) => id === "s1",
      );
    });
    await flushPromises();

    const entry = wrapper.get('[data-testid="assistant-entry"]');
    expect(entry.attributes("data-status")).toBe("approval");
    expect(entry.attributes("data-active")).toBe("true");
    expect(entry.find('[data-slot="assistant-entry-waiting"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("clears its conversation from the right-click menu, in its own words", async () => {
    activeTab.value = {
      id: "t",
      kind: "session",
      state: "bound",
      projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
      sessionId: "s1",
      orchestrator: true,
    };
    const { wrapper } = mountEntry((_sessions, assistant) => {
      assistant.session = {
        id: "s1",
        createdAt: "2026-11-26T00:00:00.000Z",
        messageCount: 2,
        updatedAt: "2026-11-26T00:00:00.000Z",
        orchestrator: true,
      };
    });
    await flushPromises();

    await wrapper
      .get('[data-slot="context-menu-trigger"]')
      .trigger("contextmenu", { button: 2, clientX: 10, clientY: 10 });
    await flushPromises();
    const item = document.querySelector<HTMLElement>(
      '[data-testid="assistant-entry-clear"]',
    );
    expect(item?.textContent?.trim()).toBe("清空对话");
    expect(document.body.textContent).not.toContain("删除");
    await new DOMWrapper(item).trigger("click");
    await flushPromises();

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("清空指挥中心的对话？");
    expect(dialog?.textContent).toContain("不再向这里汇报");
    expect(dialog?.textContent).toContain("笔记会保留");
    const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "清空",
    );
    expect(confirm).toBeDefined();
    await new DOMWrapper(confirm).trigger("click");
    await flushPromises();
    expect(useSessionStore().deleteSession).toHaveBeenCalledWith("s1");
    expect(removeSession).toHaveBeenCalledWith("s1");
    wrapper.unmount();
  });
});
