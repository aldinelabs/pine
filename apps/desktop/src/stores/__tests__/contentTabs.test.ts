import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT_TABS_STORAGE_PREFIX } from "@/lib/contentTabStorage";
import type { PineSessionSummary } from "@/shared/sessions";
import { useContentTabsStore } from "../contentTabs";

const firstSession: PineSessionSummary = {
  createdAt: "2026-08-25T00:00:00.000Z",
  id: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
  messageCount: 2,
  preview: "First prompt",
  updatedAt: "2026-08-25T00:01:00.000Z",
};

describe("content tabs store", () => {
  it("keeps pending composer attachments separate, deduplicates them, and releases closed tabs", () => {
    const store = useContentTabsStore();
    store.bindSession("session-1", firstSession);
    const draft = store.createSessionTab();
    const attachment = {
      name: "notes.md",
      path: "/notes.md",
      extension: "md",
      size: 12,
      modifiedAt: "",
    };
    store.addAttachments("session-1", [attachment]);
    store.addAttachments("session-1", [attachment]);
    store.addAttachments(draft.id, [{ ...attachment, path: "/other.md" }]);
    expect(store.attachmentsFor("session-1")).toEqual([attachment]);
    expect(store.attachmentsFor(draft.id)).toHaveLength(1);
    store.setAttachments("session-1", []);
    expect(store.attachmentsFor("session-1")).toEqual([]);
    store.close(draft.id, draft.id);
    expect(store.attachmentsFor(draft.id)).toEqual([]);
    expect(store.addAttachments(draft.id, [attachment])).toBe(false);
  });

  it("persists reordered tabs without changing selection or losing composer attachments", () => {
    const store = useContentTabsStore();
    store.restore("one");
    const file = store.openFile({
      projectId: "one",
      folderId: "root",
      relativePath: "notes.txt",
    });
    const other = store.openFile({
      projectId: "one",
      folderId: "root",
      relativePath: "image.png",
    });
    store.setActiveTab(file.id);
    store.moveTab(other.id, "session-1", "before");
    expect(store.tabs.map((tab) => tab.id)).toEqual([
      other.id,
      "session-1",
      file.id,
    ]);
    store.moveTab("session-1", file.id, "after");
    expect(store.tabs.map((tab) => tab.id)).toEqual([
      other.id,
      file.id,
      "session-1",
    ]);
    store.restore("one");
    expect(store.tabs.map((tab) => tab.id)).toEqual([
      other.id,
      file.id,
      "session-1",
    ]);
    expect(store.fallbackActiveTabId).toBe(file.id);
  });
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("restores file and session tabs in order with the selected tab", () => {
    const store = useContentTabsStore();
    store.restore("one");
    store.bindSession("session-1", firstSession);
    const file = store.openFile({
      projectId: "one",
      folderId: "root",
      relativePath: "src/main.ts",
    });
    store.createSessionTab();
    store.setActiveTab(file.id);
    const expected = JSON.parse(JSON.stringify(store.tabs));
    store.reset();
    setActivePinia(createPinia());
    const restored = useContentTabsStore();
    restored.restore("one");
    expect(restored.tabs).toEqual(expected);
    expect(restored.fallbackActiveTabId).toBe(file.id);
    restored.bindSession("session-2", { ...firstSession, id: "second" });
    expect(restored.createSessionTab().id).toBe("session-3");
  });

  it("keeps empty lists and projects isolated across switches", () => {
    const store = useContentTabsStore();
    store.restore("one");
    store.close("session-1", "session-1");
    store.restore("two");
    expect(store.tabs).toEqual([
      { id: "session-1", kind: "session", state: "draft" },
    ]);
    store.bindSession("session-1", firstSession);
    store.restore("one");
    expect(store.tabs).toEqual([]);
    expect(store.fallbackActiveTabId).toBeNull();
    store.restore("two");
    expect(store.tabs[0]).toMatchObject({ sessionId: firstSession.id });
  });

  it("does not resurrect closed or deleted tabs", () => {
    const store = useContentTabsStore();
    store.restore("one");
    store.bindSession("session-1", firstSession);
    const file = store.openFile({
      projectId: "one",
      folderId: "root",
      relativePath: "image.png",
    });
    store.setActiveTab("session-1");
    store.removeSession(firstSession.id, "session-1");
    store.restore("one");
    expect(store.tabs.map((tab) => tab.id)).toEqual([file.id]);
    expect(store.fallbackActiveTabId).toBe(file.id);
    store.close(file.id, file.id);
    store.reset();
    store.restore("one");
    expect(store.tabs).toEqual([]);
  });

  it("drops presented file tabs on restore because their grant is per-run", () => {
    localStorage.setItem(
      CONTENT_TABS_STORAGE_PREFIX + "one",
      JSON.stringify({
        activeTabId: "file-2",
        tabs: [
          {
            id: "file-1",
            kind: "file",
            source: "project",
            label: "main.ts",
            projectId: "one",
            folderId: "root",
            relativePath: "src/main.ts",
          },
          {
            id: "file-2",
            kind: "file",
            source: "presented",
            label: "report.pdf",
            path: "/Users/me/Downloads/report.pdf",
          },
          { id: "session-1", kind: "session", state: "bound", sessionId: "s1" },
        ],
      }),
    );
    const store = useContentTabsStore();
    store.restore("one");

    // The project file and session survive; the presented file cannot be read
    // without the grant the run that presented it owned.
    expect(store.tabs.map((tab) => tab.id)).toEqual(["file-1", "session-1"]);
    expect(store.fallbackActiveTabId).toBe("file-1");
  });

  it("restores interrupted creation and keeps independent drafts", () => {
    const store = useContentTabsStore();
    store.restore("one");
    store.beginPrompt("session-1", "pending");
    store.createSessionTab();
    store.restore("one");
    expect(store.tabs).toEqual([
      { id: "session-1", kind: "session", state: "draft" },
      { id: "session-2", kind: "session", state: "draft" },
    ]);
    expect(store.beginPrompt("session-1", "retry")).toBe(true);
  });

  it.each([
    "broken",
    '{"tabs":{}}',
    '{"tabs":[{"kind":"file"}],"activeTabId":null}',
  ])("falls back to a draft for invalid storage: %s", (value) => {
    localStorage.setItem(CONTENT_TABS_STORAGE_PREFIX + "one", value);
    const store = useContentTabsStore();
    store.restore("one");
    expect(store.tabs).toEqual([
      { id: "session-1", kind: "session", state: "draft" },
    ]);
  });

  it("keeps navigation usable when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const store = useContentTabsStore();
    expect(() => store.restore("one")).not.toThrow();
    expect(() => store.close("session-1", "session-1")).not.toThrow();
    expect(store.tabs).toEqual([]);
  });

  it("creates a draft tab from a bound session", () => {
    const store = useContentTabsStore();
    store.bindSession("session-1", firstSession);

    const draft = store.createSessionTab();

    expect(draft.state).toBe("draft");
    expect(store.tabs).toContainEqual(draft);
    expect(store.tabs).toHaveLength(2);
  });

  it("does not duplicate an already active draft tab", () => {
    const store = useContentTabsStore();

    const draft = store.createSessionTab();

    expect(draft.id).toBe("session-1");
    expect(store.tabs).toHaveLength(1);
  });

  it("binds a prompt result to the tab that sent it", () => {
    const store = useContentTabsStore();
    const firstTabId = "session-1";
    store.beginPrompt(firstTabId, "Pending prompt");
    const secondTab = store.createSessionTab();

    store.bindSession(firstTabId, firstSession);

    expect(secondTab.state).toBe("draft");
    expect(store.tabs).toContainEqual(
      expect.objectContaining({
        id: firstTabId,
        sessionId: firstSession.id,
        state: "bound",
      }),
    );
  });

  it("moves a draft through creating to bound", () => {
    const store = useContentTabsStore();

    expect(store.beginPrompt("session-1", "First prompt")).toBe(true);
    expect(store.tabs).toContainEqual(
      expect.objectContaining({
        id: "session-1",
        label: "First prompt",
        state: "creating",
      }),
    );

    store.bindSession("session-1", firstSession);

    expect(store.tabs).toContainEqual(
      expect.objectContaining({
        id: "session-1",
        sessionId: firstSession.id,
        state: "bound",
      }),
    );
  });

  it("leaves no tabs after closing the last one", () => {
    const store = useContentTabsStore();
    expect(store.close("session-1", "session-1")).toBe("");
    expect(store.tabs).toEqual([]);
    expect(store.createSessionTab().state).toBe("draft");
  });

  it("opens distinct files without replacing existing tabs and reuses the same file", () => {
    const store = useContentTabsStore();
    const file = {
      projectId: "p1",
      folderId: "f1",
      relativePath: "src/main.ts",
    };
    const first = store.openFile(file);
    const second = store.openFile({ ...file, relativePath: "image.png" });
    const otherRoot = store.openFile({ ...file, folderId: "f2" });
    expect(store.openFile(file).id).toBe(first.id);
    expect(new Set([first.id, second.id, otherRoot.id]).size).toBe(3);
    expect(store.tabs).toHaveLength(4);
    expect(store.close("session-1", first.id)).toBe(first.id);
    expect(store.tabs.every((tab) => tab.kind === "file")).toBe(true);
    expect(store.close(first.id, first.id)).toBe(second.id);
    store.reset();
    expect(store.tabs).toEqual([
      { id: "session-1", kind: "session", state: "draft" },
    ]);
  });

  it("opens presented files as their own tabs and reuses them by path", () => {
    const store = useContentTabsStore();
    const project = store.openFile({
      projectId: "p1",
      folderId: "f1",
      relativePath: "src/main.ts",
    });
    const presented = store.presentFile({
      source: "presented",
      path: "/Users/me/Downloads/report.pdf",
    });
    expect(presented).toMatchObject({
      kind: "file",
      label: "report.pdf",
      source: "presented",
      path: "/Users/me/Downloads/report.pdf",
    });
    // Presenting the same file twice highlights one tab instead of two.
    expect(
      store.presentFile({
        source: "presented",
        path: "/Users/me/Downloads/report.pdf",
      }).id,
    ).toBe(presented.id);
    expect(store.tabs).toHaveLength(3);
    // A presented path never collides with a project-relative file.
    expect(presented.id).not.toBe(project.id);
    expect(store.tabs.some((tab) => tab.id === presented.id)).toBe(true);
  });

  it("remembers the resolved target for a presentation after its tab closes", () => {
    const store = useContentTabsStore();
    const target = {
      source: "presented" as const,
      path: "/canonical/report.pdf",
    };
    const tab = store.presentFile(target, "present-call");
    store.close(tab.id, "session-1");

    expect(store.presentedTargetFor("present-call")).toEqual(target);
    expect(
      store.presentFile(store.presentedTargetFor("present-call")!).id,
    ).not.toBe(tab.id);
    store.reset();
    expect(store.presentedTargetFor("present-call")).toBeUndefined();
  });

  it("opens an existing session tab instead of duplicating it", () => {
    const store = useContentTabsStore();
    store.bindSession("session-1", firstSession);
    store.createSessionTab();

    const opened = store.openSession(firstSession, store.createSessionTab().id);

    expect(opened.id).toBe("session-1");
    expect(
      store.tabs.filter(
        (tab) => tab.kind === "session" && tab.state === "bound",
      ),
    ).toHaveLength(1);
  });
});
