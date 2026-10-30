import type { BrowserWindow } from "electron";
import { loadNativeAddon } from "./nativeAddon";

/** native/sidebar-glass/sidebar_glass.m */
interface SidebarGlassAddon {
  /** 2: AppKit's sidebar (macOS 27); 1: glass (macOS 26); 0: none. */
  support(): number;
  show(
    handle: Buffer,
    width: number,
    backing: number,
    appKitSidebar: boolean,
  ): boolean;
  hide(handle: Buffer): void;
  setGlassCornerRadius(handle: Buffer, radius: number): boolean;
  windowCornerRadius(handle: Buffer): number;
  setWindowAnimates(handle: Buffer, animates: boolean): boolean;
}

/** Loads the addon on first use. It is built only on macOS. */
function loadAddon(): SidebarGlassAddon | null {
  return loadNativeAddon<SidebarGlassAddon>("sidebar-glass", "sidebar_glass");
}

/**
 * The addon where it can show glass; before macOS 26 callers keep Electron's
 * vibrancy.
 */
function sidebarGlass(): SidebarGlassAddon | null {
  const loaded = loadAddon();
  return loaded && loaded.support() > 0 ? loaded : null;
}

export function isSidebarGlassSupported(): boolean {
  return sidebarGlass() !== null;
}

/**
 * Shows glass under the left `width` CSS pixels of the window, over the
 * solid `backing` colour (#rrggbb), or updates it. The page must leave that
 * strip transparent. Returns false when unsupported.
 */
export function showSidebarGlass(
  window: BrowserWindow,
  width: number,
  backing: string,
): boolean {
  const glass = sidebarGlass();
  const rgb = /^#([0-9a-f]{6})/i.exec(backing)?.[1];
  if (!glass || !rgb || window.isDestroyed()) return false;
  const points = width * window.webContents.getZoomFactor();
  return glass.show(
    window.getNativeWindowHandle(),
    points,
    Number.parseInt(rgb, 16),
    glass.support() >= 2,
  );
}

export function hideSidebarGlass(window: BrowserWindow): void {
  if (!window.isDestroyed())
    sidebarGlass()?.hide(window.getNativeWindowHandle());
}

/** Rounds the window's Liquid Glass view; false where it has none. */
export function setGlassCornerRadius(
  window: BrowserWindow,
  radius: number,
): boolean {
  const loaded = loadAddon();
  if (!loaded || window.isDestroyed()) return false;
  return loaded.setGlassCornerRadius(window.getNativeWindowHandle(), radius);
}

/** How round the system draws a window's corners, if it says. */
export function windowCornerRadius(window: BrowserWindow): number | undefined {
  const loaded = loadAddon();
  if (!loaded || window.isDestroyed()) return undefined;
  const radius = loaded.windowCornerRadius(window.getNativeWindowHandle());
  return radius >= 0 ? radius : undefined;
}

/** Whether the system animates the window as it opens and closes. */
export function setWindowAnimates(
  window: BrowserWindow,
  animates: boolean,
): void {
  if (!window.isDestroyed())
    loadAddon()?.setWindowAnimates(window.getNativeWindowHandle(), animates);
}
