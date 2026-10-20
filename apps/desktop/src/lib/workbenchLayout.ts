import {
  parseFileReveal,
  type FilePreviewTarget,
  type FileReveal,
} from "@/shared/projectFiles";
import {
  clampWorkbenchSplit,
  isWorkbenchPanel,
  type WorkbenchCommand,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";

/**
 * The file in the preview card, the tool call that presented it, and where
 * the agent asked the preview to open.
 */
export interface WorkbenchPreview {
  target: FilePreviewTarget;
  toolCallId?: string;
  reveal?: FileReveal;
}

/**
 * One session's workbench. A single card always sits on top; `split` is the
 * top card's share of the column when both cards show.
 */
export interface WorkbenchLayout {
  open: boolean;
  top: WorkbenchPanel | null;
  bottom: WorkbenchPanel | null;
  split: number;
  preview: WorkbenchPreview | null;
}

export const DEFAULT_WORKBENCH_LAYOUT: Readonly<WorkbenchLayout> = {
  open: false,
  top: "artifacts",
  bottom: "preview",
  split: 40,
  preview: null,
};

/** A single card moves up, duplicates collapse, and no cards means closed. */
function normalize(layout: WorkbenchLayout): WorkbenchLayout {
  let { top, bottom } = layout;
  if (bottom === top) bottom = null;
  if (!top) [top, bottom] = [bottom, null];
  return {
    ...layout,
    top,
    bottom,
    open: layout.open && top !== null,
    split: clampWorkbenchSplit(layout.split),
  };
}

export function panelPosition(
  layout: WorkbenchLayout,
  panel: WorkbenchPanel,
): WorkbenchPosition | null {
  if (layout.top === panel) return "top";
  if (layout.bottom === panel) return "bottom";
  return null;
}

/** Shows a panel; see `ui_workbench_open` for the placement rules. */
export function openPanel(
  layout: WorkbenchLayout,
  panel: WorkbenchPanel,
  position?: WorkbenchPosition,
): WorkbenchLayout {
  const current = panelPosition(layout, panel);
  const next = { ...layout, open: true };
  if (current && (!position || position === current)) return normalize(next);
  if (current && position) {
    // Swap with whatever shows at the requested position.
    const other = layout[position];
    next[position] = panel;
    next[current] = other;
    return normalize(next);
  }
  const target: WorkbenchPosition =
    position ?? (!layout.top ? "top" : !layout.bottom ? "bottom" : "bottom");
  next[target] = panel;
  return normalize(next);
}

export function closePanel(
  layout: WorkbenchLayout,
  panel?: WorkbenchPanel,
): WorkbenchLayout {
  if (!panel) return { ...layout, open: false };
  const position = panelPosition(layout, panel);
  if (!position) return layout;
  const next = normalize({ ...layout, [position]: null });
  // The workbench keeps its last card for the next time it opens.
  return next.top ? next : { ...next, top: panel, open: false };
}

export function setWorkbenchOpen(
  layout: WorkbenchLayout,
  open: boolean,
): WorkbenchLayout {
  return normalize({
    ...layout,
    top: layout.top ?? DEFAULT_WORKBENCH_LAYOUT.top,
    open,
  });
}

export function applyWorkbenchCommand(
  layout: WorkbenchLayout,
  command: WorkbenchCommand,
): WorkbenchLayout {
  switch (command.kind) {
    case "open":
      return openPanel(layout, command.panel, command.position);
    case "close":
      return closePanel(layout, command.panel);
    case "arrange": {
      if (!command.top && !command.bottom) return { ...layout, open: false };
      return normalize({
        ...layout,
        open: true,
        top: command.top,
        bottom: command.bottom,
        split: command.split ?? layout.split,
      });
    }
  }
}

/** Shows a presented file in the preview card. */
export function presentInWorkbench(
  layout: WorkbenchLayout,
  preview: WorkbenchPreview,
): WorkbenchLayout {
  return openPanel({ ...layout, preview }, "preview");
}

function isPreviewTarget(value: unknown): value is FilePreviewTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  if (target.source === "presented") return typeof target.path === "string";
  return (
    target.source === "project" &&
    typeof target.projectId === "string" &&
    typeof target.folderId === "string" &&
    typeof target.relativePath === "string"
  );
}

/** Reads a stored layout, dropping anything malformed. */
export function parseWorkbenchLayout(value: unknown): WorkbenchLayout | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;
  const slot = (key: "top" | "bottom") =>
    isWorkbenchPanel(stored[key]) ? stored[key] : null;
  const preview = stored.preview as Record<string, unknown> | null | undefined;
  const reveal = parseFileReveal(preview?.reveal);
  return normalize({
    open: stored.open === true,
    top: slot("top"),
    bottom: slot("bottom"),
    split:
      typeof stored.split === "number" && Number.isFinite(stored.split)
        ? stored.split
        : DEFAULT_WORKBENCH_LAYOUT.split,
    preview:
      preview && isPreviewTarget(preview.target)
        ? {
            target: preview.target,
            ...(typeof preview.toolCallId === "string"
              ? { toolCallId: preview.toolCallId }
              : {}),
            ...(reveal ? { reveal } : {}),
          }
        : null,
  });
}
