import { defineStore } from "pinia";
import { computed, reactive, ref, shallowReactive, watch } from "vue";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  applyWorkbenchCommand,
  closePanel,
  openPanel,
  panelPosition,
  parseWorkbenchLayout,
  presentInWorkbench,
  setWorkbenchOpen,
  type WorkbenchLayout,
  type WorkbenchPreview,
} from "@/lib/workbenchLayout";
import {
  clampWorkbenchSplit,
  clampWorkbenchWidth,
  FILE_COMMENTS_PANEL,
  FILE_DETAILS_PANEL,
  highlightedPanel,
  WORKBENCH_DEFAULT_WIDTH,
  SIDE_CHAT_PANEL,
  WORKBENCH_PANELS,
  type FileWorkbenchPanel,
  type WorkbenchCommand,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import { isQuickComposerHandoffWindow } from "@/stores/quickComposerHandoff";
import { useSessionStore } from "@/stores/session";
import { useProjectStore } from "@/stores/project";
import { isAssistantProject } from "@/shared/assistant";
import { preferenceStorage } from "@/lib/preferenceStorage";

export const WORKBENCH_STORAGE_KEY = "pine.workbench.v1";
/** Layouts of new conversations, until their session exists. */
export const DRAFT_WORKBENCH_KEY = "draft";
export const WORKBENCH_WIDTH_STORAGE_KEY = "pine.workbench-width.v1";
/** Keys of file tabs' layouts, which are never stored. */
const FILE_KEY_PREFIX = "file:";
/** Only the most recently arranged sessions keep their layout. */
const MAX_STORED_LAYOUTS = 200;
/**
 * The Assistant works in no folder and makes no files, so its workbench
 * leaves these out; a card that would show one shows Tasks instead.
 */
export const ASSISTANT_HIDDEN_PANELS: readonly WorkbenchPanel[] = [
  "files",
  "artifacts",
];

/** A layout as the Assistant shows it, without the panels it has no use for. */
export function assistantLayout(layout: WorkbenchLayout): WorkbenchLayout {
  const keep = (panel: WorkbenchPanel | null) =>
    panel && !ASSISTANT_HIDDEN_PANELS.includes(panel) ? panel : null;
  const top = keep(layout.top);
  const bottom = keep(layout.bottom);
  if (top) return { ...layout, top, bottom: bottom === top ? null : bottom };
  if (bottom) return { ...layout, top: bottom, bottom: null };
  return { ...layout, top: "tasks", bottom: null };
}

function readLayouts(): Map<string, WorkbenchLayout> {
  const layouts = new Map<string, WorkbenchLayout>();
  try {
    const value: unknown = JSON.parse(
      preferenceStorage.getItem(WORKBENCH_STORAGE_KEY) ?? "null",
    );
    if (typeof value !== "object" || value === null) return layouts;
    for (const [key, stored] of Object.entries(value)) {
      const layout = parseWorkbenchLayout(stored);
      if (layout) layouts.set(key, layout);
    }
  } catch {
    // Corrupt or unavailable storage falls back to the default layout.
  }
  return layouts;
}

function readWidth(): number {
  try {
    const stored = preferenceStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY);
    return stored === null
      ? WORKBENCH_DEFAULT_WIDTH
      : clampWorkbenchWidth(Number(stored));
  } catch {
    return WORKBENCH_DEFAULT_WIDTH;
  }
}

/**
 * The workbench of each session: whether it is open, which cards it stacks,
 * and the file in its preview. The column follows the active session; a
 * session without a layout of its own starts from the draft's.
 */
export const useWorkbenchStore = defineStore("workbench", () => {
  const sessionStore = useSessionStore();
  const layouts = reactive(readLayouts());
  /** What the column renders; it trails `activeLayout.open` while resizing. */
  const displayedOpen = ref(false);
  /** The column still shows while the window edge clips it away. */
  const isClosing = ref(false);
  /** One width for every session, so switching sessions never resizes. */
  const width = ref(readWidth());
  /** The user is dragging the column's edge. */
  const isResizing = ref(false);
  /**
   * Cards the agent pointed the user at, per session. They pulse until the
   * user reaches the card or it leaves the workbench, and never outlive the
   * window: a highlight is a nudge, not part of the layout.
   */
  const highlights = reactive(new Map<string, Set<WorkbenchPanel>>());

  /**
   * The file tab in front, if any: its column shows the file's details and
   * comments instead of the session's cards.
   */
  const activeFile = ref<{
    tabId: string;
    /** The file takes comments, so the comments card shows. */
    comments: boolean;
    commentCount: number;
  }>();
  /** Whether each file tab's column is open; closed until asked for. */
  const fileOpen = reactive(new Map<string, boolean>());
  /** One split for every file tab. */
  const fileSplit = ref(50);
  /**
   * Where the file cards' content goes: the file tab in front renders its
   * details and comments into these elements, so they stay its own state.
   */
  const fileCardTargets = shallowReactive(
    new Map<FileWorkbenchPanel, HTMLElement>(),
  );

  function setFileCardTarget(
    panel: FileWorkbenchPanel,
    element: HTMLElement | null,
  ): void {
    if (element) fileCardTargets.set(panel, element);
    else fileCardTargets.delete(panel);
  }

  /**
   * The session of the tab in front (`DRAFT_WORKBENCH_KEY` for a draft),
   * `undefined` for a file tab, or `null` when no tab is open; the content
   * tabs report it as soon as the front tab changes, before the session store
   * has resumed that session.
   */
  const frontSession = ref<string | null>();
  /** The tab in front came to an empty content area. */
  const leftTabless = ref(false);
  /** With no tab open, the column has nothing to show and stays closed. */
  const isTabless = computed(() => frontSession.value === null);
  /** The file tab that last left the front. */
  const departedFile = ref<string>();

  const activeKey = computed(() => {
    if (activeFile.value) return `${FILE_KEY_PREFIX}${activeFile.value.tabId}`;
    const session = sessionStore.activeSession?.id ?? DRAFT_WORKBENCH_KEY;
    // Leaving a file tab for another session's tab, the column keeps the
    // file's state until that session becomes the active one; falling back
    // to the session still active would flash its column open or shut.
    if (
      departedFile.value !== undefined &&
      typeof frontSession.value === "string" &&
      frontSession.value !== session
    )
      return `${FILE_KEY_PREFIX}${departedFile.value}`;
    return session;
  });

  // Whatever session becomes active next ends the wait, a failed resume too.
  watch(
    () => sessionStore.activeSession?.id,
    () => {
      departedFile.value = undefined;
      leftTabless.value = false;
    },
    { flush: "sync" },
  );

  /**
   * A window continuing a floating composer message opens collapsed, until
   * the user arranges its workbench.
   */
  let startsCollapsed = isQuickComposerHandoffWindow();

  function fileLayout(tabId: string): WorkbenchLayout {
    const comments =
      activeFile.value?.tabId === tabId && activeFile.value.comments;
    return {
      open: fileOpen.get(tabId) ?? false,
      // Comments come first where the file takes them; details sit below.
      top: comments ? FILE_COMMENTS_PANEL : FILE_DETAILS_PANEL,
      bottom: comments ? FILE_DETAILS_PANEL : null,
      split: fileSplit.value,
      preview: null,
    };
  }

  function layoutFor(key: string): WorkbenchLayout {
    if (key.startsWith(FILE_KEY_PREFIX))
      return fileLayout(key.slice(FILE_KEY_PREFIX.length));
    const own = layouts.get(key);
    if (own && !(startsCollapsed && key === DRAFT_WORKBENCH_KEY)) return own;
    const draft = layouts.get(DRAFT_WORKBENCH_KEY);
    // A session inherits the draft's arrangement, not the file it previewed.
    const inherited = draft
      ? { ...draft, preview: null }
      : { ...DEFAULT_WORKBENCH_LAYOUT };
    return startsCollapsed ? { ...inherited, open: false } : inherited;
  }

  const projectStore = useProjectStore();
  /** The Assistant's tab is in front (not a file tab). */
  const isAssistant = computed(
    () =>
      !activeFile.value && isAssistantProject(projectStore.currentProjectId),
  );
  const activeLayout = computed(() => {
    const own = layoutFor(activeKey.value);
    const layout = isAssistant.value ? assistantLayout(own) : own;
    // A tab opening in an empty content area keeps the column closed until
    // its session is the active one, as when leaving a file tab.
    const waiting =
      leftTabless.value &&
      typeof frontSession.value === "string" &&
      frontSession.value !==
        (sessionStore.activeSession?.id ?? DRAFT_WORKBENCH_KEY);
    return isTabless.value || waiting ? { ...layout, open: false } : layout;
  });

  /** A split drag changed the layouts without writing them yet. */
  let unsaved = false;

  function save(): void {
    unsaved = false;
    try {
      preferenceStorage.setItem(
        WORKBENCH_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(layouts)),
      );
    } catch {
      // Keep the in-memory layouts when storage is unavailable.
    }
  }

  /**
   * The arrangement without the side chat card, which belongs to its own
   * conversation; a side chat alone gives its card back to the default panel.
   */
  function withoutSideChat(layout: WorkbenchLayout): WorkbenchLayout {
    if (!panelPosition(layout, SIDE_CHAT_PANEL)) return layout;
    const next = closePanel(layout, SIDE_CHAT_PANEL);
    return next.top === SIDE_CHAT_PANEL || !next.open
      ? { ...next, open: layout.open, top: DEFAULT_WORKBENCH_LAYOUT.top }
      : next;
  }

  // A new conversation starts from the arrangement of the session the user
  // just left, not the file it previewed or its side chat.
  watch(
    activeKey,
    (key, previous) => {
      if (
        key !== DRAFT_WORKBENCH_KEY ||
        previous === DRAFT_WORKBENCH_KEY ||
        previous.startsWith(FILE_KEY_PREFIX)
      )
        return;
      layouts.delete(DRAFT_WORKBENCH_KEY);
      layouts.set(DRAFT_WORKBENCH_KEY, {
        ...withoutSideChat(layoutFor(previous)),
        preview: null,
      });
      highlights.delete(DRAFT_WORKBENCH_KEY);
      save();
    },
    { flush: "sync" },
  );

  function update(
    key: string,
    change: (layout: WorkbenchLayout) => WorkbenchLayout,
    persist = true,
  ): void {
    const next = change(layoutFor(key));
    if (key.startsWith(FILE_KEY_PREFIX)) {
      // A file tab keeps only whether its column is open and the split.
      fileOpen.set(key.slice(FILE_KEY_PREFIX.length), next.open);
      fileSplit.value = next.split;
      return;
    }
    startsCollapsed = false;
    // Re-inserting keeps the most recently arranged sessions last.
    layouts.delete(key);
    layouts.set(key, next);
    for (const stale of layouts.keys()) {
      if (layouts.size <= MAX_STORED_LAYOUTS) break;
      if (stale !== DRAFT_WORKBENCH_KEY) layouts.delete(stale);
    }
    if (persist) save();
    else unsaved = true;
    const highlighted = highlights.get(key);
    if (!highlighted) return;
    for (const panel of highlighted)
      if (!next.open || !panelPosition(next, panel)) highlighted.delete(panel);
    if (!highlighted.size) highlights.delete(key);
  }

  /** Pulses a card of the session until the user reaches it. */
  function highlight(key: string, panel: WorkbenchPanel): void {
    const layout = layoutFor(key);
    if (!layout.open || !panelPosition(layout, panel)) return;
    const highlighted = highlights.get(key) ?? new Set<WorkbenchPanel>();
    highlighted.add(panel);
    highlights.set(key, highlighted);
  }

  /**
   * Applies an agent's `ui_workbench_*` command to its session. Every card the
   * command brings into view pulses, so the user notices what the agent
   * opened without the agent asking for it.
   */
  function apply(key: string, command: WorkbenchCommand): void {
    const before = layoutFor(key);
    update(key, (layout) => applyWorkbenchCommand(layout, command));
    for (const panel of WORKBENCH_PANELS) {
      if (!(before.open && panelPosition(before, panel))) highlight(key, panel);
    }
    const explicit = highlightedPanel(command);
    if (explicit) highlight(key, explicit);
  }

  function isHighlighted(panel: WorkbenchPanel): boolean {
    return highlights.get(activeKey.value)?.has(panel) ?? false;
  }

  /** The user reached a highlighted card, so it stops pulsing. */
  function acknowledge(panel: WorkbenchPanel): void {
    const highlighted = highlights.get(activeKey.value);
    if (!highlighted?.delete(panel)) return;
    if (!highlighted.size) highlights.delete(activeKey.value);
  }

  function present(key: string, preview: WorkbenchPreview): void {
    update(key, (layout) => presentInWorkbench(layout, preview));
  }

  function setOpen(open: boolean, key = activeKey.value): void {
    update(key, (layout) => setWorkbenchOpen(layout, open));
  }

  function toggle(): void {
    if (isTabless.value) return;
    setOpen(!activeLayout.value.open);
  }

  /** Shows a panel in a card, swapping with the card that showed it. */
  function showPanel(position: WorkbenchPosition, panel: WorkbenchPanel): void {
    update(activeKey.value, (layout) => openPanel(layout, panel, position));
  }

  function closeCard(panel: WorkbenchPanel): void {
    // A file tab's cards come and go together.
    if (activeFile.value) {
      setOpen(false);
      return;
    }
    update(activeKey.value, (layout) => {
      const next = closePanel(layout, panel);
      // Closing the last card keeps it as the one to reopen, but never the
      // side chat card; one that moves up into the top card stays.
      return !next.open && next.top === SIDE_CHAT_PANEL
        ? { ...next, top: DEFAULT_WORKBENCH_LAYOUT.top }
        : next;
    });
  }

  /** Shows the side chat card on top, above what the column showed first. */
  function showSideChat(): void {
    update(activeKey.value, (layout) => {
      if (panelPosition(layout, SIDE_CHAT_PANEL))
        return { ...layout, open: true };
      return layout.open && layout.top
        ? { ...layout, top: SIDE_CHAT_PANEL, bottom: layout.top }
        : { ...layout, open: true, top: SIDE_CHAT_PANEL, bottom: null };
    });
  }

  /** Picks the file for the preview card and shows it. */
  function preview(preview: WorkbenchPreview): void {
    present(activeKey.value, preview);
  }

  /** Empties the preview card, as when its file moves to a tab. */
  function clearPreview(): void {
    if (!activeLayout.value.preview) return;
    update(activeKey.value, (layout) => ({ ...layout, preview: null }));
  }

  /**
   * Moves the divider between the cards. A drag passes `persist: false` for
   * each step and calls `saveSplit` once it ends, so the preferences file is
   * written once per drag rather than per step.
   */
  function setSplit(split: number, { persist = true } = {}): void {
    const next = clampWorkbenchSplit(split);
    if (next === activeLayout.value.split) return;
    update(activeKey.value, (layout) => ({ ...layout, split: next }), persist);
  }

  /** Stores the split a drag left unsaved. */
  function saveSplit(): void {
    if (unsaved) save();
  }

  function setWidth(next: number): void {
    width.value = clampWorkbenchWidth(next);
  }

  /** Stores the width once a divider drag or window resize settles. */
  function saveWidth(): void {
    try {
      preferenceStorage.setItem(
        WORKBENCH_WIDTH_STORAGE_KEY,
        String(width.value),
      );
    } catch {
      // The width still applies until the window reloads.
    }
  }

  function setResizing(resizing: boolean): void {
    isResizing.value = resizing;
    if (!resizing) saveWidth();
  }

  /**
   * A file tab came to the front, or what it shows changed; `undefined` when
   * the tab with `tabId` left the front.
   */
  function showFile(
    tabId: string,
    file: { comments: boolean; commentCount: number } | undefined,
  ): void {
    if (file) {
      activeFile.value = { tabId, ...file };
      departedFile.value = undefined;
    } else if (activeFile.value?.tabId === tabId) {
      departedFile.value = tabId;
      activeFile.value = undefined;
    }
  }

  /** The tab in front changed; see `frontSession`. */
  function setFrontSession(key: string | null | undefined): void {
    // Holds change before the new front does, so a watcher never reads a
    // mix of the two.
    if (key !== null) {
      leftTabless.value = frontSession.value === null;
      // Between session tabs the column waits on the session it shows.
      if (!activeFile.value) departedFile.value = undefined;
    }
    frontSession.value = key;
  }

  function isFileOpen(tabId: string): boolean {
    return fileOpen.get(tabId) ?? false;
  }

  /** Opens or closes a file tab's column, in front or not. */
  function setFileOpen(tabId: string, open: boolean): void {
    fileOpen.set(tabId, open);
  }

  /** Forgets a closed file tab. */
  function forgetFile(tabId: string): void {
    showFile(tabId, undefined);
    fileOpen.delete(tabId);
  }

  function setDisplayedOpen(open: boolean): void {
    displayedOpen.value = open;
  }

  function setClosing(closing: boolean): void {
    isClosing.value = closing;
  }

  return {
    acknowledge,
    activeFile,
    activeKey,
    activeLayout,
    isAssistant,
    fileCardTargets,
    displayedOpen,
    forgetFile,
    isClosing,
    isFileOpen,
    isResizing,
    isTabless,
    width,
    apply,
    clearPreview,
    closeCard,
    highlight,
    isHighlighted,
    layoutFor,
    panelPosition: (panel: WorkbenchPanel) =>
      panelPosition(activeLayout.value, panel),
    present,
    preview,
    saveSplit,
    saveWidth,
    setClosing,
    setDisplayedOpen,
    setFileCardTarget,
    setFileOpen,
    setFrontSession,
    setOpen,
    setResizing,
    setSplit,
    setWidth,
    showFile,
    showPanel,
    showSideChat,
    toggle,
  };
});
