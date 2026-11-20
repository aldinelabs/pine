import { describe, expect, it } from "vitest";
import {
  hasQuitBlockers,
  quitConfirmationText,
  switchUserConfirmationText,
  type QuitBlockers,
} from "../quitGuard";

const none: QuitBlockers = {
  remoteControl: false,
  runningSessions: 0,
  wechat: false,
  wechatNeedsScan: false,
};

describe("quit guard", () => {
  it("quits without asking when nothing would be cut off", () => {
    expect(hasQuitBlockers(none)).toBe(false);
  });

  it("asks while Remote Control or a session is running", () => {
    expect(hasQuitBlockers({ ...none, remoteControl: true })).toBe(true);
    expect(hasQuitBlockers({ ...none, runningSessions: 2 })).toBe(true);
  });

  it("names every reason in the dialog", () => {
    const text = quitConfirmationText(
      { ...none, remoteControl: true, runningSessions: 2 },
      false,
    );
    expect(text.buttons).toEqual(["Quit", "Cancel"]);
    expect(text.detail).toContain("2 sessions are still running");
    expect(text.detail).toContain("Remote Control is on");
  });

  it("words a switch of user as switching, not quitting", () => {
    const english = switchUserConfirmationText(
      { ...none, runningSessions: 1, wechat: true },
      false,
      "Mom",
    );
    expect(english.message).toBe("Restart Pine as Mom?");
    expect(english.buttons).toEqual(["Switch", "Cancel"]);
    expect(english.detail).toContain("Switching stops it");
    expect(english.detail).toContain("after you switch");
    expect(english.detail).not.toMatch(/quit/i);
    const chinese = switchUserConfirmationText(
      { ...none, runningSessions: 1 },
      true,
      "妈妈",
    );
    expect(chinese.detail).toContain("切换会中止");
    expect(chinese.buttons).toEqual(["切换", "取消"]);
  });

  it("mentions only what applies", () => {
    const text = quitConfirmationText({ ...none, runningSessions: 1 }, true);
    expect(text.buttons).toEqual(["退出", "取消"]);
    expect(text.detail).toContain("有 1 个会话仍在运行");
    expect(text.detail).not.toContain("远程控制");
    expect(text.detail).not.toContain("微信");
  });

  it("asks while WeChat remote is listening", () => {
    const listening = { ...none, wechat: true };
    expect(hasQuitBlockers(listening)).toBe(true);
    expect(quitConfirmationText(listening, false).detail).toBe(
      "WeChat remote is on. Tasks sent from WeChat will not arrive after you quit.",
    );
    expect(quitConfirmationText(listening, true).detail).toBe(
      "微信远程已开启，退出后将收不到从微信发来的任务。",
    );
  });

  it("does not ask for WeChat remote while paused, unbound or needing a scan", () => {
    // Paused and unbound both mean nothing is listening.
    expect(hasQuitBlockers({ ...none, wechat: false })).toBe(false);
    const lostLogin = { ...none, wechat: true, wechatNeedsScan: true };
    expect(hasQuitBlockers(lostLogin)).toBe(false);
    expect(
      quitConfirmationText({ ...lostLogin, runningSessions: 1 }, false).detail,
    ).not.toContain("WeChat");
  });
});
