import { acceptHMRUpdate, defineStore } from "pinia";
import { reactive, ref, watch } from "vue";
import { readContentTabs, writeContentTabs } from "@/lib/contentTabStorage";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import { isQuickComposerHandoffWindow } from "@/stores/quickComposerHandoff";
import type { PineSessionSummary } from "@/shared/sessions";
import type {
  FilePreviewTarget,
  FileReveal,
  ProjectFilePreviewRequest,
} from "@/shared/projectFiles";
import type { PineAttachment } from "@/shared/attachments";
import { fileName, fileTargetKey } from "@/lib/filePreviewTarget";
import { randomId } from "@/lib/randomId";
import { parseFileReveal } from "@/shared/projectFiles";
import { preferenceStorage } from "@/lib/preferenceStorage";
import {
  uniqueSessionMutators,
  type PineSessionMutator,
} from "@/shared/sessionMutators";

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
  /** Optional source location for the most recent presentation. */
  reveal?: FileReveal;
} & FilePreviewTarget;

export interface DraftSessionTab {
  id: string;
  kind: "session";
  projectId: string;
  state: "draft";
  /** Session state the first message sets up, e.g. pre-activated authoring
   * for "Create with Pine". */
  mutators?: PineSessionMutator[];
}

export interface CreatingSessionTab {
  id: string;
  kind: "session";
  label: string;
  projectId: string;
  state: "creating";
  /** Kept so a failed first message returns them to the draft. */
  mutators?: PineSessionMutator[];
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

/** A closed tab that can come back, with the slot it left. */
interface ClosedTab {
  tab: BoundSessionTab | FileContentTab;
  index: number;
}

const CLOSED_TABS_LIMIT = 20;

function sessionLabel(session: PineSessionSummary): string | undefined {
  return session.name || session.automationRun?.name || session.preview;
}

/** Where new drafts go: the project the user last chose for one. */
export const LAST_DRAFT_PROJECT_STORAGE_KEY = "pine.last-draft-project";

function readLastDraftProject(): string {
  try {
    return (
      preferenceStorage.getItem(LAST_DRAFT_PROJECT_STORAGE_KEY) ||
      TEMPORARY_WORKSPACE_PROJECT_ID
    );
  } catch {
    return TEMPORARY_WORKSPACE_PROJECT_ID;
  }
}

export const useContentTabsStore = defineStore("content-tabs", () => {
  let nextSessionTabNumber = 2;
  const lastDraftProjectId = ref(readLastDraftProject());
  /** It starts with one draft; the floating composer chose its project. */
  const isHandoffWindow = isQuickComposerHandoffWindow();

  function initialTabs(): ProjectContentTab[] {
    return [
      {
        id: "session-1",
        kind: "session",
        projectId: isHandoffWindow
          ? TEMPORARY_WORKSPACE_PROJECT_ID
          : lastDraftProjectId.value,
        state: "draft",
      },
    ];
  }

  /** Remember a project the user chose for a draft, for the next draft. */
  function rememberDraftProject(projectId: string): void {
    lastDraftProjectId.value = projectId;
    try {
      if (projectId === TEMPORARY_WORKSPACE_PROJECT_ID)
        preferenceStorage.removeItem(LAST_DRAFT_PROJECT_STORAGE_KEY);
      else preferenceStorage.setItem(LAST_DRAFT_PROJECT_STORAGE_KEY, projectId);
    } catch {
      // The next draft then starts in No Project.
    }
  }

  const saved = isHandoffWindow ? null : readContentTabs();
  const tabs = ref<ProjectContentTab[]>(saved?.tabs ?? initialTabs());
  /** A tab whose composer should take focus once it is shown. */
  const composerFocusTabId = ref<string | null>(null);
  // Main resolves a presentation to the exact file target, including its
  // project folder or temporary external-file grant. Keep that association
  // after a tab closes so its tool marker can reopen the same preview.
  // Reactive so the artifacts list follows a presented file that was renamed.
  const presentedTargets = reactive(new Map<string, FilePreviewTarget>());
  /** Presentations whose file was moved to the trash from the artifacts list. */
  const removedPresentations = reactive(new Set<string>());
  const composerAttachments = ref<Record<string, PineAttachment[]>>({});
  /**
   * The one tab a casual open (sidebar, search, file tree) may replace, as
   * in VS Code's preview tab. It stops being one as soon as the user does
   * anything with it. Not persisted: after a restart every tab is kept.
   */
  const previewTabId = ref<string | null>(null);
  /** Recently closed tabs, newest last, for reopening. */
  const closedTabs = ref<ClosedTab[]>([]);
  watch(
    () => tabs.value.map((tab) => tab.id),
    (ids) => {
      for (const id of Object.keys(composerAttachments.value)) {
        if (!ids.includes(id)) delete composerAttachments.value[id];
      }
    },
    { flush: "sync" },
  );

  /** The tab is the user's now: casual opens no longer replace it. */
  function keepTab(tabId: string): void {
    if (previewTabId.value === tabId) previewTabId.value = null;
  }

  function isPreviewTab(tabId: string): boolean {
    return previewTabId.value === tabId;
  }

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
    if (attachments.length) keepTab(tabId);
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
    keepTab(tabId);
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

  // A preview tab that left the list (closed, removed, merged) has no slot.
  watch(
    () => tabs.value.some((tab) => tab.id === previewTabId.value),
    (present) => {
      if (!present) previewTabId.value = null;
    },
    { flush: "sync" },
  );

  /**
   * Add a tab. A preview tab takes the place of the current preview tab, in
   * the same position, instead of adding another; otherwise it is appended.
   */
  function placeTab(tab: ProjectContentTab, preview: boolean): void {
    const previewIndex = preview
      ? tabs.value.findIndex((candidate) => candidate.id === previewTabId.value)
      : -1;
    if (previewIndex >= 0) {
      tabs.value = tabs.value.map((candidate, index) =>
        index === previewIndex ? tab : candidate,
      );
    } else {
      tabs.value = [...tabs.value, tab];
    }
    if (preview) previewTabId.value = tab.id;
  }

  function setActiveTab(tabId: string): void {
    if (tabs.value.some((tab) => tab.id === tabId))
      fallbackActiveTabId.value = tabId;
  }

  function ensureFileTab(
    target: FilePreviewTarget,
    projectId: string,
    preview = false,
  ): FileContentTab {
    const key = fileTargetKey(target);
    const existing = tabs.value.find(
      (tab): tab is FileContentTab =>
        tab.kind === "file" && fileTargetKey(tab) === key,
    );
    if (existing) {
      // Opening a file on purpose keeps the tab it already sits in.
      if (!preview) keepTab(existing.id);
      return existing;
    }
    const path =
      target.source === "project" ? target.relativePath : target.path;
    const tab: FileContentTab = {
      ...target,
      id: `file-${randomId()}`,
      kind: "file",
      label: fileName(path),
      projectId: target.source === "project" ? target.projectId : projectId,
    };
    placeTab(tab, preview);
    return tab;
  }

  /**
   * Open or reuse the tab for a file the user selected in the project. A
   * casual open (`preview`) replaces the current preview tab.
   */
  function openFile(
    file: ProjectFilePreviewRequest,
    { preview = false }: { preview?: boolean } = {},
  ): FileContentTab {
    return ensureFileTab(
      { ...file, source: "project" },
      file.projectId,
      preview,
    );
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
    reveal?: FileReveal,
  ): FileContentTab {
    if (toolCallId) presentedTargets.set(toolCallId, target);
    const tab = ensureFileTab(target, projectId);
    const location = parseFileReveal(reveal);
    if (location) tab.reveal = location;
    else delete tab.reveal;
    return tab;
  }

  /** Remembers where a presented file resolved, without opening a tab. */
  function rememberPresentedTarget(
    toolCallId: string,
    target: FilePreviewTarget,
  ): void {
    presentedTargets.set(toolCallId, target);
  }

  function presentedTargetFor(
    toolCallId: string,
  ): FilePreviewTarget | undefined {
    return presentedTargets.get(toolCallId);
  }

  function markPresentationRemoved(toolCallId: string): void {
    presentedTargets.delete(toolCallId);
    removedPresentations.add(toolCallId);
  }

  function isPresentationRemoved(toolCallId: string): boolean {
    return removedPresentations.has(toolCallId);
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
   * Open a new-session tab. New drafts go to the project last chosen for a
   * draft unless one is given; reusing a draft retargets it only when one is
   * given.
   */
  function createSessionTab({
    projectId,
    reuseDraft = true,
    mutators,
    replaceActivePreview,
  }: {
    projectId?: string;
    reuseDraft?: boolean;
    mutators?: PineSessionMutator[];
    /** The active tab; when it is an untouched preview tab, the new draft
     * takes its place instead of adding a tab. */
    replaceActivePreview?: string;
  } = {}): DraftSessionTab {
    const existingDraft = tabs.value.find(
      (tab): tab is DraftSessionTab =>
        tab.kind === "session" && tab.state === "draft",
    );
    if (reuseDraft && existingDraft) {
      if (projectId) setDraftProject(existingDraft.id, projectId);
      if (mutators) setDraftMutators(existingDraft.id, mutators);
      composerFocusTabId.value = existingDraft.id;
      return (
        tabs.value.find(
          (tab): tab is DraftSessionTab => tab.id === existingDraft.id,
        ) ?? existingDraft
      );
    }

    const created = makeDraftTab(projectId ?? lastDraftProjectId.value);
    const tab: DraftSessionTab = mutators?.length
      ? { ...created, mutators: uniqueSessionMutators(mutators) }
      : created;
    const replaced =
      replaceActivePreview !== undefined &&
      replaceActivePreview === previewTabId.value
        ? tabs.value.findIndex(
            (candidate) => candidate.id === previewTabId.value,
          )
        : -1;
    if (replaced >= 0) {
      tabs.value = tabs.value.map((candidate, index) =>
        index === replaced ? tab : candidate,
      );
    } else {
      tabs.value = [...tabs.value, tab];
    }
    composerFocusTabId.value = tab.id;
    return tab;
  }

  /** Replace what a draft's first message sets up; empty clears it. */
  function setDraftMutators(
    tabId: string,
    mutators: readonly PineSessionMutator[],
  ): boolean {
    const target = tabs.value.find((tab) => tab.id === tabId);
    if (target?.kind !== "session" || target.state !== "draft") return false;
    if (mutators.length) keepTab(tabId);
    const rest: DraftSessionTab = { ...target };
    delete rest.mutators;
    const next: DraftSessionTab = mutators.length
      ? { ...rest, mutators: uniqueSessionMutators(mutators) }
      : rest;
    tabs.value = tabs.value.map((tab) => (tab.id === tabId ? next : tab));
    return true;
  }

  function mutatorsFor(tabId: string): PineSessionMutator[] {
    const target = tabs.value.find((tab) => tab.id === tabId);
    return target?.kind === "session" && target.state !== "bound"
      ? (target.mutators ?? [])
      : [];
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
    keepTab(tabId);

    const creating: CreatingSessionTab = {
      id: target.id,
      kind: "session",
      label: message,
      projectId: target.projectId,
      state: "creating",
      ...(target.mutators ? { mutators: target.mutators } : {}),
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
      if (target.mutators?.length)
        setDraftMutators(existingDraft.id, [
          ...(existingDraft.mutators ?? []),
          ...target.mutators,
        ]);
      tabs.value = tabs.value.filter((tab) => tab.id !== tabId);
      return existingDraft.id;
    }
    const draft: DraftSessionTab = {
      id: target.id,
      kind: "session",
      projectId: target.projectId,
      state: "draft",
      ...(target.mutators ? { mutators: target.mutators } : {}),
    };
    tabs.value = tabs.value.map((tab) => (tab.id === target.id ? draft : tab));
    return draft.id;
  }

  function openSession(
    session: PineSessionSummary,
    projectId: string,
    reusableTabId?: string,
    { preview = false }: { preview?: boolean } = {},
  ): BoundSessionTab {
    const existing = tabs.value.find(
      (tab): tab is BoundSessionTab =>
        tab.kind === "session" &&
        tab.state === "bound" &&
        tab.sessionId === session.id,
    );
    if (existing) {
      updateSession(session);
      if (!preview) keepTab(existing.id);
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
      if (preview) previewTabId.value = tab.id;
      else keepTab(tab.id);
    } else {
      placeTab(tab, preview);
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
    // A running session reports itself on every appended entry; leave the
    // tabs (and their persisted copy) alone unless a label actually changes.
    if (!label) return;
    let changed = false;
    const next = tabs.value.map((tab) => {
      if (
        tab.kind !== "session" ||
        tab.state !== "bound" ||
        tab.sessionId !== session.id ||
        tab.label === label
      ) {
        return tab;
      }
      changed = true;
      return { ...tab, label };
    });
    if (changed) tabs.value = next;
  }

  function close(tabId: string, activeTabId: string): string {
    const closingIndex = tabs.value.findIndex((tab) => tab.id === tabId);
    if (closingIndex < 0) return activeTabId;

    const wasActive = activeTabId === tabId;
    const nextTabs = tabs.value.filter((tab) => tab.id !== tabId);
    const closing = tabs.value[closingIndex];
    // Drafts hold nothing to come back to, and a presented file's access
    // grant only covers the run that presented it.
    if (
      closing &&
      ((closing.kind === "session" && closing.state === "bound") ||
        (closing.kind === "file" && closing.source === "project"))
    ) {
      closedTabs.value = [
        ...closedTabs.value.slice(1 - CLOSED_TABS_LIMIT),
        { tab: closing, index: closingIndex },
      ];
    }

    const nextActiveTabId = wasActive
      ? (nextTabs[Math.min(closingIndex, nextTabs.length - 1)]?.id ?? "")
      : activeTabId;
    if (wasActive) fallbackActiveTabId.value = nextActiveTabId;
    tabs.value = nextTabs;
    return nextActiveTabId;
  }

  function sameContent(a: ProjectContentTab, b: ProjectContentTab): boolean {
    if (a.kind === "file" || b.kind === "file")
      return (
        a.kind === "file" &&
        b.kind === "file" &&
        fileTargetKey(a) === fileTargetKey(b)
      );
    return (
      a.state === "bound" && b.state === "bound" && a.sessionId === b.sessionId
    );
  }

  /**
   * Bring back the most recently closed tab, in the slot it left. Content
   * that is open again in the meantime is skipped. Returns the tab to show.
   */
  function reopenClosedTab(): ProjectContentTab | null {
    while (closedTabs.value.length > 0) {
      const entry = closedTabs.value.at(-1)!;
      closedTabs.value = closedTabs.value.slice(0, -1);
      if (tabs.value.some((tab) => sameContent(tab, entry.tab))) continue;
      const tab = tabs.value.some((candidate) => candidate.id === entry.tab.id)
        ? { ...entry.tab, id: `${entry.tab.kind}-${randomId()}` }
        : entry.tab;
      const next = [...tabs.value];
      next.splice(Math.min(entry.index, next.length), 0, tab);
      tabs.value = next;
      return tab;
    }
    return null;
  }

  function removeSession(sessionId: string, activeTabId: string): string {
    closedTabs.value = closedTabs.value.filter(
      ({ tab }) => tab.kind !== "session" || tab.sessionId !== sessionId,
    );
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

  /** Tabs of a session that moved to another project follow it there. */
  function moveSessionToProject(sessionId: string, projectId: string): void {
    tabs.value = tabs.value.map((tab) =>
      tab.kind === "session" &&
      tab.state === "bound" &&
      tab.sessionId === sessionId
        ? { ...tab, projectId }
        : tab,
    );
  }

  /** Close every tab of a deleted project. */
  function removeProject(projectId: string): void {
    if (lastDraftProjectId.value === projectId)
      rememberDraftProject(TEMPORARY_WORKSPACE_PROJECT_ID);
    closedTabs.value = closedTabs.value.filter(
      ({ tab }) => tab.projectId !== projectId,
    );
    const remaining = tabs.value.filter((tab) => tab.projectId !== projectId);
    if (remaining.length === tabs.value.length) return;
    tabs.value = remaining.length > 0 ? remaining : initialTabs();
    if (!tabs.value.some((tab) => tab.id === fallbackActiveTabId.value))
      fallbackActiveTabId.value = tabs.value[0]?.id ?? null;
  }

  function clearComposerFocus(tabId: string): void {
    if (composerFocusTabId.value === tabId) composerFocusTabId.value = null;
  }

  function reset(): void {
    presentedTargets.clear();
    removedPresentations.clear();
    composerFocusTabId.value = null;
    composerAttachments.value = {};
    previewTabId.value = null;
    closedTabs.value = [];
    nextSessionTabNumber = 2;
    fallbackActiveTabId.value = null;
    tabs.value = initialTabs();
  }

  return {
    addAttachments,
    attachmentsFor,
    beginPrompt,
    bindSession,
    clearComposerFocus,
    close,
    composerAttachments,
    composerFocusTabId,
    createSessionTab,
    failPrompt,
    fallbackActiveTabId,
    isPreviewTab,
    keepTab,
    lastDraftProjectId,
    moveSessionToProject,
    moveTab,
    mutatorsFor,
    openFile,
    openSession,
    presentFile,
    presentedTargetFor,
    previewTabId,
    rememberPresentedTarget,
    reopenClosedTab,
    markPresentationRemoved,
    isPresentationRemoved,
    rememberDraftProject,
    removeProject,
    removeSession,
    reset,
    setActiveTab,
    setAttachments,
    setDraftMutators,
    setDraftProject,
    tabs,
    updateSession,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useContentTabsStore, import.meta.hot));
}
