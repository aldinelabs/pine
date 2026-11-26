import { describe, expect, it } from "vitest";
import { supportsBackgroundMode } from "../../shared/background";
import { trayGlyph, trayMenu } from "../background";

describe("tray glyph", () => {
  it("uses a template image in the macOS menu bar", () => {
    expect(trayGlyph("darwin", true)).toBe("trayTemplate");
    expect(trayGlyph("darwin", false)).toBe("trayTemplate");
  });

  it("follows the system theme on Windows, not Pine's", () => {
    expect(trayGlyph("win32", true)).toBe("trayDark");
    expect(trayGlyph("win32", false)).toBe("trayLight");
  });
});

describe("tray menu", () => {
  const idle = {
    quickComposerEnabled: true,
    webAccess: false,
    relayRemote: false,
    remoteControl: false,
    runningSessions: 0,
    wechat: false,
    wechatBound: false,
    wechatNeedsScan: false,
    keepAwake: false,
  };

  it("opens Pine first and quits last", () => {
    const entries = trayMenu(idle, false);
    expect(entries[0]).toEqual({
      type: "action",
      action: "open",
      label: "Open Pine",
    });
    expect(entries.at(-1)).toEqual({
      type: "action",
      action: "quit",
      label: "Quit Pine",
    });
  });

  it("lists users to switch to only when there are several", () => {
    const users = (list: { id: string; name: string; current: boolean }[]) =>
      trayMenu({ ...idle, users: list }, false).filter(
        (entry) => entry.type === "user",
      );
    expect(users([{ id: "primary", name: "Kai", current: true }])).toEqual([]);
    expect(
      users([
        { id: "primary", name: "", current: true },
        { id: "mom", name: "Mom", current: false },
      ]),
    ).toEqual([
      { type: "user", userId: "primary", label: "Me", current: true },
      { type: "user", userId: "mom", label: "Mom", current: false },
    ]);
  });

  it("offers the quick composer only while it is on", () => {
    const actions = (quickComposerEnabled: boolean) =>
      trayMenu({ ...idle, quickComposerEnabled }, false).flatMap((entry) =>
        entry.type === "action" ? [entry.action] : [],
      );
    expect(actions(true)).toEqual([
      "open",
      "quick-composer",
      "manage-remote",
      "quit",
    ]);
    expect(actions(false)).toEqual(["open", "manage-remote", "quit"]);
  });

  it("offers browser access, Aldine Remote Control, WeChat and keep-awake as switches", () => {
    const toggles = (state: typeof idle, chinese = false) =>
      trayMenu(state, chinese).flatMap((entry) =>
        entry.type === "toggle" ? [entry] : [],
      );
    expect(toggles(idle)).toEqual([
      {
        type: "toggle",
        action: "toggle-web-access",
        label: "Browser access",
        checked: false,
        enabled: true,
      },
      {
        type: "toggle",
        action: "toggle-relay-remote",
        label: "Remote Control via Aldine",
        checked: false,
        enabled: false,
      },
      {
        type: "toggle",
        action: "toggle-wechat",
        label: "WeChat remote",
        checked: false,
        enabled: false,
      },
      {
        type: "toggle",
        action: "toggle-keep-awake",
        label: "Keep computer awake for remote control",
        checked: false,
        enabled: true,
      },
    ]);
    const on = toggles(
      {
        ...idle,
        webAccess: true,
        relayRemote: true,
        wechat: true,
        wechatBound: true,
        keepAwake: true,
      },
      true,
    );
    expect(
      on.map((entry) => [entry.label, entry.checked, entry.enabled]),
    ).toEqual([
      ["浏览器访问", true, true],
      ["经 Aldine 远程控制", true, true],
      ["微信远程", true, true],
      ["远程控制时保持电脑唤醒", true, true],
    ]);
  });

  it("keeps Aldine switchable off even when browser access is off", () => {
    const relay = trayMenu({ ...idle, relayRemote: true }, false).find(
      (entry) =>
        entry.type === "toggle" && entry.action === "toggle-relay-remote",
    );
    expect(relay).toMatchObject({ checked: true, enabled: true });
  });

  it("places the WeChat switch after Aldine and before the settings", () => {
    const order = trayMenu({ ...idle, wechatBound: true }, false).flatMap(
      (entry) =>
        entry.type === "action" || entry.type === "toggle"
          ? [entry.action]
          : [],
    );
    expect(order.indexOf("toggle-wechat")).toBe(
      order.indexOf("toggle-relay-remote") + 1,
    );
    expect(order.indexOf("toggle-keep-awake")).toBe(
      order.indexOf("toggle-wechat") + 1,
    );
    expect(order.indexOf("manage-remote")).toBe(
      order.indexOf("toggle-keep-awake") + 1,
    );
  });

  it("offers keep-awake as an always enabled switch after WeChat and its scan line", () => {
    const find = (state: typeof idle, chinese = false) =>
      trayMenu(state, chinese).find(
        (entry) =>
          entry.type === "toggle" && entry.action === "toggle-keep-awake",
      );
    expect(find(idle)).toEqual({
      type: "toggle",
      action: "toggle-keep-awake",
      label: "Keep computer awake for remote control",
      checked: false,
      enabled: true,
    });
    expect(find({ ...idle, keepAwake: true })).toMatchObject({
      checked: true,
      enabled: true,
    });
    expect(find(idle, true)).toMatchObject({
      label: "远程控制时保持电脑唤醒",
    });

    const entries = trayMenu(
      { ...idle, wechat: true, wechatBound: true, wechatNeedsScan: true },
      false,
    );
    const scan = entries.findIndex(
      (entry) =>
        entry.type === "status" && entry.label === "WeChat: scan again needed",
    );
    const keepAwake = entries.findIndex(
      (entry) =>
        entry.type === "toggle" && entry.action === "toggle-keep-awake",
    );
    const manage = entries.findIndex(
      (entry) => entry.type === "action" && entry.action === "manage-remote",
    );
    expect(scan).toBeGreaterThan(0);
    expect(keepAwake).toBe(scan + 1);
    expect(manage).toBe(keepAwake + 1);
  });

  it("tells what the Assistant's dispatched sessions are doing", () => {
    const status = (
      state: typeof idle & {
        assistant?: { running: number; awaitingApproval: number };
      },
      chinese = false,
    ) =>
      trayMenu(state, chinese)
        .filter((entry) => entry.type === "status")
        .map((entry) => entry.label);

    expect(
      status({ ...idle, assistant: { running: 0, awaitingApproval: 0 } }),
    ).toEqual([]);
    expect(
      status({ ...idle, assistant: { running: 2, awaitingApproval: 1 } }),
    ).toEqual(["Orchestrator: 2 running, 1 awaiting approval"]);
    expect(
      status({ ...idle, assistant: { running: 1, awaitingApproval: 0 } }, true),
    ).toEqual(["指挥中心：1 个任务运行中，0 个待审批"]);
  });

  it("shows a paused WeChat account as switched off but switchable", () => {
    const wechat = trayMenu({ ...idle, wechatBound: true }, false).find(
      (entry) => entry.type === "toggle" && entry.action === "toggle-wechat",
    );
    expect(wechat).toMatchObject({ checked: false, enabled: true });
  });

  it("says when WeChat needs a new scan", () => {
    const labels = (state: typeof idle, chinese = false) =>
      trayMenu(state, chinese).flatMap((entry) =>
        entry.type === "status" ? [entry.label] : [],
      );
    const lostLogin = {
      ...idle,
      wechat: true,
      wechatBound: true,
      wechatNeedsScan: true,
    };
    expect(labels(lostLogin)).toEqual(["WeChat: scan again needed"]);
    expect(labels(lostLogin, true)).toEqual(["微信需要重新扫码"]);
    expect(labels({ ...lostLogin, wechatNeedsScan: false })).toEqual([]);
  });

  it("shows running sessions", () => {
    const labels = (state: typeof idle, chinese = false) =>
      trayMenu(state, chinese).flatMap((entry) =>
        entry.type === "status" ? [entry.label] : [],
      );
    expect(labels(idle)).toEqual([]);
    expect(labels({ ...idle, runningSessions: 1 })).toEqual([
      "1 session running",
    ]);
    expect(labels({ ...idle, runningSessions: 3 })).toEqual([
      "3 sessions running",
    ]);
    expect(labels({ ...idle, runningSessions: 2 }, true)).toEqual([
      "2 个会话正在运行",
    ]);
  });
});

describe("background mode support", () => {
  it("covers Windows and macOS only", () => {
    expect(supportsBackgroundMode("darwin")).toBe(true);
    expect(supportsBackgroundMode("win32")).toBe(true);
    expect(supportsBackgroundMode("linux")).toBe(false);
  });
});
