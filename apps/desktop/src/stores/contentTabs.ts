import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, watch } from "vue";
import { readContentTabs, writeContentTabs } from "@/lib/contentTabStorage";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import type { PineSessionSummary } from "@/shared/sessions";
import type {
  FilePreviewTarget,
  ProjectFilePreviewRequest,
} from "@/shared/projectFiles";
import type { PineAttachment } from "@/shared/attachments";
import { fileName, fileTargetKey } from "@/lib/filePreviewTarget";

/**
 * Every tab belongs to one project: the sidebars and accent colour follow
 * the active tab's project. A draft's project is where it will be sent and
 * stays editable until the first message creates the session.
 */
export type FileContentTab = {
  id: string;
  kind: "file";
  label: string;
  projectId: string;
} & FilePreviewTarget;

export interface DraftSessionTab {
  id: string;
  kind: "session";
  projectId: string;
  state: "draft";
}

export interface CreatingSessionTab {
  id: string;
  kind: "session";
  label: string;
  projectId: string;
  state: "creating";
}

export interface BoundSessionTab {
  id: string;
  kind: "session";
  label?: string;
  projectId: string;
  sessionId: string;
  state: "bound";
}

export type SessionContentTab =
  DraftSessionTab | CreatingSessionTab | BoundSessionTab;
export type ProjectContentTab = FileContentTab | SessionContentTab;

function sessionLabel(session: PineSessionSummary): string | undefined {
  return session.name || session.preview;
}

export const useContentTabsStore = defineStore("content-tabs", () => {
  let nextSessionTabNumber = 2;

  function initialTabs(): ProjectContentTab[] {
    return [
      {
        id: "session-1",
        kind: "session",
        projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
        state: "draft",
      },
    ];
  }

  const saved = readContentTabs();
  const tabs = ref<ProjectContentTab[]>(saved?.tabs ?? initialTabs());
  // Main resolves a presentation to the exact file target, including its
  // project folder or temporary external-file grant. Keep that association
  // after a tab closes so its tool marker can reopen the same preview.
  const presentedTargets = new Map<string, FilePreviewTarget>();
  const composerAttachments = ref<Record<string, PineAttachment[]>>({});
  watch(
    () => tabs.value.map((tab) => tab.id),
    (ids) => {
      for (const id of Object.keys(composerAttachments.value)) {
        if (!ids.includes(id)) delete composerAttachments.value[id];
      }
    },
    { flush: "sync" },
  );

  function attachmentsFor(tabId: string): PineAttachment[] {
    return composerAttachments.value[tabId] ?? [];
  }

  function setAttachments(
    tabId: string,
    attachments: PineAttachment[],
  ): boolean {
    if (!tabs.value.some((tab) => tab.id === tabId && tab.kind === "session"))
      return false;
    composerAttachments.value[tabId] = [
      ...new Map(attachments.map((file) => [file.path, file])).values(),
    ];
    return true;
  }

  function addAttachments(
    tabId: string,
    attachments: PineAttachment[],
  ): boolean {
    return setAttachments(tabId, [...attachmentsFor(tabId), ...attachments]);
  }

  function moveTab(
    tabId: string,
    targetId: string,
    side: "before" | "after",
  ): void {
    if (tabId === targetId) return;
    const tab = tabs.value.find((candidate) => candidate.id === tabId);
    if (!tab || !tabs.value.some((candidate) => candidate.id === targetId))
      return;
    const ordered = tabs.value.filter((candidate) => candidate.id !== tabId);
    const targetIndex = ordered.findIndex(
      (candidate) => candidate.id === targetId,
    );
    ordered.splice(targetIndex + (side === "after" ? 1 : 0), 0, tab);
    tabs.value = ordered;
  }
  // Router replacement is async. Keep the intended successor available while
  // the route still points to a tab that has just been removed.
  const fallbackActiveTabId = ref<string | null>(
    saved?.activeTabId ?? tabs.value[0]?.id ?? null,
  );

  function persist(): void {
    writeContentTabs({
      tabs: tabs.value,
      activeTabId: tabs.value.some(
        (tab) => tab.id === fallbackActiveTabId.value,
      )
        ? fallbackActiveTabId.value
        : (tabs.value[0]?.id ?? null),
    });
  }
  watch([tabs, fallbackActiveTabId], persist, { deep: true, flush: "sync" });

  function setActiveTab(tabId: string): void {
    if (tabs.value.some((tab) => tab.id === tabId))
      fallbackActiveTabId.value = tabId;
  }

  function ensureFileTab(
    target: FilePreviewTarget,
    projectId: string,
  ): FileContentTab {
    const key = fileTargetKey(target);
    const existing = tabs.value.find(
      (tab): tab is FileContentTab =>
        tab.kind === "file" && fileTargetKey(tab) === key,
    );
    if (existing) return existing;
    const path =
      target.source === "project" ? target.relativePath : target.path;
    const tab: FileContentTab = {
      ...target,
      id: `file-${crypto.randomUUID()}`,
      kind: "file",
      label: fileName(path),
      projectId: target.source === "project" ? target.projectId : projectId,
    };
    tabs.value = [...tabs.value, tab];
    return tab;
  }

  /** Open or reuse the tab for a file the user selected in the project. */
  function openFile(file: ProjectFilePreviewRequest): FileContentTab {
    return ensureFileTab({ ...file, source: "project" }, file.projectId);
  }

  /**
   * Open or reuse the tab for a file the agent presented. Reuses the existing
   * tab for the same file so presenting twice refreshes attention instead of
   * duplicating the view.
   */
  function presentFile(
    target: FilePreviewTarget,
    projectId: string,
    toolCallId?: string,
  ): FileContentTab {
    if (toolCallId) presentedTargets.set(toolCallId, target);
    return ensureFileTab(target, projectId);
  }

  function presentedTargetFor(
    toolCallId: string,
  ): FilePreviewTarget | undefined {
    return presentedTargets.get(toolCallId);
  }

  function makeDraftTab(projectId: string): DraftSessionTab {
    while (
      tabs.value.some((tab) => tab.id === `session-${nextSessionTabNumber}`)
    )
      nextSessionTabNumber += 1;
    const tab = {
      id: `session-${nextSessionTabNumber}`,
      kind: "session" as const,
      projectId,
      state: "draft" as const,
    };
    nextSessionTabNumber += 1;
    return tab;
  }

  /**
   * Open a new-session tab. New drafts go to the temporary workspace unless a
   * project is given; reusing a draft retargets it only when one is given.
   */
  function createSessionTab({
    projectId,
    reuseDraft = true,
  }: { projectId?: string; reuseDraft?: boolean } = {}): DraftSessionTab {
    const existingDraft = tabs.value.find(
      (tab): tab is DraftSessionTab =>
        tab.kind === "session" && tab.state === "draft",
    );
    if (reuseDraft && existingDraft) {
      if (projectId) setDraftProject(existingDraft.id, projectId);
      return (
        tabs.value.find(
          (tab): tab is DraftSessionTab => tab.id === existingDraft.id,
        ) ?? existingDraft
      );
    }

    const tab = makeDraftTab(projectId ?? TEMPORARY_WORKSPACE_PROJECT_ID);
    tabs.value = [...tabs.value, tab];
    return tab;
  }

  /** Change where a draft will be sent. Bound sessions keep their project. */
  function setDraftProject(tabId: string, projectId: string): boolean {
    const target = tabs.value.find((tab) => tab.id === tabId);
    if (target?.kind !== "session" || target.state !== "draft") return false;
    if (target.projectId === projectId) return true;
    tabs.value = tabs.value.map((tab) =>
      tab.id === tabId ? { ...target, projectId } : tab,
    );
    return true;
  }

  function beginPrompt(tabId: string, message: string): boolean {
    const target = tabs.value.find((tab) => tab.id === tabId);
    if (!target || target.kind !== "session") return false;
    if (target.state !== "draft") return target.state === "bound";

    const creating: CreatingSessionTab = {
      id: target.id,
      kind: "session",
      label: message,
      projectId: target.projectId,
      state: "creating",
    };
    tabs.value = tabs.value.map((tab) =>
      tab.id === target.id ? creating : tab,
    );
    return true;
  }

  function failPrompt(tabId: string): string | null {
    const target = tabs.value.find((tab) => tab.id === tabId);
    if (!target || target.kind !== "session" || target.state !== "creating") {
      return null;
    }
    const existingDraft = tabs.value.find(
      (tab): tab is DraftSessionTab =>
        tab.kind === "session" && tab.state === "draft" && tab.id !== tabId,
    );
    if (existingDraft) {
      addAttachments(existingDraft.id, attachmentsFor(tabId));
      tabs.value = tabs.value.filter((tab) => tab.id !== tabId);
      return existingDraft.id;
    }
    const draft: DraftSessionTab = {
      id: target.id,
      kind: "session",
      projectId: target.projectId,
      state: "draft",
    };
    tabs.value = tabs.value.map((tab) => (tab.id === target.id ? draft : tab));
    return draft.id;
  }

  function openSession(
    session: PineSessionSummary,
    projectId: string,
    reusableTabId?: string,
  ): BoundSessionTab {
    const existing = tabs.value.find(
      (tab): tab is BoundSessionTab =>
        tab.kind === "session" &&
        tab.state === "bound" &&
        tab.sessionId === session.id,
    );
    if (existing) {
      updateSession(session);
      return existing;
    }

    const current = tabs.value.find(
      (tab): tab is DraftSessionTab =>
        tab.id === reusableTabId &&
        tab.kind === "session" &&
        tab.state === "draft",
    );
    const tab: BoundSessionTab = {
      id: current?.state === "draft" ? current.id : makeDraftTab(projectId).id,
      kind: "session",
      projectId,
      state: "bound",
      sessionId: session.id,
      ...(sessionLabel(session) ? { label: sessionLabel(session) } : {}),
    };

    if (current?.state === "draft") {
      tabs.value = tabs.value.map((candidate) =>
        candidate.id === current.id ? tab : candidate,
      );
    } else {
      tabs.value = [...tabs.value, tab];
    }
    return tab;
  }

  function bindSession(
    tabId: string,
    session: PineSessionSummary,
  ): BoundSessionTab | null {
    const target = tabs.value.find((tab) => tab.id === tabId);
    if (!target || target.kind !== "session") return null;

    const existing = tabs.value.find(
      (tab): tab is BoundSessionTab =>
        tab.kind === "session" &&
        tab.state === "bound" &&
        tab.sessionId === session.id &&
        tab.id !== tabId,
    );
    if (existing) {
      addAttachments(existing.id, attachmentsFor(tabId));
      tabs.value = tabs.value.filter((tab) => tab.id !== tabId);
      updateSession(session);
      return existing;
    }

    const bound: BoundSessionTab = {
      id: tabId,
      kind: "session",
      projectId: target.projectId,
      state: "bound",
      sessionId: session.id,
      ...(sessionLabel(session) ? { label: sessionLabel(session) } : {}),
    };
    tabs.value = tabs.value.map((tab) => (tab.id === tabId ? bound : tab));
    return bound;
  }

  function updateSession(session: PineSessionSummary): void {
    const label = sessionLabel(session);
    tabs.value = tabs.value.map((tab) => {
      if (
        tab.kind !== "session" ||
        tab.state !== "bound" ||
        tab.sessionId !== session.id
      ) {
        return tab;
      }
      return {
        ...tab,
        ...(label ? { label } : {}),
      };
    });
  }

  function close(tabId: string, activeTabId: string): string {
    const closingIndex = tabs.value.findIndex((tab) => tab.id === tabId);
    if (closingIndex < 0) return activeTabId;

    const wasActive = activeTabId === tabId;
    const nextTabs = tabs.value.filter((tab) => tab.id !== tabId);

    const nextActiveTabId = wasActive
      ? (nextTabs[Math.min(closingIndex, nextTabs.length - 1)]?.id ?? "")
      : activeTabId;
    if (wasActive) fallbackActiveTabId.value = nextActiveTabId;
    tabs.value = nextTabs;
    return nextActiveTabId;
  }

  function removeSession(sessionId: string, activeTabId: string): string {
    const removedIds = new Set(
      tabs.value
        .filter(
          (tab): tab is BoundSessionTab =>
            tab.kind === "session" &&
            tab.state === "bound" &&
            tab.sessionId === sessionId,
        )
        .map((tab) => tab.id),
    );
    if (removedIds.size === 0) return activeTabId;

    const activeWasRemoved = removedIds.has(activeTabId);
    tabs.value = tabs.value.filter((tab) => !removedIds.has(tab.id));
    if (activeWasRemoved) {
      const nextActiveTabId = tabs.value[0]?.id ?? "";
      fallbackActiveTabId.value = nextActiveTabId;
      return nextActiveTabId;
    }
    return activeTabId;
  }

  /** Close every tab of a deleted project. */
  function removeProject(projectId: string): void {
    const remaining = tabs.value.filter((tab) => tab.projectId !== projectId);
    if (remaining.length === tabs.value.length) return;
    tabs.value = remaining.length > 0 ? remaining : initialTabs();
    if (!tabs.value.some((tab) => tab.id === fallbackActiveTabId.value))
      fallbackActiveTabId.value = tabs.value[0]?.id ?? null;
  }

  function reset(): void {
    presentedTargets.clear();
    composerAttachments.value = {};
    nextSessionTabNumber = 2;
    fallbackActiveTabId.value = null;
    tabs.value = initialTabs();
  }

  return {
    addAttachments,
    attachmentsFor,
    beginPrompt,
    bindSession,
    close,
    composerAttachments,
    createSessionTab,
    failPrompt,
    fallbackActiveTabId,
    moveTab,
    openFile,
    openSession,
    presentFile,
    presentedTargetFor,
    removeProject,
    removeSession,
    reset,
    setActiveTab,
    setAttachments,
    setDraftProject,
    tabs,
    updateSession,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useContentTabsStore, import.meta.hot));
}
