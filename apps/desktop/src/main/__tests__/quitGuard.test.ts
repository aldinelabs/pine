import { describe, expect, it } from "vitest";
import { hasQuitBlockers, quitConfirmationText } from "../quitGuard";

describe("quit guard", () => {
  it("quits without asking when nothing would be cut off", () => {
    expect(hasQuitBlockers({ remoteControl: false, runningSessions: 0 })).toBe(
      false,
    );
  });

  it("asks while Remote Control or a session is running", () => {
    expect(hasQuitBlockers({ remoteControl: true, runningSessions: 0 })).toBe(
      true,
    );
    expect(hasQuitBlockers({ remoteControl: false, runningSessions: 2 })).toBe(
      true,
    );
  });

  it("names every reason in the dialog", () => {
    const text = quitConfirmationText(
      { remoteControl: true, runningSessions: 2 },
      false,
    );
    expect(text.buttons).toEqual(["Quit", "Cancel"]);
    expect(text.detail).toContain("2 sessions are still running");
    expect(text.detail).toContain("Remote Control is on");
  });

  it("mentions only what applies", () => {
    const text = quitConfirmationText(
      { remoteControl: false, runningSessions: 1 },
      true,
    );
    expect(text.buttons).toEqual(["退出", "取消"]);
    expect(text.detail).toContain("有 1 个会话仍在运行");
    expect(text.detail).not.toContain("远程控制");
  });
});
