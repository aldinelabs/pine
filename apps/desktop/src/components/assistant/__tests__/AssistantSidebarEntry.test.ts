import { flushPromises, mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ASSISTANT_PROJECT_ID } from "@/shared/assistant";
import { useAssistantStore } from "@/stores/assistant";
import { useSessionStore } from "@/stores/session";
import AssistantSidebarEntry from "../AssistantSidebarEntry.vue";

const openAssistant = vi.hoisted(() => vi.fn());
const activeTab = vi.hoisted(() => {
  const ref: { value: object | null } = { value: null };
  return ref;
});
vi.mock("@/composables/useAssistantEntry", () => ({
  useAssistantEntry: () => ({ openAssistant }),
}));
vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({ activeTab }),
}));

function mountEntry(
  prepare: (sessions: ReturnType<typeof useSessionStore>) => void = () => {},
) {
  const pinia = createTestingPinia({ createSpy: vi.fn });
  const assistant = useAssistantStore(pinia);
  vi.mocked(assistant.load).mockResolvedValue({
    settings: assistant.settings,
  });
  const sessions = useSessionStore(pinia);
  prepare(sessions);
  const wrapper = mount(
    {
      components: { SidebarProvider, AssistantSidebarEntry },
      template:
        "<SidebarProvider><ul><AssistantSidebarEntry /></ul></SidebarProvider>",
    },
    { global: { plugins: [createAppI18n("zh-CN"), pinia] } },
  );
  return { wrapper, assistant };
}

describe("AssistantSidebarEntry", () => {
  it("opens the Assistant from above every project", async () => {
    activeTab.value = null;
    const { wrapper, assistant } = mountEntry();
    await flushPromises();

    const entry = wrapper.get('[data-testid="assistant-entry"]');
    expect(entry.text()).toBe("助理");
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
      projectId: ASSISTANT_PROJECT_ID,
      sessionId: "s1",
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
});
