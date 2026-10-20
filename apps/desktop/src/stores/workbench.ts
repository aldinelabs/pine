import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
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
  type WorkbenchCommand,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import { useSessionStore } from "@/stores/session";

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
      window.localStorage.getItem(WORKBENCH_STORAGE_KEY) ?? "null",
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
    const stored = window.localStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY);
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
  /**
   * Bumped when a layout changes other than by dragging the divider, so the
   * split view picks up the new sizes.
   */
  const arrangement = ref(0);
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

  function layoutFor(key: string): WorkbenchLayout {
    const own = layouts.get(key);
    if (own) return own;
    const draft = layouts.get(DRAFT_WORKBENCH_KEY);
    // A session inherits the draft's arrangement, not the file it previewed.
    return draft
      ? { ...draft, preview: null }
      : { ...DEFAULT_WORKBENCH_LAYOUT };
  }

  const activeLayout = computed(() => layoutFor(activeKey.value));

  function save(): void {
    try {
      window.localStorage.setItem(
        WORKBENCH_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(layouts)),
      );
    } catch {
      // Keep the in-memory layouts when storage is unavailable.
    }
  }

  function update(
    key: string,
    change: (layout: WorkbenchLayout) => WorkbenchLayout,
    rearranged = true,
  ): void {
    const next = change(layoutFor(key));
    // Re-inserting keeps the most recently arranged sessions last.
    layouts.delete(key);
    layouts.set(key, next);
    for (const stale of layouts.keys()) {
      if (layouts.size <= MAX_STORED_LAYOUTS) break;
      if (stale !== DRAFT_WORKBENCH_KEY) layouts.delete(stale);
    }
    if (rearranged) arrangement.value += 1;
    save();
    const highlighted = highlights.get(key);
    if (!highlighted) return;
    for (const panel of highlighted)
      if (!next.open || !panelPosition(next, panel)) highlighted.delete(panel);
    if (!highlighted.size) highlights.delete(key);
  }

  /** Applies an agent's `ui_workbench_*` command to its session. */
  function apply(key: string, command: WorkbenchCommand): void {
    update(key, (layout) => applyWorkbenchCommand(layout, command));
    const panel = highlightedPanel(command);
    const layout = layoutFor(key);
    if (!panel || !layout.open || !panelPosition(layout, panel)) return;
    const highlighted = highlights.get(key) ?? new Set<WorkbenchPanel>();
    highlighted.add(panel);
    highlights.set(key, highlighted);
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
    update(activeKey.value, (layout) => closePanel(layout, panel));
  }

  /** Picks the file for the preview card and shows it. */
  function preview(preview: WorkbenchPreview): void {
    present(activeKey.value, preview);
  }

  function setSplit(split: number): void {
    const next = clampWorkbenchSplit(split);
    if (next === activeLayout.value.split) return;
    update(activeKey.value, (layout) => ({ ...layout, split: next }), false);
  }

  function setWidth(next: number): void {
    width.value = clampWorkbenchWidth(next);
  }

  /** Stores the width once a drag ends rather than on every frame. */
  function setResizing(resizing: boolean): void {
    isResizing.value = resizing;
    if (resizing) return;
    try {
      window.localStorage.setItem(
        WORKBENCH_WIDTH_STORAGE_KEY,
        String(width.value),
      );
    } catch {
      // The width still applies until the window reloads.
    }
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
    arrangement,
    displayedOpen,
    isClosing,
    isResizing,
    width,
    apply,
    closeCard,
    isHighlighted,
    layoutFor,
    panelPosition: (panel: WorkbenchPanel) =>
      panelPosition(activeLayout.value, panel),
    present,
    preview,
    setClosing,
    setDisplayedOpen,
    setOpen,
    setResizing,
    setSplit,
    setWidth,
    showPanel,
    toggle,
  };
});
