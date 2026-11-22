import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { installWindowShortcuts } from "../windowShortcuts";
import {
  CLOSE_TAB_REQUESTED_CHANNEL,
  NEW_TAB_REQUESTED_CHANNEL,
} from "../../shared/window";

describe("native close shortcut", () => {
  it.each([
    ["w", CLOSE_TAB_REQUESTED_CHANNEL],
    ["n", NEW_TAB_REQUESTED_CHANNEL],
    ["t", NEW_TAB_REQUESTED_CHANNEL],
  ])(
    "intercepts Ctrl/Cmd+%s before the menu and ignores repeats and other shortcuts",
    (key, channel) => {
      const contents = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        setIgnoreMenuShortcuts: vi.fn(),
      });
      installWindowShortcuts(
        contents as unknown as WebContents,
        vi.fn(),
        vi.fn(),
      );
      for (const modifiers of [{ control: true }, { meta: true }]) {
        const event = { preventDefault: vi.fn() };
        contents.emit("before-input-event", event, {
          type: "keyDown",
          key: key.toUpperCase(),
          ...modifiers,
        });
        expect(event.preventDefault).toHaveBeenCalledOnce();
      }
      expect(contents.send).toHaveBeenCalledTimes(2);
      expect(contents.send).toHaveBeenCalledWith(channel);
      const repeated = { preventDefault: vi.fn() };
      contents.emit("before-input-event", repeated, {
        type: "keyDown",
        key,
        control: true,
        isAutoRepeat: true,
      });
      expect(repeated.preventDefault).toHaveBeenCalledOnce();
      for (const override of [
        // Shift+N and Shift+W belong to the window shortcuts.
        ...(key === "n" || key === "w" ? [] : [{ shift: true }]),
        { alt: true },
        { control: false },
        { type: "keyUp" },
        { key: "q" },
      ]) {
        const event = { preventDefault: vi.fn() };
        contents.emit("before-input-event", event, {
          type: "keyDown",
          key,
          control: true,
          ...override,
        });
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
      expect(contents.send).toHaveBeenCalledTimes(2);
    },
  );

  it("creates a new window instance on Ctrl/Cmd+Shift+N but ignores repeats and modifiers", () => {
    const contents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      setIgnoreMenuShortcuts: vi.fn(),
    });
    const onCreateWindow = vi.fn();
    installWindowShortcuts(
      contents as unknown as WebContents,
      onCreateWindow,
      vi.fn(),
    );

    for (const modifiers of [{ control: true }, { meta: true }]) {
      const event = { preventDefault: vi.fn() };
      contents.emit("before-input-event", event, {
        type: "keyDown",
        key: "N",
        shift: true,
        ...modifiers,
      });
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(onCreateWindow).toHaveBeenCalledTimes(2);

    const repeated = { preventDefault: vi.fn() };
    contents.emit("before-input-event", repeated, {
      type: "keyDown",
      key: "N",
      shift: true,
      control: true,
      isAutoRepeat: true,
    });
    expect(onCreateWindow).toHaveBeenCalledTimes(2);

    for (const override of [{ alt: true }, { control: false }]) {
      const event = { preventDefault: vi.fn() };
      contents.emit("before-input-event", event, {
        type: "keyDown",
        key: "N",
        shift: true,
        control: true,
        ...override,
      });
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(onCreateWindow).toHaveBeenCalledTimes(2);
  });

  it("closes the window on Ctrl/Cmd+Shift+W but ignores repeats and modifiers", () => {
    const contents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      setIgnoreMenuShortcuts: vi.fn(),
    });
    const onCloseWindow = vi.fn();
    installWindowShortcuts(
      contents as unknown as WebContents,
      vi.fn(),
      onCloseWindow,
    );

    for (const modifiers of [{ control: true }, { meta: true }]) {
      const event = { preventDefault: vi.fn() };
      contents.emit("before-input-event", event, {
        type: "keyDown",
        key: "W",
        shift: true,
        ...modifiers,
      });
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(onCloseWindow).toHaveBeenCalledTimes(2);
    expect(contents.send).not.toHaveBeenCalled();

    const repeated = { preventDefault: vi.fn() };
    contents.emit("before-input-event", repeated, {
      type: "keyDown",
      key: "W",
      shift: true,
      control: true,
      isAutoRepeat: true,
    });
    expect(repeated.preventDefault).toHaveBeenCalledOnce();
    expect(onCloseWindow).toHaveBeenCalledTimes(2);

    for (const override of [{ alt: true }, { control: false }]) {
      const event = { preventDefault: vi.fn() };
      contents.emit("before-input-event", event, {
        type: "keyDown",
        key: "W",
        shift: true,
        control: true,
        ...override,
      });
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(onCloseWindow).toHaveBeenCalledTimes(2);
  });

  it("passes Ctrl/Cmd+R to the page but keeps the menu from reloading", () => {
    const contents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      setIgnoreMenuShortcuts: vi.fn(),
    });
    installWindowShortcuts(
      contents as unknown as WebContents,
      vi.fn(),
      vi.fn(),
    );
    for (const modifiers of [{ control: true }, { meta: true }]) {
      const reload = { preventDefault: vi.fn() };
      contents.emit("before-input-event", reload, {
        type: "keyDown",
        key: "r",
        ...modifiers,
      });
      expect(reload.preventDefault).not.toHaveBeenCalled();
      expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
      const forceReload = { preventDefault: vi.fn() };
      contents.emit("before-input-event", forceReload, {
        type: "keyDown",
        key: "R",
        shift: true,
        ...modifiers,
      });
      expect(forceReload.preventDefault).not.toHaveBeenCalled();
      expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    }
    for (const input of [
      { key: "r" },
      { key: "r", meta: true, alt: true },
      { key: "i", meta: true },
    ]) {
      contents.emit(
        "before-input-event",
        { preventDefault: vi.fn() },
        { type: "keyDown", ...input },
      );
      expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    }
    expect(contents.send).not.toHaveBeenCalled();
  });
});
