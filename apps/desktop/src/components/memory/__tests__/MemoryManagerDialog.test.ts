import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { ASSISTANT_PROJECT_ID } from "@/shared/assistant";
import type { PineMemorySummary } from "@/shared/memory";
import MemoryManagerDialog from "../MemoryManagerDialog.vue";

const PROJECT_ID = "project-1";

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
  const wrapper = mount(MemoryManagerDialog, {
    attachTo: document.body,
    props: { projectId: PROJECT_ID, open: true },
    global: { plugins: [pinia, createAppI18n("zh-CN")] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, api };
}

/** The dialog renders in a portal, outside the wrapper. */
function find(selector: string): DOMWrapper<Element> {
  return new DOMWrapper(document.querySelector(selector));
}

function findAll(selector: string): DOMWrapper<Element>[] {
  return [...document.querySelectorAll(selector)].map(
    (element) => new DOMWrapper(element),
  );
}

/** The most recently opened layer's control; earlier ones may linger. */
function menuItem(action: string): DOMWrapper<Element> {
  return new DOMWrapper(
    [...document.querySelectorAll(`[data-action="${action}"]`)].at(-1),
  );
}

it("holds the list's place with a skeleton while notes load", async () => {
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      getMemoryEnabled: () => new Promise(() => undefined),
      listMemories: () => new Promise(() => undefined),
    },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(MemoryManagerDialog, {
    attachTo: document.body,
    props: { projectId: PROJECT_ID, open: true },
    global: { plugins: [pinia, createAppI18n("zh-CN")] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  expect(find('[data-testid="memory-list-skeleton"]').exists()).toBe(true);
});

it("splits the notes between this project and all projects", async () => {
  const { api } = await mountSettings([projectNote, globalNote]);
  expect(api.listMemories).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  const rows = findAll('[data-slot="memory-row"]');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.text()).toContain("release-day");
  expect(rows[0]?.text()).toContain("周四发版");
  expect(rows[0]?.find('[data-slot="memory-unverified"]').exists()).toBe(true);

  const globalTab = findAll('[role="tab"]').find((tab) =>
    tab.text().includes("所有项目"),
  );
  await globalTab?.trigger("mousedown", { button: 0 });
  await flushPromises();
  const globalRows = findAll('[data-slot="memory-row"]');
  expect(globalRows).toHaveLength(1);
  expect(globalRows[0]?.text()).toContain("reply-language");
  expect(globalRows[0]?.find('[data-slot="memory-unverified"]').exists()).toBe(
    false,
  );
});

it("says so when nothing has been remembered", async () => {
  await mountSettings([]);
  expect(find('[data-testid="memory-list-empty"]').text()).toContain(
    "还没有记忆",
  );
});

it("asks before deleting a note", async () => {
  const { api } = await mountSettings([projectNote]);
  await find('[data-action="edit-memory"]').trigger("click");
  await flushPromises();
  await menuItem("delete-memory").trigger("click");
  await flushPromises();
  expect(api.removeMemory).not.toHaveBeenCalled();

  await menuItem("confirm-delete-memory").trigger("click");
  await flushPromises();
  expect(api.removeMemory).toHaveBeenCalledWith({
    projectId: PROJECT_ID,
    scope: "project",
    name: "release-day",
  });
  // Once on opening and once after deleting, each for this project and the Assistant.
  expect(api.listMemories).toHaveBeenCalledTimes(4);
});

it("saves an edited note under the same name", async () => {
  const { api } = await mountSettings([projectNote]);
  await find('[data-action="edit-memory"]').trigger("click");
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
    projectId: PROJECT_ID,
    scope: "project",
    name: "release-day",
    description: "周五发版",
    content: "用户在 11 月确认。",
    verified: false,
  });
});

it("manages notes without asking whether memory is on", async () => {
  const { api } = await mountSettings([projectNote]);
  expect(find('[data-testid="pine-memory-toggle"]').exists()).toBe(false);
  expect(findAll('[data-slot="memory-row"]')).toHaveLength(1);
  expect(api).not.toHaveProperty("getMemoryEnabled");
});

it("opens focused on the dialog, not ringed around its first tab", async () => {
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: { listMemories: vi.fn().mockResolvedValue({ memories: [] }) },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(MemoryManagerDialog, {
    attachTo: document.body,
    props: { projectId: PROJECT_ID, open: false },
    global: { plugins: [pinia, createAppI18n("en-US")] },
  });
  wrappers.push(wrapper);

  await wrapper.setProps({ open: true });
  await flushPromises();

  expect(document.activeElement).toBe(
    document.querySelector('[data-testid="memory-manager"]'),
  );
});

it("shows the Assistant's notes as their own scope", async () => {
  const assistantNote = { ...projectNote, name: "weekly-briefing" };
  const { api } = await mountSettings([]);
  api.listMemories.mockImplementation(({ projectId }) =>
    Promise.resolve({
      memories:
        projectId === ASSISTANT_PROJECT_ID
          ? [assistantNote, globalNote]
          : [projectNote, globalNote],
    }),
  );
  await wrappers[0]?.setProps({ open: false });
  await wrappers[0]?.setProps({ open: true });
  await flushPromises();

  await find('[data-testid="memory-scope-assistant"]').trigger("mousedown", {
    button: 0,
  });
  await flushPromises();
  const rows = findAll('[data-slot="memory-row"]');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.text()).toContain("weekly-briefing");

  await menuItem("edit-memory").trigger("click");
  await flushPromises();
  expect(api.readMemory).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: ASSISTANT_PROJECT_ID }),
  );
});

it("leaves out the project scope inside the Assistant", async () => {
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: { listMemories: vi.fn().mockResolvedValue({ memories: [] }) },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(MemoryManagerDialog, {
    attachTo: document.body,
    props: { projectId: ASSISTANT_PROJECT_ID, open: true },
    global: { plugins: [pinia, createAppI18n("zh-CN")] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  const tabs = findAll('[role="tab"]').map((tab) => tab.text());
  expect(tabs).toEqual(["助理", "所有项目"]);
});
