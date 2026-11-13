import path from "node:path";
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  Tray,
  type MenuItemConstructorOptions,
} from "electron";
import { supportsBackgroundMode } from "../../shared/background";
import {
  shouldHideOnClose,
  trayGlyph,
  trayMenu,
  type TrayAction,
  type TrayState,
} from "../background";
import { isChineseLocale } from "./attention";

interface DesktopBackgroundOptions {
  /** Where the tray glyphs live. */
  iconDirectory: string;
  /** Pine's own windows, without the quick composer's. */
  appWindows(): BrowserWindow[];
  /** Shows Pine's windows, opening one when there is none. */
  open(): void;
  quit(): void;
  toggleQuickComposer(): void;
  toggleWebAccess(): void;
  toggleRelayRemote(): void;
  /** Pauses or resumes WeChat remote. */
  toggleWeChat(): void;
  /** Flips "Keep the computer awake while remote control is on". */
  toggleKeepAwake(): void;
  /** Opens Pine's preferences at the Remote Control section. */
  manageRemote(): void;
  state(): TrayState;
}

/**
 * Pine living on after its window closes: a tray icon (menu bar on macOS,
 * notification area on Windows), closing the last window hiding it, and the
 * macOS Dock icon following the windows.
 */
export class DesktopBackground {
  private tray: Tray | null = null;
  private quitting = false;

  constructor(private readonly options: DesktopBackgroundOptions) {
    nativeTheme.on("updated", () => this.refreshIcon());
  }

  /** The preference as applied, for the settings page. */
  get enabled(): boolean {
    return this.tray !== null;
  }

  /** Whether closing the last window keeps Pine running. */
  get active(): boolean {
    return this.enabled;
  }

  /** Applies the saved preference once the app is ready. */
  start(enabled: boolean): void {
    this.apply(enabled);
  }

  apply(enabled: boolean): boolean {
    const wanted = enabled && supportsBackgroundMode(process.platform);
    if (wanted && !this.tray) this.createTray();
    if (!wanted && this.tray) this.destroyTray();
    // A hidden window has nobody to reopen it once the tray is gone.
    if (!this.active) this.showHiddenWindows();
    return this.active;
  }

  /** From `before-quit` once the quit is going ahead. */
  markQuitting(): void {
    this.quitting = true;
  }

  /** A cancelled quit leaves Pine running as it was. */
  cancelQuitting(): void {
    this.quitting = false;
  }

  /** Hides the last visible window instead of closing it. */
  watch(window: BrowserWindow, isAuxiliary: () => boolean): void {
    window.on("close", (event) => {
      // Any other close goes through: a window that refuses to close while
      // quitting cancels the quit, leaving Pine running in the tray.
      if (
        isAuxiliary() ||
        !shouldHideOnClose({
          active: this.active,
          quitting: this.quitting,
          visibleAppWindows: this.visibleWindows().length,
        })
      )
        return;
      event.preventDefault();
      this.hide(window);
    });
    window.on("show", () => {
      if (!isAuxiliary()) void app.dock?.show();
    });
    // Windows closes every window at logoff; hiding would hold it up.
    window.on("session-end", () => this.markQuitting());
  }

  /** Brings back what hiding put away, and the Dock icon with it. */
  showHiddenWindows(): boolean {
    const hidden = this.options
      .appWindows()
      .filter((window) => !window.isVisible() && !window.isMinimized());
    if (hidden.length > 0) void app.dock?.show();
    for (const window of hidden) window.show();
    if (hidden.length > 0) hidden[hidden.length - 1]?.focus();
    return hidden.length > 0;
  }

  /** The windows a person can see, not the ones hiding in the tray. */
  visibleWindows(): BrowserWindow[] {
    return this.options
      .appWindows()
      .filter((window) => window.isVisible() || window.isMinimized());
  }

  dispose(): void {
    this.destroyTray();
  }

  private hide(window: BrowserWindow): void {
    const conceal = () => {
      if (window.isDestroyed()) return;
      window.hide();
      // Without a window the app lives in the menu bar alone.
      if (this.visibleWindows().length === 0) app.dock?.hide();
    };
    // Hiding a native fullscreen window leaves its Space behind.
    if (window.isFullScreen()) {
      window.once("leave-full-screen", conceal);
      window.setFullScreen(false);
    } else conceal();
  }

  private createTray(): void {
    try {
      const tray = new Tray(this.icon());
      tray.setToolTip("Pine");
      // Windows opens Pine on a plain click and keeps the menu for the right
      // button; macOS has no such split, so both open the menu.
      tray.on("click", () => {
        if (process.platform === "win32") this.options.open();
        else this.popUpMenu();
      });
      tray.on("right-click", () => this.popUpMenu());
      this.tray = tray;
    } catch (error) {
      // No tray to return from means a hidden window would be lost.
      console.error("Failed to create the tray icon.", error);
      this.tray = null;
    }
  }

  private destroyTray(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private icon(): Electron.NativeImage {
    const glyph = trayGlyph(
      process.platform,
      nativeTheme.shouldUseDarkColorsForSystemIntegratedUI,
    );
    // The `@2x` file beside it serves high-density screens.
    return nativeImage.createFromPath(
      path.join(this.options.iconDirectory, `${glyph}.png`),
    );
  }

  private refreshIcon(): void {
    this.tray?.setImage(this.icon());
  }

  private popUpMenu(): void {
    if (!this.tray) return;
    const handlers: Record<TrayAction, () => void> = {
      open: () => this.options.open(),
      "quick-composer": () => this.options.toggleQuickComposer(),
      "toggle-web-access": () => this.options.toggleWebAccess(),
      "toggle-relay-remote": () => this.options.toggleRelayRemote(),
      "toggle-wechat": () => this.options.toggleWeChat(),
      "toggle-keep-awake": () => this.options.toggleKeepAwake(),
      "manage-remote": () => this.options.manageRemote(),
      quit: () => this.options.quit(),
    };
    const template = trayMenu(this.options.state(), isChineseLocale()).map(
      (entry): MenuItemConstructorOptions => {
        if (entry.type === "separator") return { type: "separator" };
        if (entry.type === "toggle")
          return {
            label: entry.label,
            type: "checkbox",
            checked: entry.checked,
            enabled: entry.enabled,
            click: handlers[entry.action],
          };
        if (entry.type === "status")
          return { label: entry.label, enabled: false };
        return { label: entry.label, click: handlers[entry.action] };
      },
    );
    this.tray.popUpContextMenu(Menu.buildFromTemplate(template));
  }
}
