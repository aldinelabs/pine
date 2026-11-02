import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const dock = { show: vi.fn(), hide: vi.fn() };
  const destroyedTrays: unknown[] = [];
  class Tray {
    setToolTip = vi.fn();
    on = vi.fn();
    destroy = vi.fn(() => destroyedTrays.push(this));
  }
  return { dock, destroyedTrays, Tray };
});

vi.mock("electron", () => ({
  app: { dock: electron.dock },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn() },
  nativeTheme: { on: vi.fn() },
  Tray: electron.Tray,
}));

import type { BrowserWindow } from "electron";
import { DesktopBackground } from "../background";

class FakeWindow extends EventEmitter {
  visible = true;
  hide = vi.fn(() => {
    this.visible = false;
  });
  isVisible = () => this.visible;
  isMinimized = () => false;
  isDestroyed = () => false;
  isFullScreen = () => false;

  /** Emits `close` the way Electron does; true when the close went ahead. */
  close(): boolean {
    let prevented = false;
    this.emit("close", { preventDefault: () => (prevented = true) });
    return !prevented;
  }
}

function setup(platform = "darwin") {
  Object.defineProperty(process, "platform", { value: platform });
  const windows: FakeWindow[] = [];
  const background = new DesktopBackground({
    iconDirectory: "/icons",
    appWindows: () => windows as unknown as BrowserWindow[],
    open: vi.fn(),
    quit: vi.fn(),
    toggleQuickComposer: vi.fn(),
    toggleWebAccess: vi.fn(),
    toggleRelayRemote: vi.fn(),
    manageRemote: vi.fn(),
    state: vi.fn(),
  });
  const add = (auxiliary = false) => {
    const window = new FakeWindow();
    if (!auxiliary) windows.push(window);
    background.watch(window as unknown as BrowserWindow, () => auxiliary);
    return window;
  };
  return { background, add };
}

describe("closing windows with Pine in the tray", () => {
  const platform = process.platform;

  beforeEach(() => {
    electron.destroyedTrays.length = 0;
    return () => {
      Object.defineProperty(process, "platform", { value: platform });
    };
  });

  it("hides the last visible window instead of closing it", () => {
    const { background, add } = setup();
    background.start(true);
    const window = add();

    expect(window.close()).toBe(false);
    expect(window.hide).toHaveBeenCalled();
  });

  it("closes a window while another stays open", () => {
    const { background, add } = setup();
    background.start(true);
    const window = add();
    add();

    expect(window.close()).toBe(true);
    expect(window.hide).not.toHaveBeenCalled();
  });

  it("lets every window close while quitting, so the quit goes through", () => {
    const { background, add } = setup();
    background.start(true);
    const windows = [add(), add(true)];
    background.markQuitting();

    expect(windows.map((window) => window.close())).toEqual([true, true]);
    background.dispose();
    expect(electron.destroyedTrays).toHaveLength(1);
  });

  it("never holds back the quick composer's own windows", () => {
    const { background, add } = setup();
    background.start(true);

    expect(add(true).close()).toBe(true);
  });

  it("closes normally without a tray", () => {
    const { background, add } = setup();
    background.start(false);

    expect(add().close()).toBe(true);
  });
});
