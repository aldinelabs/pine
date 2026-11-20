import { describe, expect, it } from "vitest";

import { formatKeyCombo } from "../keyComboLabel";

describe("formatKeyCombo", () => {
  it("joins macOS modifier glyphs in ⌃ ⌥ ⇧ ⌘ order", () => {
    expect(formatKeyCombo("f", ["cmd"])).toBe("⌘ + F");
    expect(formatKeyCombo("t", ["cmd", "shift"])).toBe("⇧ + ⌘ + T");
    expect(formatKeyCombo("x", ["command", "option", "control", "shift"])).toBe(
      "⌃ + ⌥ + ⇧ + ⌘ + X",
    );
  });

  it("normalises modifier aliases and drops duplicates", () => {
    expect(formatKeyCombo("a", ["meta", "super", "Cmd"])).toBe("⌘ + A");
    expect(formatKeyCombo("a", ["ctrl", "control"])).toBe("⌃ + A");
    expect(formatKeyCombo("a", ["opt", "alt"])).toBe("⌥ + A");
  });

  it("reads modifiers combined into the key string", () => {
    expect(formatKeyCombo("cmd+shift+t")).toBe("⇧ + ⌘ + T");
    expect(formatKeyCombo("Command+A", ["shift"])).toBe("⇧ + ⌘ + A");
    expect(formatKeyCombo("cmd++")).toBe("⌘ + +");
    expect(formatKeyCombo("+")).toBe("+");
  });

  it("pretty-prints special keys", () => {
    expect(formatKeyCombo("return")).toBe("Return");
    expect(formatKeyCombo("Enter", ["cmd"])).toBe("⌘ + Return");
    expect(formatKeyCombo("escape")).toBe("Esc");
    expect(formatKeyCombo("tab", ["shift"])).toBe("⇧ + Tab");
    expect(formatKeyCombo("space")).toBe("Space");
    expect(formatKeyCombo("ArrowLeft", ["alt"])).toBe("⌥ + ←");
    expect(formatKeyCombo("up")).toBe("↑");
    expect(formatKeyCombo("backspace")).toBe("Backspace");
    expect(formatKeyCombo("forwarddelete")).toBe("Forward Delete");
    expect(formatKeyCombo("pagedown")).toBe("Page Down");
    expect(formatKeyCombo("f5")).toBe("F5");
    expect(formatKeyCombo("leftbracket", ["cmd"])).toBe("⌘ + [");
    expect(formatKeyCombo("numpad7")).toBe("Num 7");
  });

  it("shows a bare modifier press as that modifier", () => {
    expect(formatKeyCombo("shift")).toBe("⇧");
  });

  it("uses text modifier names off macOS", () => {
    expect(formatKeyCombo("f", ["ctrl"], "win32")).toBe("Ctrl + F");
    expect(formatKeyCombo("t", ["cmd", "shift", "alt", "ctrl"], "linux")).toBe(
      "Ctrl + Alt + Shift + Win + T",
    );
    expect(formatKeyCombo("return", [], "win32")).toBe("Enter");
  });
});
