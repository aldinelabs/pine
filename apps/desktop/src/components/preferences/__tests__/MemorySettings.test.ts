import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PineMemorySummary } from "@/shared/memory";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import MemorySettings from "../MemorySettings.vue";

const globalNote: PineMemorySummary = {
  scope: "global",
  name: "reply-language",
  description: "回复使用简体中文",
  verified: true,
  updatedAt: "2026-11-15T00:00:00.000Z",
};
const projectNote: PineMemorySummary = {
  scope: "project",
  name: "release-day",
  description: "周四发版",
  verified: false,
  updatedAt: "2026-11-15T00:00:00.000Z",
};

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function mountSettings(memories: PineMemorySummary[]) {
  const api = {
    getMemoryEnabled: vi.fn().mockResolvedValue(true),
    setMemoryEnabled: vi
      .fn()
      .mockImplementation((request: { enabled: boolean }) =>
        Promise.resolve(request),
      ),
    listMemories: vi.fn().mockResolvedValue({ memories }),
    readMemory: vi.fn().mockResolvedValue({
      ...projectNote,
      content: "用户在 11 月确认。",
    }),
    saveMemory: vi.fn().mockResolvedValue(projectNote),
    removeMemory: vi.fn().mockResolvedValue({ removed: true }),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: api });
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(MemorySettings, {
    attachTo: document.body,
    global: { plugins: [pinia, createAppI18n("zh-CN")] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, api };
}

/** The most recently opened menu's item; earlier menus may linger. */
function menuItem(action: string): DOMWrapper<Element> {
  return new DOMWrapper(
    [...document.querySelectorAll(`[data-action="${action}"]`)].at(-1),
  );
}

it("holds the list's place with a skeleton while notes load", () => {
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      getMemoryEnabled: () => new Promise(() => undefined),
      listMemories: () => new Promise(() => undefined),
    },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(MemorySettings, {
    global: { plugins: [pinia, createAppI18n("zh-CN")] },
  });
  wrappers.push(wrapper);
  expect(wrapper.find('[data-testid="memory-list-skeleton"]').exists()).toBe(
    true,
  );
});

it("lists the notes of the current project and every project", async () => {
  const { wrapper, api } = await mountSettings([projectNote, globalNote]);
  expect(api.listMemories).toHaveBeenCalledWith({
    projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
  });
  const rows = wrapper.findAll('[data-slot="memory-row"]');
  expect(rows).toHaveLength(2);
  expect(rows[0].text()).toContain("release-day");
  expect(rows[0].text()).toContain("周四发版");
  expect(rows[0].find('[data-slot="memory-unverified"]').exists()).toBe(true);
  expect(rows[1].text()).toContain("所有项目");
  expect(rows[1].find('[data-slot="memory-unverified"]').exists()).toBe(false);
});

it("says so when nothing has been remembered", async () => {
  const { wrapper } = await mountSettings([]);
  expect(wrapper.get('[data-testid="memory-list-empty"]').text()).toContain(
    "还没有记忆",
  );
});

it("turns memory off", async () => {
  const { wrapper, api } = await mountSettings([]);
  await wrapper.get('[data-testid="pine-memory-toggle"]').trigger("click");
  await flushPromises();
  expect(api.setMemoryEnabled).toHaveBeenCalledWith({ enabled: false });
  expect(
    wrapper
      .get('[data-testid="pine-memory-toggle"]')
      .attributes("aria-checked"),
  ).toBe("false");
});

it("asks before deleting a note", async () => {
  const { wrapper, api } = await mountSettings([projectNote]);
  await wrapper.get('button[aria-label$="操作"]').trigger("click");
  await flushPromises();
  await menuItem("delete-memory").trigger("click");
  await flushPromises();
  expect(api.removeMemory).not.toHaveBeenCalled();

  await menuItem("confirm-delete-memory").trigger("click");
  await flushPromises();
  expect(api.removeMemory).toHaveBeenCalledWith({
    projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
    scope: "project",
    name: "release-day",
  });
  expect(api.listMemories).toHaveBeenCalledTimes(2);
});

it("saves an edited note under the same name", async () => {
  const { wrapper, api } = await mountSettings([projectNote]);
  await wrapper.get('button[aria-label$="操作"]').trigger("click");
  await flushPromises();
  await menuItem("edit-memory").trigger("click");
  await flushPromises();

  const description = document.querySelector<HTMLInputElement>(
    "#pine-memory-description",
  );
  expect(description?.value).toBe("周四发版");
  await new DOMWrapper(description).setValue("周五发版");
  await new DOMWrapper(
    document.querySelector("#pine-memory-editor-form"),
  ).trigger("submit");
  await flushPromises();
  expect(api.saveMemory).toHaveBeenCalledWith({
    projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
    scope: "project",
    name: "release-day",
    description: "周五发版",
    content: "用户在 11 月确认。",
    verified: false,
  });
});
