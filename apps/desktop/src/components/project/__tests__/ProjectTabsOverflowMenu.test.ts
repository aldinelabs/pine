import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { ASSISTANT_PROJECT_ID } from "@/shared/assistant";
import { useSessionStore } from "@/stores/session";
import ProjectTabsOverflowMenu from "../ProjectTabsOverflowMenu.vue";

const activeTab = vi.hoisted(() => {
  const ref: { value: object | null } = { value: null };
  return ref;
});
vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({
    activeTab,
    close: vi.fn(),
    removeSession: vi.fn(),
  }),
}));
vi.mock("@/composables/useSessionExport", () => ({
  useSessionExport: () => ({ exportSession: vi.fn() }),
}));
vi.mock("@/composables/useProjectFileChanges", () => ({
  useProjectFileChanges: () => ({ emitProjectFilesChanged: vi.fn() }),
}));

function mountMenu(projectId: string) {
  activeTab.value = {
    id: "t",
    kind: "session",
    state: "bound",
    projectId,
    sessionId: "s1",
  };
  const pinia = createTestingPinia({ createSpy: vi.fn });
  const sessions = useSessionStore(pinia);
  vi.mocked(sessions.recentSessionsFor).mockReturnValue([
    {
      id: "s1",
      createdAt: "2026-11-26T00:00:00.000Z",
      messageCount: 1,
      updatedAt: "2026-11-26T00:00:00.000Z",
    },
  ]);
  return mount(ProjectTabsOverflowMenu, {
    attachTo: document.body,
    global: { plugins: [createAppI18n("en-US"), pinia] },
  });
}

async function openMenu(wrapper: ReturnType<typeof mountMenu>) {
  const trigger = wrapper.get('button[aria-label="More actions"]');
  await trigger.trigger("pointerdown", { button: 0, ctrlKey: false });
  await trigger.trigger("keydown", { key: "Enter" });
  await flushPromises();
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) =>
    item.textContent?.trim(),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ProjectTabsOverflowMenu", () => {
  it("offers Delete for a session tab", async () => {
    const wrapper = mountMenu("p1");
    expect(await openMenu(wrapper)).toEqual([
      "Rename conversation",
      "Export conversation",
      "Delete conversation",
    ]);
    wrapper.unmount();
  });

  it("offers Clear conversation, confirmed with Clear, in the Assistant's tab", async () => {
    const wrapper = mountMenu(ASSISTANT_PROJECT_ID);
    expect(await openMenu(wrapper)).toEqual([
      "Export conversation",
      "Clear conversation",
    ]);
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (entry) => entry.textContent?.trim() === "Clear conversation",
    );
    await new DOMWrapper(item).trigger("click");
    await flushPromises();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain(
      "Clear the Assistant's conversation?",
    );
    expect(dialog?.textContent).toContain("Its notes in Memory are kept.");
    const buttons = [...(dialog?.querySelectorAll("button") ?? [])].map(
      (button) => button.textContent?.trim(),
    );
    expect(buttons).toEqual(["Cancel", "Clear"]);
    wrapper.unmount();
  });
});
