import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { handleError } from "@/app/errors/errorHandler";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useFileToSession } from "../useFileToSession";
import { showProject } from "@/stores/__tests__/showProject";

vi.mock("@/app/errors/errorHandler", () => ({ handleError: vi.fn() }));
const file = { projectId: "p1", folderId: "f1", relativePath: "notes.md" };
const attachment = {
  name: "notes.md",
  path: "/project/notes.md",
  size: 12,
  extension: "md",
  modifiedAt: "",
};
const session = {
  id: "s1",
  name: "Existing",
  createdAt: "",
  updatedAt: "",
  messageCount: 0,
};
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: {} }],
  });
  await router.push("/");
  const project = useProjectStore();
  showProject({
    id: "p1",
    name: "Project",
    schemaVersion: 1,
    createdAt: "",
    updatedAt: "",
    defaultFolderId: "f1",
    folders: [],
  });
  const store = useContentTabsStore();
  // Files only go to sessions of their own project.
  store.setDraftProject("session-1", "p1");
  const source = store.openFile(file);
  await router.push({ query: { tab: source.id } });
  const inspect = vi.fn().mockResolvedValue({ attachments: [attachment] });
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: { inspectProjectAttachments: inspect },
  });
  let sender!: ReturnType<typeof useFileToSession>;
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          sender = useFileToSession();
          return () => null;
        },
      }),
      { global: { plugins: [pinia, router, createAppI18n("en-US")] } },
    ),
  );
  return { project, store, router, inspect, sender, source };
}

describe("file to session delivery", () => {
  it("creates an independent draft, attaches the file, and activates it", async () => {
    const { store, router, sender } = await setup();
    store.addAttachments("session-1", [
      { ...attachment, path: "/existing.md" },
    ]);
    await sender.sendFileToNewSession(file);
    await flushPromises();
    const targetId = String(router.currentRoute.value.query.tab);
    expect(targetId).not.toBe("session-1");
    expect(store.tabs.find((tab) => tab.id === targetId)).toMatchObject({
      kind: "session",
      state: "draft",
    });
    expect(store.attachmentsFor(targetId)).toEqual([attachment]);
    expect(store.attachmentsFor("session-1")).toEqual([
      { ...attachment, path: "/existing.md" },
    ]);
  });

  it("does not create a new session when file inspection fails", async () => {
    const { store, sender, inspect } = await setup();
    inspect.mockRejectedValue(new Error("missing file"));
    await sender.sendFileToNewSession(file);
    expect(store.tabs).toHaveLength(2);
  });
  it("attaches to an unmounted draft and activates it without submitting a message", async () => {
    const { store, router, sender, inspect } = await setup();
    const existing = { ...attachment, path: "/other.md" };
    store.addAttachments("session-1", [existing]);
    await sender.sendFile(file, "session-1");
    await flushPromises();
    expect(inspect).toHaveBeenCalledWith([
      { folderId: "f1", projectId: "p1", relativePath: "notes.md" },
    ]);
    expect(store.attachmentsFor("session-1")).toEqual([existing, attachment]);
    expect(router.currentRoute.value.query.tab).toBe("session-1");
    expect(store.tabs[0]).toMatchObject({ state: "draft" });
  });

  it("opens a sidebar session without replacing a draft and reuses it on later drops", async () => {
    const { store, router, sender } = await setup();
    await sender.sendFile(file, session);
    await flushPromises();
    const target = store.tabs.find(
      (tab) => tab.kind === "session" && tab.state === "bound",
    );
    expect(target).toMatchObject({ sessionId: "s1" });
    expect(store.tabs[0]).toMatchObject({ id: "session-1", state: "draft" });
    expect(router.currentRoute.value.query.tab).toBe(target?.id);
    await sender.sendFile(file, session);
    expect(store.tabs).toHaveLength(3);
    expect(store.attachmentsFor(target!.id)).toEqual([attachment]);
  });

  it("does not attach a file to a session of another project", async () => {
    const { store, sender } = await setup();
    store.setDraftProject("session-1", "p2");
    await sender.sendFile(file, "session-1");
    await flushPromises();
    expect(store.attachmentsFor("session-1")).toEqual([]);
  });

  it.each(["close", "release"])(
    "discards late results after %s",
    async (action) => {
      const { store, project, sender, inspect, router, source } = await setup();
      let resolve!: (value: { attachments: (typeof attachment)[] }) => void;
      inspect.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const pending = sender.sendFile(file, "session-1");
      if (action === "close") store.close("session-1", source.id);
      else project.openProjectIds = new Set();
      resolve({ attachments: [attachment] });
      await pending;
      await flushPromises();
      expect(store.attachmentsFor("session-1")).toEqual([]);
      expect(router.currentRoute.value.query.tab).toBe(source.id);
    },
  );

  it("leaves navigation and tabs intact if inspection fails", async () => {
    const { store, sender, inspect, router, source } = await setup();
    inspect.mockRejectedValue(new Error("missing file"));
    await sender.sendFile(file, session);
    expect(handleError).toHaveBeenCalled();
    expect(store.tabs).toHaveLength(2);
    expect(router.currentRoute.value.query.tab).toBe(source.id);
    expect(sender.isSending.value).toBe(false);
  });
});
