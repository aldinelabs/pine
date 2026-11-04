import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { useSessionStore } from "@/stores/session";
import SessionHistoryItem from "../SessionHistoryItem.vue";

const session = {
  id: "session-1",
  projectId: "p1",
} as unknown as ProjectSessionSearchResult;

function mountItem(item: ProjectSessionSearchResult = session) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(SessionHistoryItem, {
    props: { groups: [], isActive: false, session: item, title: "Fix bug" },
    global: {
      plugins: [pinia, createAppI18n("en-US")],
      stubs: { SessionContextMenu: { template: "<div><slot /></div>" } },
    },
  });
  return wrapper;
}

describe("SessionHistoryItem", () => {
  it("shimmers the title while the session is running", async () => {
    const wrapper = mountItem();
    const title = () => wrapper.get('[data-slot="session-title"]');
    expect(title().classes()).not.toContain("shimmer");
    expect(wrapper.find('[data-slot="session-running-dot"]').exists()).toBe(
      false,
    );

    useSessionStore().stateFor(session.id).isRunning = true;
    await wrapper.vm.$nextTick();
    expect(title().classes()).toContain("shimmer");
    expect(title().attributes("data-running")).toBe("true");
    expect(wrapper.find('[data-slot="session-running-dot"]').exists()).toBe(
      true,
    );

    useSessionStore().stateFor(session.id).isRunning = false;
    await wrapper.vm.$nextTick();
    expect(title().classes()).not.toContain("shimmer");
  });

  it("shows when an automation run started", () => {
    const wrapper = mountItem({
      ...session,
      automationRun: {
        automationId: "a1",
        runId: "r1",
        name: "Daily summary",
        startedAt: "2026-11-03T09:05:00.000Z",
      },
    });
    expect(wrapper.find('[data-slot="session-automation-icon"]').exists()).toBe(
      true,
    );
    expect(wrapper.get('[data-slot="session-automation-time"]').text()).toMatch(
      /11\/3/,
    );
    expect(
      mountItem().find('[data-slot="session-automation-time"]').exists(),
    ).toBe(false);
  });
});
