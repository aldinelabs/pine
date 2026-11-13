import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const dock = { show: vi.fn(), hide: vi.fn() };
  const destroyedTrays: unknown[] = [];
  const trays: Tray[] = [];
  class Tray {
    listeners = new Map<string, () => void>();
    setToolTip = vi.fn();
    on = vi.fn((event: string, listener: () => void) => {
      this.listeners.set(event, listener);
    });
    popUpContextMenu = vi.fn();
    destroy = vi.fn(() => destroyedTrays.push(this));
    constructor() {
      trays.push(this);
    }
  }
  const buildFromTemplate = vi.fn((template: unknown) => template);
  return { dock, destroyedTrays, trays, Tray, buildFromTemplate };
});

vi.mock("electron", () => ({
  app: { dock: electron.dock, getLocale: () => "en-US" },
  Menu: { buildFromTemplate: electron.buildFromTemplate },
  nativeImage: { createFromPath: vi.fn() },
  nativeTheme: { on: vi.fn() },
  Tray: electron.Tray,
}));

import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import type { TrayState } from "../../background";
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

const idle: TrayState = {
  quickComposerEnabled: false,
  webAccess: false,
  relayRemote: false,
  remoteControl: false,
  runningSessions: 0,
  wechat: false,
  wechatBound: false,
  wechatNeedsScan: false,
  keepAwake: false,
};

function setup(platform = "darwin", state: TrayState = idle) {
  Object.defineProperty(process, "platform", { value: platform });
  const windows: FakeWindow[] = [];
  const toggleWeChat = vi.fn();
  const toggleKeepAwake = vi.fn();
  const background = new DesktopBackground({
    iconDirectory: "/icons",
    appWindows: () => windows as unknown as BrowserWindow[],
    open: vi.fn(),
    quit: vi.fn(),
    toggleQuickComposer: vi.fn(),
    toggleWebAccess: vi.fn(),
    toggleRelayRemote: vi.fn(),
    toggleWeChat,
    toggleKeepAwake,
    manageRemote: vi.fn(),
    state: () => state,
  });
  const add = (auxiliary = false) => {
    const window = new FakeWindow();
    if (!auxiliary) windows.push(window);
    background.watch(window as unknown as BrowserWindow, () => auxiliary);
    return window;
  };
  return { background, add, toggleWeChat, toggleKeepAwake };
}

/** Opens the tray menu as a right click does and returns its items. */
function openMenu(): MenuItemConstructorOptions[] {
  const tray = electron.trays.at(-1);
  tray?.listeners.get("right-click")?.();
  return electron.buildFromTemplate.mock
    .lastCall?.[0] as MenuItemConstructorOptions[];
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

describe("the tray's WeChat switch", () => {
  beforeEach(() => {
    electron.trays.length = 0;
    electron.buildFromTemplate.mockClear();
  });

  it("is greyed out until a WeChat account is bound", () => {
    const { background } = setup("darwin");
    background.start(true);

    const item = openMenu().find((entry) => entry.label === "WeChat remote");
    expect(item).toMatchObject({
      type: "checkbox",
      checked: false,
      enabled: false,
    });
    background.dispose();
  });

  it("pauses or resumes WeChat remote when clicked", () => {
    const { background, toggleWeChat } = setup("darwin", {
      ...idle,
      wechat: true,
      wechatBound: true,
    });
    background.start(true);

    const item = openMenu().find((entry) => entry.label === "WeChat remote");
    expect(item).toMatchObject({ checked: true, enabled: true });
    (item?.click as () => void)();
    expect(toggleWeChat).toHaveBeenCalledOnce();
    background.dispose();
  });

  it("shows a disabled line when WeChat needs a new scan", () => {
    const { background } = setup("darwin", {
      ...idle,
      wechat: true,
      wechatBound: true,
      wechatNeedsScan: true,
    });
    background.start(true);

    expect(
      openMenu().find((entry) => entry.label === "WeChat: scan again needed"),
    ).toEqual({ label: "WeChat: scan again needed", enabled: false });
    background.dispose();
  });

  it("flips keep-awake for remote control when clicked", () => {
    const { background, toggleKeepAwake } = setup("darwin", {
      ...idle,
      keepAwake: true,
    });
    background.start(true);

    const item = openMenu().find(
      (entry) => entry.label === "Keep computer awake for remote control",
    );
    expect(item).toMatchObject({
      type: "checkbox",
      checked: true,
      enabled: true,
    });
    (item?.click as () => void)();
    expect(toggleKeepAwake).toHaveBeenCalledOnce();
    background.dispose();
  });
});
