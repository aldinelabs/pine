import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const started = new Set<number>();
  let nextBlocker = 1;
  return {
    handlers,
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        },
      ),
    },
    powerSaveBlocker: {
      start: vi.fn(() => {
        const id = nextBlocker++;
        started.add(id);
        return id;
      }),
      stop: vi.fn((id: number) => started.delete(id)),
      isStarted: vi.fn((id: number) => started.has(id)),
    },
    windows: [] as { isDestroyed(): boolean; webContents: { send: unknown } }[],
  };
});

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => electron.windows },
  ipcMain: electron.ipcMain,
  powerSaveBlocker: electron.powerSaveBlocker,
}));

import {
  GET_REMOTE_KEEP_AWAKE_CHANNEL,
  REMOTE_KEEP_AWAKE_CHANGED_CHANNEL,
  SET_REMOTE_KEEP_AWAKE_CHANNEL,
  type RemoteKeepAwakeStatus,
} from "../../../shared/remoteKeepAwake";
import {
  broadcastRemoteKeepAwake,
  createPowerBlocker,
  registerRemoteKeepAwakeIpc,
} from "../remoteKeepAwake";

describe("the power blocker", () => {
  beforeEach(() => {
    electron.powerSaveBlocker.start.mockClear();
    electron.powerSaveBlocker.stop.mockClear();
  });

  it("starts and stops one blocker however often it is asked", () => {
    const block = createPowerBlocker();
    block(false);
    expect(electron.powerSaveBlocker.stop).not.toHaveBeenCalled();

    block(true);
    block(true);
    expect(electron.powerSaveBlocker.start).toHaveBeenCalledOnce();
    expect(electron.powerSaveBlocker.start).toHaveBeenCalledWith(
      "prevent-app-suspension",
    );

    block(false);
    block(false);
    expect(electron.powerSaveBlocker.stop).toHaveBeenCalledOnce();

    block(true);
    expect(electron.powerSaveBlocker.start).toHaveBeenCalledTimes(2);
  });
});

describe("keep-awake requests", () => {
  beforeEach(() => electron.handlers.clear());

  function setup() {
    const status: RemoteKeepAwakeStatus = { enabled: true, remoteOn: false };
    const set = vi.fn((enabled: boolean) =>
      Promise.resolve({ enabled, remoteOn: false }),
    );
    registerRemoteKeepAwakeIpc({ controller: { status: () => status }, set });
    const invoke = (channel: string, request?: unknown) =>
      Promise.resolve().then(() =>
        electron.handlers.get(channel)?.({}, request),
      );
    return { set, invoke };
  }

  it("returns the status and applies a boolean", async () => {
    const { set, invoke } = setup();
    await expect(invoke(GET_REMOTE_KEEP_AWAKE_CHANNEL)).resolves.toEqual({
      enabled: true,
      remoteOn: false,
    });
    await expect(invoke(SET_REMOTE_KEEP_AWAKE_CHANNEL, false)).resolves.toEqual(
      { enabled: false, remoteOn: false },
    );
    expect(set).toHaveBeenCalledWith(false);
  });

  it("rejects anything but a boolean", async () => {
    const { set, invoke } = setup();
    await expect(invoke(SET_REMOTE_KEEP_AWAKE_CHANNEL, "on")).rejects.toThrow();
    await expect(invoke(SET_REMOTE_KEEP_AWAKE_CHANNEL)).rejects.toThrow();
    expect(set).not.toHaveBeenCalled();
  });

  it("sends a change to every open window", () => {
    const send = vi.fn();
    const closed = vi.fn();
    electron.windows.push(
      { isDestroyed: () => false, webContents: { send } },
      { isDestroyed: () => true, webContents: { send: closed } },
    );
    broadcastRemoteKeepAwake({ enabled: true, remoteOn: true });
    expect(send).toHaveBeenCalledWith(REMOTE_KEEP_AWAKE_CHANGED_CHANNEL, {
      enabled: true,
      remoteOn: true,
    });
    expect(closed).not.toHaveBeenCalled();
    electron.windows.length = 0;
  });
});
