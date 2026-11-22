import type { NativeImage } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  startPresentedFileDrag,
  startProjectFileDrag,
} from "../projectFileDrag";

describe("startProjectFileDrag", () => {
  it("uses the host-associated file icon instead of the app icon", async () => {
    const icon = {} as NativeImage;
    const loadIcon = vi.fn(() => Promise.resolve(icon));
    const startDrag = vi.fn();
    const sender = {
      isDestroyed: () => false,
      startDrag,
    };

    await startProjectFileDrag(sender, "/project/notes.md", loadIcon);

    expect(loadIcon).toHaveBeenCalledWith("/project/notes.md", {
      size: "normal",
    });
    expect(startDrag).toHaveBeenCalledWith({
      file: "/project/notes.md",
      icon,
    });
  });

  it("does not start a drag if the sender is destroyed while loading the icon", async () => {
    const loadIcon = vi.fn(() => Promise.resolve({} as never));
    const startDrag = vi.fn();
    const sender = {
      isDestroyed: vi.fn(() => true),
      startDrag,
    };

    await startProjectFileDrag(sender, "/project/notes.md", loadIcon);

    expect(startDrag).not.toHaveBeenCalled();
  });
});

describe("startPresentedFileDrag", () => {
  function sender() {
    return { isDestroyed: () => false, startDrag: vi.fn() };
  }

  it("drags the path the window's presented grants resolve to", async () => {
    const icon = {} as NativeImage;
    const target = sender();
    const authorize = vi.fn(() => Promise.resolve("/private/tmp/report.md"));

    await startPresentedFileDrag(
      target,
      { path: "/tmp/report.md" },
      authorize,
      () => Promise.resolve(icon),
    );

    expect(authorize).toHaveBeenCalledWith("/tmp/report.md");
    expect(target.startDrag).toHaveBeenCalledWith({
      file: "/private/tmp/report.md",
      icon,
    });
  });

  it("refuses a path that was not presented to the window", async () => {
    const target = sender();
    const loadIcon = vi.fn(() => Promise.resolve({} as NativeImage));

    await expect(
      startPresentedFileDrag(
        target,
        { path: "/etc/passwd" },
        () =>
          Promise.reject(
            new Error("This file was not presented to this window."),
          ),
        loadIcon,
      ),
    ).rejects.toThrow("not presented");
    expect(loadIcon).not.toHaveBeenCalled();
    expect(target.startDrag).not.toHaveBeenCalled();
  });

  it("rejects malformed requests before authorizing", async () => {
    const authorize = vi.fn(() => Promise.resolve("/tmp/x"));

    await expect(
      startPresentedFileDrag(sender(), { path: "" }, authorize, () =>
        Promise.resolve({} as NativeImage),
      ),
    ).rejects.toThrow();
    expect(authorize).not.toHaveBeenCalled();
  });
});
