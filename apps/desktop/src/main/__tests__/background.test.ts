import { describe, expect, it } from "vitest";
import { supportsBackgroundMode } from "../../shared/background";
import { shouldHideOnClose, trayGlyph, trayMenu } from "../background";

describe("hiding to the tray", () => {
  const base = { active: true, quitting: false, visibleAppWindows: 1 };

  it("hides the last visible window", () => {
    expect(shouldHideOnClose(base)).toBe(true);
  });

  it("closes normally while another window is open", () => {
    expect(shouldHideOnClose({ ...base, visibleAppWindows: 2 })).toBe(false);
  });

  it("closes for real while quitting, so a quit is never held up", () => {
    expect(shouldHideOnClose({ ...base, quitting: true })).toBe(false);
  });

  it("closes normally without a tray to return from", () => {
    expect(shouldHideOnClose({ ...base, active: false })).toBe(false);
  });
});

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
    remoteControl: false,
    runningSessions: 0,
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

  it("offers the quick composer only while it is on", () => {
    const actions = (quickComposerEnabled: boolean) =>
      trayMenu({ ...idle, quickComposerEnabled }, false).flatMap((entry) =>
        entry.type === "action" ? [entry.action] : [],
      );
    expect(actions(true)).toEqual(["open", "quick-composer", "quit"]);
    expect(actions(false)).toEqual(["open", "quit"]);
  });

  it("shows Remote Control status and running sessions", () => {
    const labels = (state: typeof idle, chinese = false) =>
      trayMenu(state, chinese).flatMap((entry) =>
        entry.type === "status" ? [entry.label] : [],
      );
    expect(labels(idle)).toEqual(["Remote Control: Off"]);
    expect(
      labels({ ...idle, remoteControl: true, runningSessions: 1 }),
    ).toEqual(["Remote Control: On", "1 session running"]);
    expect(labels({ ...idle, runningSessions: 3 })).toContain(
      "3 sessions running",
    );
    expect(
      labels({ ...idle, remoteControl: true, runningSessions: 2 }, true),
    ).toEqual(["远程控制：已开启", "2 个会话正在运行"]);
  });
});

describe("background mode support", () => {
  it("covers Windows and macOS only", () => {
    expect(supportsBackgroundMode("darwin")).toBe(true);
    expect(supportsBackgroundMode("win32")).toBe(true);
    expect(supportsBackgroundMode("linux")).toBe(false);
  });
});
