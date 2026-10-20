/**
 * The workbench is the column beside the conversation. It stacks at most two
 * cards; each card shows one panel. The agent arranges it with the `ui_`
 * workbench tools, and the user with the card headers.
 */
export const WORKBENCH_PANELS = ["artifacts", "tasks", "preview"] as const;
export type WorkbenchPanel = (typeof WORKBENCH_PANELS)[number];

export const WORKBENCH_POSITIONS = ["top", "bottom"] as const;
export type WorkbenchPosition = (typeof WORKBENCH_POSITIONS)[number];

/** The top card's share of the column, in percent. */
export const WORKBENCH_MIN_SPLIT = 20;
export const WORKBENCH_MAX_SPLIT = 80;

export const UI_WORKBENCH_OPEN_TOOL_NAME = "ui_workbench_open" as const;
export const UI_WORKBENCH_CLOSE_TOOL_NAME = "ui_workbench_close" as const;
export const UI_WORKBENCH_ARRANGE_TOOL_NAME = "ui_workbench_arrange" as const;
export const UI_WORKBENCH_TOOL_NAMES = [
  UI_WORKBENCH_OPEN_TOOL_NAME,
  UI_WORKBENCH_CLOSE_TOOL_NAME,
  UI_WORKBENCH_ARRANGE_TOOL_NAME,
] as const;

export type WorkbenchCommand =
  /** Shows a panel, at the given position or in the first free card. */
  | { kind: "open"; panel: WorkbenchPanel; position?: WorkbenchPosition }
  /** Closes the card showing a panel, or the whole workbench without one. */
  | { kind: "close"; panel?: WorkbenchPanel }
  /** Replaces both cards at once; no cards closes the workbench. */
  | {
      kind: "arrange";
      top: WorkbenchPanel | null;
      bottom: WorkbenchPanel | null;
      split?: number;
    };

export function isWorkbenchPanel(value: unknown): value is WorkbenchPanel {
  return (WORKBENCH_PANELS as readonly unknown[]).includes(value);
}

export function isWorkbenchPosition(
  value: unknown,
): value is WorkbenchPosition {
  return (WORKBENCH_POSITIONS as readonly unknown[]).includes(value);
}

export function clampWorkbenchSplit(split: number): number {
  return Math.round(
    Math.min(Math.max(split, WORKBENCH_MIN_SPLIT), WORKBENCH_MAX_SPLIT),
  );
}

/** The column's width in CSS pixels; the user drags its leading edge. */
export const WORKBENCH_DEFAULT_WIDTH = 400;
export const WORKBENCH_MIN_WIDTH = 320;
export const WORKBENCH_MAX_WIDTH = 720;

export function clampWorkbenchWidth(width: number): number {
  if (!Number.isFinite(width)) return WORKBENCH_DEFAULT_WIDTH;
  return Math.round(
    Math.min(Math.max(width, WORKBENCH_MIN_WIDTH), WORKBENCH_MAX_WIDTH),
  );
}
