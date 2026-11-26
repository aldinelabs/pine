import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { useSessionStore } from "@/stores/session";
import { useSessionUnreadStore } from "@/stores/sessionUnread";
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

    useSessionStore().stateFor(session.id).isRunning = true;
    await wrapper.vm.$nextTick();
    expect(title().classes()).toContain("shimmer");
    expect(title().attributes("data-running")).toBe("true");

    useSessionStore().stateFor(session.id).isRunning = false;
    await wrapper.vm.$nextTick();
    expect(title().classes()).not.toContain("shimmer");
  });

  it("shows running and unread in the indent column", async () => {
    const wrapper = mountItem(session, { depth: 1 });
    const status = () => wrapper.get('[data-slot="session-status"]');
    const label = () =>
      wrapper.get('[data-slot="sidebar-menu-sub-button"]').find(".sr-only");
    expect(status().attributes("data-status")).toBe("idle");
    expect(status().attributes("aria-hidden")).toBe("true");
    expect(label().exists()).toBe(false);
    // Outside the clipping button, so it can sit under the project icon.
    expect(
      wrapper
        .find(
          '[data-slot="sidebar-menu-sub-button"] [data-slot="session-status"]',
        )
        .exists(),
    ).toBe(false);

    const state = useSessionStore().stateFor(session.id);
    state.isRunning = true;
    await wrapper.vm.$nextTick();
    expect(status().attributes("data-status")).toBe("running");
    expect(label().text()).toBe("Running");

    // Running wins over an unread mark, then the mark shows once it ends.
    useSessionUnreadStore().markUnread(session.id);
    await wrapper.vm.$nextTick();
    expect(status().attributes("data-status")).toBe("running");
    state.isRunning = false;
    await wrapper.vm.$nextTick();
    expect(status().attributes("data-status")).toBe("unread");
    expect(label().text()).toBe("Unread");

    useSessionUnreadStore().markRead(session.id);
    await wrapper.vm.$nextTick();
    expect(status().attributes("data-status")).toBe("idle");
    expect(label().exists()).toBe(false);
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

  it("marks sessions WeChat started or used", () => {
    const marker = (item: ProjectSessionSearchResult) =>
      mountItem(item).find('[data-slot="session-wechat-origin"]');
    const started = marker({ ...session, origin: "wechat" });
    expect(started.attributes("aria-label")).toBe("From WeChat");
    expect(started.attributes("title")).toBe("From WeChat");
    expect(
      marker({ ...session, origin: "wechat-used" }).attributes("title"),
    ).toBe("Used from WeChat");
    expect(marker(session).exists()).toBe(false);
    // An automation run keeps its own icon.
    const run = mountItem({
      ...session,
      origin: "wechat",
      automationRun: {
        automationId: "a1",
        runId: "r1",
        name: "Daily summary",
        startedAt: "2026-11-03T09:05:00.000Z",
      },
    });
    expect(run.find('[data-slot="session-wechat-origin"]').exists()).toBe(
      false,
    );
    expect(run.find('[data-slot="session-automation-icon"]').exists()).toBe(
      true,
    );
  });

  it("marks sessions the Assistant dispatched", () => {
    const marker = (item: typeof session) =>
      mountItem(item).find('[data-slot="session-assistant-origin"]');
    expect(marker(session).exists()).toBe(false);
    expect(
      marker({ ...session, fromAssistant: true }).attributes("title"),
    ).toBe("From Orchestrator");
  });

  it("puts what waits on the user first in the indent column", async () => {
    const wrapper = mountItem();
    const status = () =>
      wrapper.get('[data-slot="session-status"]').attributes("data-status");
    const label = () =>
      wrapper.get('[data-slot="session-status-label"]').text();
    // The old end-of-row shield is gone.
    expect(
      wrapper.find('[data-slot="session-awaiting-approval"]').exists(),
    ).toBe(false);

    const state = useSessionStore().stateFor(session.id);
    useSessionUnreadStore().markUnread(session.id);
    state.isRunning = true;
    state.pendingQuestionnaires = [
      { requestId: "q1" } as (typeof state.pendingQuestionnaires)[number],
    ];
    await wrapper.vm.$nextTick();
    expect(status()).toBe("answer");
    expect(label()).toBe("Waiting for your answer");

    state.pendingApprovals = [
      { requestId: "r1" } as (typeof state.pendingApprovals)[number],
    ];
    await wrapper.vm.$nextTick();
    expect(status()).toBe("approval");
    expect(label()).toBe("Waiting for your approval");
    expect(
      wrapper.find('[data-slot="session-awaiting-approval"]').exists(),
    ).toBe(false);

    state.pendingApprovals = [];
    state.pendingQuestionnaires = [];
    await wrapper.vm.$nextTick();
    expect(status()).toBe("running");

    state.isRunning = false;
    await wrapper.vm.$nextTick();
    expect(status()).toBe("unread");
    useSessionUnreadStore().markRead(session.id);
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

  it("draws one tree line from the parent down to its last sub-session", async () => {
    const wrapper = mountItem(session, { subSessionCount: 3 });
    const line = () =>
      wrapper.get<HTMLElement>('[data-slot="session-tree-line"]').element;
    expect(line().style.height).toBe("0px");

    await wrapper.setProps({ expanded: true });
    expect(line().style.height).toBe("calc(3 * 2rem - 1.125rem)");

    const child = mountItem(session, { depth: 1 });
    expect(child.find('[data-slot="session-tree-line"]').exists()).toBe(false);
  });

  it("toggles sub-sessions when the open session's row is clicked again", async () => {
    const wrapper = mountItem(session, { subSessionCount: 2 });
    const row = wrapper.get('[data-slot="sidebar-menu-sub-button"]');

    await row.trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(wrapper.emitted("toggle")).toBeUndefined();

    await wrapper.setProps({ isActive: true });
    await row.trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("makes a row folding out of the list unreachable", async () => {
    const wrapper = mountItem();
    expect(wrapper.attributes("inert")).toBeUndefined();
    await wrapper.setProps({ motion: "leave" });
    expect(wrapper.attributes("inert")).toBeDefined();
    expect(wrapper.classes()).toContain("pointer-events-none");
  });
});
