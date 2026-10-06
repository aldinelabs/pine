import { screen, type BrowserWindow, type Rectangle } from "electron";
import {
  PROJECT_LIST_WINDOW_SIZE,
  type PineWindowLayout,
  type PineWindowResizeRequest,
} from "../shared/window";

/** Projects need room for two sidebars. */
export const PROJECT_WINDOW_WIDTH = 1376;
/** Matches the renderer's 16rem right sidebar. */
export const RIGHT_SIDEBAR_WIDTH = 256;
export const WINDOW_RESIZE_DURATION_MS = 500;
const FRAME_INTERVAL_MS = 1000 / 60;

interface WindowSize {
  width: number;
  height: number;
}

/** Matches the renderer's `ease-out-expo` sidebar transition. */
export function easeOutExpo(progress: number): number {
  return progress >= 1 ? 1 : 1 - Math.pow(2, -10 * progress);
}

function clampAxis(
  start: number,
  size: number,
  areaStart: number,
  areaSize: number,
): number {
  return Math.min(Math.max(start, areaStart), areaStart + areaSize - size);
}

/**
 * Resizes around the window centre, clamped to the display work area.
 * Returns null when the bounds would not change.
 */
export function resizedBounds(
  current: Rectangle,
  workArea: Rectangle,
  target: WindowSize,
): Rectangle | null {
  const width = Math.min(target.width, workArea.width);
  const height = Math.min(target.height, workArea.height);
  if (width === current.width && height === current.height) return null;
  return {
    x: clampAxis(
      Math.round(current.x - (width - current.width) / 2),
      width,
      workArea.x,
      workArea.width,
    ),
    y: clampAxis(
      Math.round(current.y - (height - current.height) / 2),
      height,
      workArea.y,
      workArea.height,
    ),
    width,
    height,
  };
}

/** Opening a project with the right sidebar never shrinks a wider window. */
export function projectWithRightSidebarSize(current: Rectangle): WindowSize {
  return {
    width: Math.max(current.width, PROJECT_WINDOW_WIDTH),
    height: current.height,
  };
}

/**
 * Fits the project window to the remembered right sidebar. Windows open
 * sized for the sidebar, so a closed sidebar gives its width back only on
 * the window's first fit; later fits (reloads) keep the user's size.
 */
export function projectWindowSize(
  current: Rectangle,
  open: boolean,
  isFirstFit: boolean,
): WindowSize {
  if (open) return projectWithRightSidebarSize(current);
  return {
    width: isFirstFit
      ? Math.min(current.width, PROJECT_WINDOW_WIDTH - RIGHT_SIDEBAR_WIDTH)
      : current.width,
    height: current.height,
  };
}

export function rightSidebarWidthChange(open: boolean): number {
  return open ? RIGHT_SIDEBAR_WIDTH : -RIGHT_SIDEBAR_WIDTH;
}

/**
 * Accumulates sidebar toggles made while maximized or fullscreen. Opposite
 * toggles cancel out, so the debt never exceeds one sidebar width.
 */
export function deferWidthChange(pending: number, open: boolean): number {
  return Math.max(
    -RIGHT_SIDEBAR_WIDTH,
    Math.min(RIGHT_SIDEBAR_WIDTH, pending + rightSidebarWidthChange(open)),
  );
}

/**
 * Adds or removes the right sidebar's width so the content area keeps its
 * size. The left edge stays put unless the window would leave the work area.
 */
export function rightSidebarBounds(
  current: Rectangle,
  workArea: Rectangle,
  widthChange: number,
  minWidth: number,
): Rectangle | null {
  const requested = current.width + widthChange;
  const width = Math.min(Math.max(requested, minWidth), workArea.width);
  if (width === current.width) return null;
  return {
    ...current,
    x: clampAxis(current.x, width, workArea.x, workArea.width),
    width,
  };
}

export function interpolateBounds(
  from: Rectangle,
  to: Rectangle,
  progress: number,
): Rectangle {
  const eased = easeOutExpo(progress);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * eased);
  return {
    x: lerp(from.x, to.x),
    y: lerp(from.y, to.y),
    width: lerp(from.width, to.width),
    height: lerp(from.height, to.height),
  };
}

interface RunningAnimation {
  timer: NodeJS.Timeout;
  settle: () => void;
}

const runningAnimations = new WeakMap<BrowserWindow, RunningAnimation>();
const plannedResizes = new WeakMap<
  BrowserWindow,
  { from: Rectangle; to: Rectangle }
>();
/** Sidebar width owed by windows toggled while maximized or fullscreen. */
const deferredWidthChanges = new WeakMap<BrowserWindow, number>();
const windowsWatchingRestore = new WeakSet<BrowserWindow>();
const fittedWindows = new WeakSet<BrowserWindow>();

/** Interrupted animations still settle so waiting renderers can unfreeze. */
function stopAnimation(window: BrowserWindow): void {
  const running = runningAnimations.get(window);
  if (!running) return;
  clearInterval(running.timer);
  runningAnimations.delete(window);
  running.settle();
}

function animateBounds(
  window: BrowserWindow,
  from: Rectangle,
  to: Rectangle,
  onStart?: (startedAt: number) => void,
): Promise<void> {
  stopAnimation(window);
  return new Promise((resolve) => {
    // Frame-by-frame on every platform: the native macOS animation cannot use
    // the renderer's easing curve.
    const startedAt = Date.now();
    onStart?.(startedAt);
    const timer = setInterval(() => {
      if (window.isDestroyed()) return stopAnimation(window);
      const progress = Math.min(
        (Date.now() - startedAt) / WINDOW_RESIZE_DURATION_MS,
        1,
      );
      window.setBounds(interpolateBounds(from, to, progress));
      if (progress >= 1) stopAnimation(window);
    }, FRAME_INTERVAL_MS);
    runningAnimations.set(window, { timer, settle: resolve });
  });
}

/**
 * Applies the window constraints for a renderer page. The project list is
 * locked to a fixed size; projects unlock resizing and size themselves
 * through planned resizes.
 */
export function applyWindowLayout(
  window: BrowserWindow,
  layout: PineWindowLayout,
): void {
  if (window.isDestroyed()) return;
  const isProject = layout === "project";
  plannedResizes.delete(window);
  // Resizing must stay enabled while animating; setBounds respects it on
  // some platforms.
  window.setResizable(true);
  if (!isProject) deferredWidthChanges.delete(window);

  if (!isProject && window.isFullScreen()) {
    window.once("leave-full-screen", () => applyWindowLayout(window, layout));
    window.setFullScreen(false);
    return;
  }
  if (!isProject && window.isMaximized()) window.unmaximize();

  window.setMaximizable(isProject);
  window.setFullScreenable(isProject);
  if (isProject) return;

  const from = window.getBounds();
  const { workArea } = screen.getDisplayMatching(from);
  const to = resizedBounds(from, workArea, PROJECT_LIST_WINDOW_SIZE);
  const lock = () => {
    // A project opened during the animation unlocks resizing again.
    if (!window.isDestroyed() && !window.isMaximizable())
      window.setResizable(false);
  };
  if (!to) return lock();
  void animateBounds(window, from, to).then(lock);
}

/**
 * Computes a project window resize without starting it, so the renderer can
 * freeze its layout first. Returns the width change in DIPs (0 when skipped).
 */
export function planWindowResize(
  window: BrowserWindow,
  request: PineWindowResizeRequest,
): number {
  plannedResizes.delete(window);
  if (window.isDestroyed()) return 0;
  // Checked before isResizable(): macOS reports fullscreen windows as not
  // resizable. Only project windows can be maximized or fullscreen.
  const isFirstFit =
    request.kind === "fit-right-sidebar" && !fittedWindows.has(window);
  if (request.kind === "fit-right-sidebar") fittedWindows.add(window);
  if (window.isMaximized() || window.isFullScreen()) {
    // macOS ignores setBounds in fullscreen and leaves maximized on it, so
    // apply the sidebar's width once the window is restored instead.
    if (request.kind === "toggle-right-sidebar")
      deferRightSidebarWidth(window, request.open);
    return 0;
  }
  if (!window.isResizable()) return 0;
  stopAnimation(window);
  const from = window.getBounds();
  const { workArea } = screen.getDisplayMatching(from);
  const to =
    request.kind === "fit-right-sidebar"
      ? resizedBounds(
          from,
          workArea,
          projectWindowSize(from, request.open, isFirstFit),
        )
      : rightSidebarBounds(
          from,
          workArea,
          rightSidebarWidthChange(request.open),
          window.getMinimumSize()[0],
        );
  if (!to) return 0;
  plannedResizes.set(window, { from, to });
  return to.width - from.width;
}

/**
 * Runs the planned resize; resolves when it settles or is interrupted.
 * `onStart` receives the animation clock's start (epoch ms) so the renderer
 * can align matching CSS transitions with the window's own timeline.
 */
export function commitWindowResize(
  window: BrowserWindow,
  onStart?: (startedAt: number) => void,
): Promise<void> {
  const planned = plannedResizes.get(window);
  plannedResizes.delete(window);
  if (!planned || window.isDestroyed()) return Promise.resolve();
  return animateBounds(window, planned.from, planned.to, onStart);
}

function deferRightSidebarWidth(window: BrowserWindow, open: boolean): void {
  const pending = deferWidthChange(deferredWidthChanges.get(window) ?? 0, open);
  if (pending === 0) deferredWidthChanges.delete(window);
  else deferredWidthChanges.set(window, pending);
  if (windowsWatchingRestore.has(window)) return;
  windowsWatchingRestore.add(window);
  // Defer past the event so the restored frame is in place before measuring.
  const onRestore = () => setTimeout(() => applyDeferredWidth(window), 0);
  window.on("leave-full-screen", onRestore);
  window.on("unmaximize", onRestore);
}

/** Catches up on sidebar toggles made while maximized or fullscreen. */
function applyDeferredWidth(window: BrowserWindow): void {
  const pending = deferredWidthChanges.get(window);
  if (
    !pending ||
    window.isDestroyed() ||
    window.isMaximized() ||
    window.isFullScreen()
  )
    return;
  deferredWidthChanges.delete(window);
  const from = window.getBounds();
  const { workArea } = screen.getDisplayMatching(from);
  const to = rightSidebarBounds(
    from,
    workArea,
    pending,
    window.getMinimumSize()[0],
  );
  // The content legitimately changes width here, so this resize is not
  // frozen in the renderer.
  if (to) void animateBounds(window, from, to);
}
