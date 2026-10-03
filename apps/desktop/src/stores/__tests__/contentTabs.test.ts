import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT_TABS_STORAGE_KEY } from "@/lib/contentTabStorage";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
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

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  /** A new Pinia reads the window's saved tabs, as a reload does. */
  function reloadStore() {
    setActivePinia(createPinia());
    return useContentTabsStore();
  }

  it("starts new drafts in the temporary workspace", () => {
    const store = useContentTabsStore();
    expect(store.tabs).toEqual([
      {
        id: "session-1",
        kind: "session",
        projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
        state: "draft",
      },
    ]);
    store.bindSession("session-1", firstSession);
    expect(store.createSessionTab()).toMatchObject({
      projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
    });
  });

  it("starts new drafts in the project last chosen for a draft", () => {
    const store = useContentTabsStore();
    store.rememberDraftProject("one");
    expect(store.createSessionTab({ reuseDraft: false })).toMatchObject({
      projectId: "one",
    });
    // The choice survives a reload.
    expect(reloadStore().tabs).toContainEqual(
      expect.objectContaining({ state: "draft", projectId: "one" }),
    );

    const store2 = useContentTabsStore();
    store2.removeProject("one");
    expect(store2.lastDraftProjectId).toBe(TEMPORARY_WORKSPACE_PROJECT_ID);
    expect(store2.createSessionTab({ reuseDraft: false })).toMatchObject({
      projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
    });
  });

  it("retargets only drafts, and a reused draft only when asked", () => {
    const store = useContentTabsStore();
    expect(store.setDraftProject("session-1", "one")).toBe(true);
    expect(store.tabs[0]).toMatchObject({ projectId: "one" });
    expect(store.createSessionTab()).toMatchObject({
      id: "session-1",
      projectId: "one",
    });
    expect(store.createSessionTab({ projectId: "two" })).toMatchObject({
      id: "session-1",
      projectId: "two",
    });

    store.bindSession("session-1", firstSession);
    expect(store.setDraftProject("session-1", "one")).toBe(false);
    expect(store.tabs[0]).toMatchObject({ projectId: "two", state: "bound" });
  });

  it("keeps each tab's project through creation and binding", () => {
    const store = useContentTabsStore();
    store.setDraftProject("session-1", "one");
    store.beginPrompt("session-1", "pending");
    expect(store.tabs[0]).toMatchObject({
      projectId: "one",
      state: "creating",
    });
    store.bindSession("session-1", firstSession);
    expect(store.tabs[0]).toMatchObject({ projectId: "one", state: "bound" });

    const opened = store.openSession({ ...firstSession, id: "second" }, "two");
    expect(opened).toMatchObject({ projectId: "two", sessionId: "second" });
  });

  it("persists reordered tabs without changing selection", () => {
    const store = useContentTabsStore();
    const file = store.openFile({
      projectId: "one",
      folderId: "root",
      relativePath: "notes.txt",
    });
    const other = store.openFile({
      projectId: "two",
      folderId: "root",
      relativePath: "image.png",
    });
    store.setActiveTab(file.id);
    store.moveTab(other.id, "session-1", "before");
    store.moveTab("session-1", file.id, "after");
    expect(store.tabs.map((tab) => tab.id)).toEqual([
      other.id,
      file.id,
      "session-1",
    ]);

    const restored = reloadStore();
    expect(restored.tabs.map((tab) => tab.id)).toEqual([
      other.id,
      file.id,
      "session-1",
    ]);
    expect(restored.tabs.map((tab) => tab.projectId)).toEqual([
      "two",
      "one",
      TEMPORARY_WORKSPACE_PROJECT_ID,
    ]);
    expect(restored.fallbackActiveTabId).toBe(file.id);
  });

  it("prefers this window's reload state over the last launch", () => {
    const store = useContentTabsStore();
    store.openFile({ projectId: "one", folderId: "root", relativePath: "a" });
    localStorage.setItem(
      CONTENT_TABS_STORAGE_KEY,
      JSON.stringify({ activeTabId: null, tabs: [] }),
    );
    expect(reloadStore().tabs).toHaveLength(2);
    sessionStorage.clear();
    expect(reloadStore().tabs).toEqual([]);
  });

  it("does not resurrect closed or deleted tabs", () => {
    const store = useContentTabsStore();
    store.bindSession("session-1", firstSession);
    const file = store.openFile({
      projectId: "one",
      folderId: "root",
      relativePath: "image.png",
    });
    store.setActiveTab("session-1");
    store.removeSession(firstSession.id, "session-1");
    const restored = reloadStore();
    expect(restored.tabs.map((tab) => tab.id)).toEqual([file.id]);
    expect(restored.fallbackActiveTabId).toBe(file.id);
    restored.close(file.id, file.id);
    expect(reloadStore().tabs).toEqual([]);
  });

  it("moves a teleported session's tab to its new project", () => {
    const store = useContentTabsStore();
    store.bindSession("session-1", firstSession);
    store.moveSessionToProject(firstSession.id, "one");
    expect(store.tabs[0]).toMatchObject({
      projectId: "one",
      sessionId: firstSession.id,
      state: "bound",
    });
  });

  it("closes every tab of a deleted project", () => {
    const store = useContentTabsStore();
    store.setDraftProject("session-1", "one");
    const kept = store.openFile({
      projectId: "two",
      folderId: "root",
      relativePath: "a",
    });
    store.openFile({ projectId: "one", folderId: "root", relativePath: "b" });
    store.setActiveTab("session-1");
    store.removeProject("one");
    expect(store.tabs.map((tab) => tab.id)).toEqual([kept.id]);
    expect(store.fallbackActiveTabId).toBe(kept.id);
    store.removeProject("two");
    expect(store.tabs).toEqual([
      expect.objectContaining({
        kind: "session",
        projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
        state: "draft",
      }),
    ]);
  });

  it("drops presented file tabs on restore because their grant is per-run", () => {
    localStorage.setItem(
      CONTENT_TABS_STORAGE_KEY,
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
            projectId: "one",
          },
          {
            id: "session-1",
            kind: "session",
            state: "bound",
            sessionId: "s1",
            projectId: "one",
          },
        ],
      }),
    );
    const store = useContentTabsStore();

    // The project file and session survive; the presented file cannot be read
    // without the grant the run that presented it owned.
    expect(store.tabs.map((tab) => tab.id)).toEqual(["file-1", "session-1"]);
    expect(store.fallbackActiveTabId).toBe("file-1");
  });

  it("restores interrupted creation and keeps independent drafts", () => {
    const store = useContentTabsStore();
    store.setDraftProject("session-1", "one");
    store.beginPrompt("session-1", "pending");
    store.createSessionTab();
    const restored = reloadStore();
    expect(restored.tabs).toEqual([
      { id: "session-1", kind: "session", projectId: "one", state: "draft" },
      {
        id: "session-2",
        kind: "session",
        projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
        state: "draft",
      },
    ]);
    expect(restored.beginPrompt("session-1", "retry")).toBe(true);
  });

  it.each([
    "broken",
    '{"tabs":{}}',
    '{"tabs":[{"kind":"file"}],"activeTabId":null}',
    // Per-project lists from before tabs carried their project.
    '{"tabs":[{"id":"session-1","kind":"session","state":"draft"}],"activeTabId":null}',
  ])("falls back to a draft for invalid storage: %s", (value) => {
    localStorage.setItem(CONTENT_TABS_STORAGE_KEY, value);
    const store = useContentTabsStore();
    expect(store.tabs).toEqual([
      {
        id: "session-1",
        kind: "session",
        projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
        state: "draft",
      },
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
      {
        id: "session-1",
        kind: "session",
        projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
        state: "draft",
      },
    ]);
  });

  it("opens presented files as their own tabs and reuses them by path", () => {
    const store = useContentTabsStore();
    const project = store.openFile({
      projectId: "p1",
      folderId: "f1",
      relativePath: "src/main.ts",
    });
    const presented = store.presentFile(
      { source: "presented", path: "/Users/me/Downloads/report.pdf" },
      "p1",
    );
    expect(presented).toMatchObject({
      kind: "file",
      label: "report.pdf",
      projectId: "p1",
      source: "presented",
      path: "/Users/me/Downloads/report.pdf",
    });
    // Presenting the same file twice highlights one tab instead of two.
    expect(
      store.presentFile(
        { source: "presented", path: "/Users/me/Downloads/report.pdf" },
        "p1",
      ).id,
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
    const tab = store.presentFile(target, "p1", "present-call");
    store.close(tab.id, "session-1");

    expect(store.presentedTargetFor("present-call")).toEqual(target);
    expect(
      store.presentFile(store.presentedTargetFor("present-call")!, "p1").id,
    ).not.toBe(tab.id);
    store.reset();
    expect(store.presentedTargetFor("present-call")).toBeUndefined();
  });

  it("opens an existing session tab instead of duplicating it", () => {
    const store = useContentTabsStore();
    store.bindSession("session-1", firstSession);
    store.createSessionTab();

    const opened = store.openSession(
      firstSession,
      TEMPORARY_WORKSPACE_PROJECT_ID,
      store.createSessionTab().id,
    );

    expect(opened.id).toBe("session-1");
    expect(
      store.tabs.filter(
        (tab) => tab.kind === "session" && tab.state === "bound",
      ),
    ).toHaveLength(1);
  });
});
