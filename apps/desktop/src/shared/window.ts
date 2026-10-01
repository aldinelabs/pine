export const SET_SIDEBAR_VIBRANCY_CHANNEL =
  "window:set-sidebar-vibrancy" as const;
export const CLOSE_TAB_REQUESTED_CHANNEL =
  "window:close-tab-requested" as const;
export const NEW_TAB_REQUESTED_CHANNEL = "window:new-tab-requested" as const;
export const CLOSE_WINDOW_CHANNEL = "window:close" as const;
export const SET_WINDOW_LAYOUT_CHANNEL = "window:set-layout" as const;
export const PLAN_WINDOW_RESIZE_CHANNEL = "window:plan-resize" as const;
export const COMMIT_WINDOW_RESIZE_CHANNEL = "window:commit-resize" as const;
export const GET_APP_VERSION_CHANNEL = "app:get-version" as const;
export const OPEN_EXTERNAL_URL_CHANNEL = "shell:open-external" as const;

export const PINE_REPOSITORY_URL =
  "https://github.com/phosphoros-works/pine" as const;
export const PINE_RELEASES_URL =
  "https://github.com/phosphoros-works/pine/releases" as const;

export const TRANSPARENT_WINDOW_BACKGROUND = "#00000000" as const;
export const OPAQUE_WINDOW_BACKGROUND = "#FFFFFFFF" as const;

export type PinePlatform = NodeJS.Platform;

/** `projects` locks the window to the list size; `project` unlocks it. */
export type PineWindowLayout = "projects" | "project";

export function isPineWindowLayout(value: unknown): value is PineWindowLayout {
  return value === "projects" || value === "project";
}

/**
 * Project window resizes driven by the right sidebar. The primary left
 * sidebar never changes the window width.
 */
export type PineWindowResizeRequest =
  | { kind: "fit-right-sidebar" }
  | { kind: "toggle-right-sidebar"; open: boolean };

export function isPineWindowResizeRequest(
  value: unknown,
): value is PineWindowResizeRequest {
  if (typeof value !== "object" || value === null || !("kind" in value))
    return false;
  if (value.kind === "fit-right-sidebar") return true;
  return (
    value.kind === "toggle-right-sidebar" &&
    "open" in value &&
    typeof value.open === "boolean"
  );
}

export interface SetSidebarVibrancyRequest {
  enabled: boolean;
}

export interface SetSidebarVibrancyResult {
  applied: boolean;
}

/**
 * Window-level capabilities exposed through the preload bridge. Vibrancy is a
 * macOS-only native effect, so consumers should gate on `platform` before
 * offering the toggle.
 */
export interface PineWindowApi {
  checkForUpdate?: () => Promise<import("./updates").UpdateCheckResult>;
  onCloseTabRequested: (listener: () => void) => () => void;
  onNewTabRequested: (listener: () => void) => () => void;
  onUpdateEvent?: (
    listener: import("./updates").UpdateEventListener,
  ) => () => void;
  closeWindow: () => Promise<void>;
  setWindowLayout: (layout: PineWindowLayout) => Promise<void>;
  /**
   * Plans a project window resize and returns the width change in CSS pixels
   * (0 when skipped). The renderer freezes its layout before committing.
   */
  planWindowResize: (request: PineWindowResizeRequest) => Promise<number>;
  /** Animates the planned resize; resolves when it settles. */
  commitWindowResize: () => Promise<void>;
  downloadUpdate?: () => Promise<import("./updates").DownloadUpdateResult>;
  getAppVersion: () => Promise<string>;
  installUpdate?: () => Promise<import("./updates").InstallUpdateResult>;
  openExternalUrl: (url: string) => Promise<void>;
  platform: PinePlatform;
  setSidebarVibrancy: (
    request: SetSidebarVibrancyRequest,
  ) => Promise<SetSidebarVibrancyResult>;
}
