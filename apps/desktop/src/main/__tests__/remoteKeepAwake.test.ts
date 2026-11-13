import { describe, expect, it, vi } from "vitest";
import {
  isRemoteAccessOn,
  migrateRemoteKeepAwake,
  RemoteKeepAwake,
} from "../remoteKeepAwake";

describe("isRemoteAccessOn", () => {
  const none = {
    browserAccess: false,
    wechatListening: false,
    wechatNeedsScan: false,
  };

  it("counts browser access and a listening WeChat, not a WeChat waiting for a scan", () => {
    expect(isRemoteAccessOn({ ...none, browserAccess: true })).toBe(true);
    expect(isRemoteAccessOn({ ...none, wechatListening: true })).toBe(true);
    expect(
      isRemoteAccessOn({
        ...none,
        wechatListening: true,
        wechatNeedsScan: true,
      }),
    ).toBe(false);
    expect(isRemoteAccessOn({ ...none, wechatNeedsScan: true })).toBe(false);
    expect(isRemoteAccessOn(none)).toBe(false);
  });
});

function setup() {
  const remote = { on: false };
  const block = vi.fn();
  const changed = vi.fn();
  const controller = new RemoteKeepAwake({
    remoteOn: () => remote.on,
    block,
    changed,
  });
  return { remote, block, changed, controller };
}

describe("RemoteKeepAwake", () => {
  it("blocks sleep only while enabled and some remote is on", () => {
    const { remote, block, controller } = setup();
    remote.on = true;
    controller.refresh();
    expect(block).toHaveBeenLastCalledWith(false);

    remote.on = false;
    expect(controller.setEnabled(true)).toEqual({
      enabled: true,
      remoteOn: false,
    });
    expect(controller.enabled).toBe(true);
    expect(block).toHaveBeenLastCalledWith(false);

    remote.on = true;
    controller.refresh();
    expect(block).toHaveBeenLastCalledWith(true);

    remote.on = false;
    controller.refresh();
    expect(block).toHaveBeenLastCalledWith(false);

    remote.on = true;
    controller.refresh();
    expect(block).toHaveBeenLastCalledWith(true);
    controller.setEnabled(false);
    expect(block).toHaveBeenLastCalledWith(false);
  });

  it("releases on dispose and ignores later refreshes", () => {
    const { remote, block, controller } = setup();
    remote.on = true;
    controller.setEnabled(true);
    expect(block).toHaveBeenLastCalledWith(true);
    controller.dispose();
    expect(block).toHaveBeenLastCalledWith(false);
    block.mockClear();
    controller.refresh();
    controller.setEnabled(true);
    expect(block).not.toHaveBeenCalled();
  });

  it("reports a change only when the status differs", () => {
    const { remote, changed, controller } = setup();
    controller.refresh();
    controller.refresh();
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenLastCalledWith({
      enabled: false,
      remoteOn: false,
    });
    remote.on = true;
    controller.refresh();
    controller.refresh();
    expect(changed).toHaveBeenCalledTimes(2);
    controller.setEnabled(true);
    controller.setEnabled(true);
    expect(changed).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenLastCalledWith({ enabled: true, remoteOn: true });
  });
});

describe("migrateRemoteKeepAwake", () => {
  it("takes the old WeChat switch once and writes it", async () => {
    const write = vi.fn(() => Promise.resolve());
    await expect(
      migrateRemoteKeepAwake({
        stored: undefined,
        legacy: () => Promise.resolve(true),
        write,
      }),
    ).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith(true);

    write.mockClear();
    await expect(
      migrateRemoteKeepAwake({
        stored: undefined,
        legacy: () => Promise.resolve(false),
        write,
      }),
    ).resolves.toBe(false);
    expect(write).toHaveBeenCalledWith(false);
  });

  it("keeps a stored value without reading the old switch", async () => {
    const legacy = vi.fn(() => Promise.resolve(true));
    const write = vi.fn(() => Promise.resolve());
    await expect(
      migrateRemoteKeepAwake({ stored: false, legacy, write }),
    ).resolves.toBe(false);
    await expect(
      migrateRemoteKeepAwake({ stored: true, legacy, write }),
    ).resolves.toBe(true);
    expect(legacy).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
