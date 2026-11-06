import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
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
  highlightedPanel,
  WORKBENCH_DEFAULT_WIDTH,
  SIDE_CHAT_PANEL,
  WORKBENCH_PANELS,
  type WorkbenchCommand,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import { isQuickComposerHandoffWindow } from "@/stores/quickComposerHandoff";
import { useSessionStore } from "@/stores/session";
import { preferenceStorage } from "@/lib/preferenceStorage";

export const WORKBENCH_STORAGE_KEY = "pine.workbench.v1";
/** Layouts of new conversations, until their session exists. */
export const DRAFT_WORKBENCH_KEY = "draft";
export const WORKBENCH_WIDTH_STORAGE_KEY = "pine.workbench-width.v1";
/** Only the most recently arranged sessions keep their layout. */
const MAX_STORED_LAYOUTS = 200;

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

  const activeKey = computed(
    () => sessionStore.activeSession?.id ?? DRAFT_WORKBENCH_KEY,
  );

  /**
   * A window continuing a floating composer message opens collapsed, until
   * the user arranges its workbench.
   */
  let startsCollapsed = isQuickComposerHandoffWindow();

  function layoutFor(key: string): WorkbenchLayout {
    const own = layouts.get(key);
    if (own && !(startsCollapsed && key === DRAFT_WORKBENCH_KEY)) return own;
    const draft = layouts.get(DRAFT_WORKBENCH_KEY);
    // A session inherits the draft's arrangement, not the file it previewed.
    const inherited = draft
      ? { ...draft, preview: null }
      : { ...DEFAULT_WORKBENCH_LAYOUT };
    return startsCollapsed ? { ...inherited, open: false } : inherited;
  }

  const activeLayout = computed(() => layoutFor(activeKey.value));

  function save(): void {
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
      if (key !== DRAFT_WORKBENCH_KEY || previous === DRAFT_WORKBENCH_KEY)
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
  ): void {
    const next = change(layoutFor(key));
    startsCollapsed = false;
    // Re-inserting keeps the most recently arranged sessions last.
    layouts.delete(key);
    layouts.set(key, next);
    for (const stale of layouts.keys()) {
      if (layouts.size <= MAX_STORED_LAYOUTS) break;
      if (stale !== DRAFT_WORKBENCH_KEY) layouts.delete(stale);
    }
    save();
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
    setOpen(!activeLayout.value.open);
  }

  /** Shows a panel in a card, swapping with the card that showed it. */
  function showPanel(position: WorkbenchPosition, panel: WorkbenchPanel): void {
    update(activeKey.value, (layout) => openPanel(layout, panel, position));
  }

  function closeCard(panel: WorkbenchPanel): void {
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

  function setSplit(split: number): void {
    const next = clampWorkbenchSplit(split);
    if (next === activeLayout.value.split) return;
    update(activeKey.value, (layout) => ({ ...layout, split: next }));
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

  function setDisplayedOpen(open: boolean): void {
    displayedOpen.value = open;
  }

  function setClosing(closing: boolean): void {
    isClosing.value = closing;
  }

  return {
    acknowledge,
    activeKey,
    activeLayout,
    displayedOpen,
    isClosing,
    isResizing,
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
    saveWidth,
    setClosing,
    setDisplayedOpen,
    setOpen,
    setResizing,
    setSplit,
    setWidth,
    showPanel,
    showSideChat,
    toggle,
  };
});
