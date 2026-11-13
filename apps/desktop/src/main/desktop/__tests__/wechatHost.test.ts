import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const notifications: FakeNotification[] = [];
  class FakeNotification {
    static isSupported = vi.fn(() => true);
    listeners = new Map<string, () => void>();
    show = vi.fn();
    constructor(readonly options: { title: string; body: string }) {
      notifications.push(this);
    }
    on(event: string, listener: () => void) {
      this.listeners.set(event, listener);
      return this;
    }
  }
  return {
    handlers,
    notifications,
    Notification: FakeNotification,
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        },
      ),
    },
    windows: [] as { isDestroyed(): boolean; webContents: { send: unknown } }[],
  };
});

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => electron.windows },
  ipcMain: electron.ipcMain,
  Notification: electron.Notification,
}));

import type { BrowserWindow } from "electron";
import {
  CANCEL_WECHAT_BINDING_CHANNEL,
  DEFAULT_WECHAT_STATUS,
  GET_WECHAT_REMOTE_CHANNEL,
  SET_WECHAT_PAUSED_CHANNEL,
  SET_WECHAT_SETTINGS_CHANNEL,
  START_WECHAT_BINDING_CHANNEL,
  SUBMIT_WECHAT_PAIRING_CODE_CHANNEL,
  SUBMIT_WECHAT_VERIFY_CODE_CHANNEL,
  UNBIND_WECHAT_CHANNEL,
  WECHAT_REMOTE_CHANGED_CHANNEL,
  WECHAT_REQUEST_CHANNELS,
  type WeChatStatus,
} from "../../../shared/wechatRemote";
import type { PineCore } from "../../core/pineCore";
import {
  broadcastWeChatStatus,
  registerWeChatIpc,
  showWeChatNotification,
} from "../wechatHost";

const PROJECT_ID = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";

const bound: WeChatStatus = {
  ...DEFAULT_WECHAT_STATUS,
  bound: true,
  connection: "online",
  owner: { userDigest: "A1B2-C3D4", boundAt: 1 },
};

function fakeBridge() {
  return {
    status: vi.fn(() => bound),
    setPaused: vi.fn((paused: boolean) =>
      Promise.resolve({ ...bound, paused }),
    ),
    startBinding: vi.fn(() => Promise.resolve(bound)),
    cancelBinding: vi.fn(() => bound),
    submitVerifyCode: vi.fn(() => bound),
    submitPairingCode: vi.fn(() => Promise.resolve(bound)),
    unbind: vi.fn(() => Promise.resolve(DEFAULT_WECHAT_STATUS)),
    setSettings: vi.fn(() => Promise.resolve(bound)),
  };
}

function setup(ready = true) {
  electron.handlers.clear();
  const bridge = fakeBridge();
  const core = { wechat: bridge } as unknown as PineCore;
  registerWeChatIpc(() => (ready ? core : null));
  const invoke = (channel: string, request?: unknown) =>
    Promise.resolve().then(() =>
      electron.handlers.get(channel)?.({ sender: { id: 1 } }, request),
    );
  return { bridge, invoke };
}

describe("WeChat remote IPC", () => {
  it("registers every request channel on ipcMain", () => {
    setup();
    expect([...electron.handlers.keys()].sort()).toEqual(
      [...WECHAT_REQUEST_CHANNELS].sort(),
    );
  });

  it("answers with the default status before Pine is ready", async () => {
    const { invoke } = setup(false);
    await expect(invoke(GET_WECHAT_REMOTE_CHANNEL)).resolves.toEqual(
      DEFAULT_WECHAT_STATUS,
    );
    await expect(invoke(START_WECHAT_BINDING_CHANNEL)).rejects.toThrow(
      "WeChat remote is not ready.",
    );
  });

  it("returns the bridge's status from every handler", async () => {
    const { bridge, invoke } = setup();
    await expect(invoke(GET_WECHAT_REMOTE_CHANNEL)).resolves.toEqual(bound);
    await expect(invoke(SET_WECHAT_PAUSED_CHANNEL, true)).resolves.toEqual({
      ...bound,
      paused: true,
    });
    expect(bridge.setPaused).toHaveBeenCalledWith(true);
    await expect(invoke(START_WECHAT_BINDING_CHANNEL)).resolves.toEqual(bound);
    await expect(invoke(CANCEL_WECHAT_BINDING_CHANNEL)).resolves.toEqual(bound);
    await expect(
      invoke(SUBMIT_WECHAT_VERIFY_CODE_CHANNEL, "  ab12 "),
    ).resolves.toEqual(bound);
    expect(bridge.submitVerifyCode).toHaveBeenCalledWith("ab12");
    await expect(
      invoke(SUBMIT_WECHAT_PAIRING_CODE_CHANNEL, " 123456 "),
    ).resolves.toEqual(bound);
    expect(bridge.submitPairingCode).toHaveBeenCalledWith("123456");
    await expect(invoke(UNBIND_WECHAT_CHANNEL)).resolves.toEqual(
      DEFAULT_WECHAT_STATUS,
    );
    await expect(
      invoke(SET_WECHAT_SETTINGS_CHANNEL, { ceilingMode: "autonomous" }),
    ).resolves.toEqual(bound);
  });

  it("reads full-width digits of a pairing code as digits", async () => {
    const { bridge, invoke } = setup();
    await invoke(SUBMIT_WECHAT_PAIRING_CODE_CHANNEL, "１２３４５６");
    expect(bridge.submitPairingCode).toHaveBeenCalledWith("123456");
  });

  it("refuses malformed requests before they reach the bridge", async () => {
    const { bridge, invoke } = setup();
    await expect(invoke(SET_WECHAT_PAUSED_CHANNEL, "yes")).rejects.toThrow();
    await expect(
      invoke(SUBMIT_WECHAT_VERIFY_CODE_CHANNEL, "   "),
    ).rejects.toThrow();
    await expect(
      invoke(SUBMIT_WECHAT_VERIFY_CODE_CHANNEL, "x".repeat(33)),
    ).rejects.toThrow();
    for (const code of ["12345", "1234567", "12a456", 123456, ""])
      await expect(
        invoke(SUBMIT_WECHAT_PAIRING_CODE_CHANNEL, code),
      ).rejects.toThrow();
    await expect(
      invoke(SET_WECHAT_SETTINGS_CHANNEL, { defaultProjectId: "not-a-uuid" }),
    ).rejects.toThrow();
    await expect(
      invoke(SET_WECHAT_SETTINGS_CHANNEL, { ceilingMode: "full-access" }),
    ).rejects.toThrow();
    await expect(
      invoke(SET_WECHAT_SETTINGS_CHANNEL, { keepAwake: true }),
    ).rejects.toThrow();
    await expect(
      invoke(SET_WECHAT_SETTINGS_CHANNEL, { paused: false }),
    ).rejects.toThrow();
    expect(bridge.setPaused).not.toHaveBeenCalled();
    expect(bridge.submitVerifyCode).not.toHaveBeenCalled();
    expect(bridge.submitPairingCode).not.toHaveBeenCalled();
    expect(bridge.setSettings).not.toHaveBeenCalled();
  });

  it("accepts a project id, and null to go back to No Project", async () => {
    const { bridge, invoke } = setup();
    await invoke(SET_WECHAT_SETTINGS_CHANNEL, { defaultProjectId: PROJECT_ID });
    await invoke(SET_WECHAT_SETTINGS_CHANNEL, { defaultProjectId: null });
    await invoke(SET_WECHAT_SETTINGS_CHANNEL, {
      defaultMode: "let-me-review",
      allowHighRiskApprovals: true,
      allowFileSending: false,
    });
    expect(bridge.setSettings.mock.calls).toEqual([
      [{ defaultProjectId: PROJECT_ID }],
      [{ defaultProjectId: null }],
      [
        {
          defaultMode: "let-me-review",
          allowHighRiskApprovals: true,
          allowFileSending: false,
        },
      ],
    ]);
  });
});

describe("WeChat status broadcast", () => {
  it("sends the status to every open window", () => {
    const open = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const closed = { isDestroyed: () => true, webContents: { send: vi.fn() } };
    electron.windows.splice(0, electron.windows.length, open, closed);

    broadcastWeChatStatus(bound);

    expect(open.webContents.send).toHaveBeenCalledWith(
      WECHAT_REMOTE_CHANGED_CHANNEL,
      bound,
    );
    expect(closed.webContents.send).not.toHaveBeenCalled();
  });
});

describe("WeChat notifications", () => {
  beforeEach(() => {
    electron.notifications.length = 0;
  });

  it("shows the notification and focuses the session's window on click", () => {
    const window = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };
    const pick = vi.fn(() => window as unknown as BrowserWindow);

    showWeChatNotification(
      {
        kind: "session-started",
        title: "Session started from WeChat",
        body: "Fix the build",
        projectId: PROJECT_ID,
        sessionId: "s1",
      },
      pick,
    );

    const [native] = electron.notifications;
    expect(native?.options).toEqual({
      title: "Session started from WeChat",
      body: "Fix the build",
    });
    expect(native?.show).toHaveBeenCalled();
    native?.listeners.get("click")?.();
    expect(pick).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sessionId: "s1",
    });
    expect(window.restore).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
  });

  it("shows nothing where notifications are unsupported", () => {
    electron.Notification.isSupported.mockReturnValueOnce(false);
    showWeChatNotification(
      { kind: "paused", title: "WeChat remote paused", body: "" },
      () => undefined,
    );
    expect(electron.notifications).toHaveLength(0);
  });
});
