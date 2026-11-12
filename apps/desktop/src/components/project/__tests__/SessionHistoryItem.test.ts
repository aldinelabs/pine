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

function mountItem(
  item: ProjectSessionSearchResult = session,
  extra: Record<string, unknown> = {},
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(SessionHistoryItem, {
    props: {
      groups: [],
      isActive: false,
      session: item,
      title: "Fix bug",
      ...extra,
    },
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

  it("marks a session waiting for the user's approval", async () => {
    const wrapper = mountItem();
    const marker = () =>
      wrapper.find('[data-slot="session-awaiting-approval"]');
    expect(marker().exists()).toBe(false);

    const state = useSessionStore().stateFor(session.id);
    state.isRunning = true;
    state.pendingApprovals = [
      { requestId: "r1" } as (typeof state.pendingApprovals)[number],
    ];
    await wrapper.vm.$nextTick();
    expect(marker().attributes("aria-label")).toBe("Waiting for your approval");
    // The approval marker takes the running dot's place.
    expect(wrapper.find('[data-slot="session-running-dot"]').exists()).toBe(
      false,
    );

    state.pendingApprovals = [];
    await wrapper.vm.$nextTick();
    expect(marker().exists()).toBe(false);
  });

  it("toggles sub-sessions from the chevron and the arrow keys", async () => {
    const wrapper = mountItem(session, { subSessionCount: 2 });
    const row = wrapper.get('[data-slot="sidebar-menu-sub-button"]');
    const chevron = wrapper.get('[data-slot="session-sub-sessions-toggle"]');

    expect(row.attributes("aria-expanded")).toBe("false");
    expect(chevron.attributes("title")).toBe("Show sub-sessions (2)");
    await chevron.trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
    expect(wrapper.emitted("open")).toBeUndefined();

    await row.trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.emitted("toggle")).toHaveLength(1);
    await row.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("toggle")).toHaveLength(2);

    await wrapper.setProps({ expanded: true });
    expect(row.attributes("aria-expanded")).toBe("true");
    expect(chevron.get("svg").classes()).toContain("rotate-90");
  });

  it("ends the tree line at the last sub-session", async () => {
    const wrapper = mountItem(session, { depth: 1 });
    const line = () => wrapper.get('[data-slot="session-tree-line"]');
    expect(line().classes()).toContain("-bottom-0.5");
    await wrapper.setProps({ lastSubSession: true });
    expect(line().classes()).toContain("rounded-es-lg");
    expect(
      wrapper.find('[data-slot="session-sub-sessions-toggle"]').exists(),
    ).toBe(false);
  });
});
