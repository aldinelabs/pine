import { EventEmitter } from "node:events";
import type { BrowserWindow, Rectangle } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workArea = { x: 0, y: 25, width: 1512, height: 920 };
vi.mock("electron", () => ({
  screen: {
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getDisplayNearestPoint: () => ({ workArea }),
    getPrimaryDisplay: () => ({ workArea }),
  },
  systemPreferences: {
    getAnimationSettings: () => ({ prefersReducedMotion: false }),
  },
}));

import {
  COLLAPSED_WINDOW_WIDTH,
  QUICK_COMPOSER_BOTTOM_GAP,
  QuickComposerController,
  alignedWindowBounds,
  quickComposerBounds,
} from "../quickComposer";
import {
  QUICK_COMPOSER_CONTEXT_CHANNEL,
  QUICK_COMPOSER_GLASS_RADIUS,
  QUICK_COMPOSER_HIDDEN_CHANNEL,
  QUICK_COMPOSER_SHOWN_CHANNEL,
  type QuickComposerContext,
} from "../../shared/quickComposer";

let nextId = 1;
function fakeWindow(bounds: Rectangle) {
  const window = Object.assign(new EventEmitter(), {
    bounds,
    visible: false,
    destroyed: false,
    webContents: { id: nextId++, send: vi.fn() },
    getBounds: () => window.bounds,
    getContentBounds: () => window.bounds,
    setBounds: vi.fn((next: Rectangle) => (window.bounds = next)),
    isVisible: () => window.visible,
    isDestroyed: () => window.destroyed,
    show: vi.fn(() => (window.visible = true)),
    hide: vi.fn(() => (window.visible = false)),
    focus: vi.fn(),
    destroy: vi.fn(() => (window.destroyed = true)),
    setIgnoreMouseEvents: vi.fn(),
    showInactive: vi.fn(() => (window.visible = true)),
    moveTop: vi.fn(),
    setHasShadow: vi.fn(),
    opacity: 1,
    getOpacity: () => window.opacity,
    setOpacity: vi.fn((next: number) => (window.opacity = next)),
  });
  return window;
}
type FakeWindow = ReturnType<typeof fakeWindow>;

const composerRect = { x: 48, y: 700, width: 768, height: 120 };
const request = {
  message: "Hello",
  approvalMode: "auto-approve" as const,
  projectId: "tmp",
  withContext: false,
  composerRect,
};

describe("quick composer layout", () => {
  it("centres a collapsed window in the work area", () => {
    expect(quickComposerBounds(workArea)).toEqual({
      x: (1512 - COLLAPSED_WINDOW_WIDTH) / 2,
      y: 25 + 920 - 840 - QUICK_COMPOSER_BOTTOM_GAP,
      width: COLLAPSED_WINDOW_WIDTH,
      height: 840,
    });
    expect(
      quickComposerBounds({ x: 0, y: 0, width: 800, height: 600 }),
    ).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("moves a window so its composer lands on the floating one", () => {
    expect(
      alignedWindowBounds(
        { x: 100, y: 100, width: 864, height: 840 },
        { x: 100, y: 128, width: 864, height: 812 },
        { x: 48, y: 690, width: 768, height: 120 },
        { x: 200, y: 800, width: 768, height: 120 },
      ),
    ).toEqual({ x: 152, y: 82, width: 864, height: 840 });
    // A taller composer here keeps its bottom edge on the floating one's.
    expect(
      alignedWindowBounds(
        { x: 100, y: 100, width: 864, height: 840 },
        { x: 100, y: 128, width: 864, height: 812 },
        { x: 48, y: 650, width: 768, height: 160 },
        { x: 200, y: 800, width: 768, height: 120 },
      ),
    ).toEqual({ x: 152, y: 82, width: 864, height: 840 });
  });
});

describe("QuickComposerController", () => {
  let panel: FakeWindow;
  let handoffWindows: FakeWindow[];
  let controller: QuickComposerController;

  beforeEach(() => {
    vi.useFakeTimers();
    handoffWindows = [];
    controller = new QuickComposerController({
      createPanel: (bounds) => {
        panel = fakeWindow(bounds);
        return panel as unknown as BrowserWindow;
      },
      createHandoffWindow: (bounds) => {
        const window = fakeWindow(bounds);
        handoffWindows.push(window);
        return window as unknown as BrowserWindow;
      },
    });
    controller.warmUp();
    panel.emit("ready-to-show");
  });

  afterEach(() => vi.useRealTimers());

  it("toggles the panel and prepares one hidden window while it shows", () => {
    controller.toggle();
    expect(panel.show).toHaveBeenCalledOnce();
    expect(panel.setIgnoreMouseEvents).toHaveBeenCalledWith(true, {
      forward: true,
    });
    expect(panel.webContents.send).toHaveBeenCalledWith(
      QUICK_COMPOSER_SHOWN_CHANNEL,
      { id: expect.any(Number) as number },
    );
    expect(handoffWindows).toHaveLength(1);
    expect(handoffWindows[0]?.visible).toBe(false);
    expect(controller.isAuxiliary(panel as unknown as BrowserWindow)).toBe(
      true,
    );

    controller.toggle();
    expect(panel.visible).toBe(false);
    // It resets for the next showing while hidden.
    expect(panel.webContents.send).toHaveBeenLastCalledWith(
      QUICK_COMPOSER_HIDDEN_CHANNEL,
    );
    controller.toggle();
    expect(handoffWindows).toHaveLength(1);
  });

  it("fades the panel in", () => {
    controller.show();
    expect(panel.setOpacity).toHaveBeenNthCalledWith(1, 0);
    expect(panel.show).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(panel.opacity).toBeGreaterThan(0);
    expect(panel.opacity).toBeLessThan(1);
    vi.advanceTimersByTime(500);
    expect(panel.opacity).toBe(1);
  });

  it("shows a panel summoned while loading only once it has painted", () => {
    controller.dispose();
    controller.show();
    expect(panel.show).not.toHaveBeenCalled();
    panel.emit("ready-to-show");
    expect(panel.show).toHaveBeenCalledOnce();
    expect(panel.webContents.send).toHaveBeenCalledWith(
      QUICK_COMPOSER_SHOWN_CHANNEL,
      { id: expect.any(Number) as number },
    );
  });

  it("cancels a panel summoned twice while loading", () => {
    controller.dispose();
    controller.toggle();
    controller.toggle();
    panel.emit("ready-to-show");
    expect(panel.show).not.toHaveBeenCalled();
  });

  it("loads the panel ahead of time without showing it", () => {
    expect(panel.show).not.toHaveBeenCalled();
    controller.show();
    expect(panel.show).toHaveBeenCalledOnce();
  });

  it("keeps Liquid Glass under the composer while the panel shows", () => {
    const glass = fakeWindow({ x: 0, y: 0, width: 1, height: 1 });
    const withGlass = new QuickComposerController({
      createPanel: (bounds) => {
        panel = fakeWindow(bounds);
        return panel as unknown as BrowserWindow;
      },
      createHandoffWindow: (bounds) =>
        fakeWindow(bounds) as unknown as BrowserWindow,
      createGlass: () => glass as unknown as BrowserWindow,
    });
    withGlass.warmUp();
    panel.emit("ready-to-show");
    withGlass.show();
    const rect = { x: 40, y: 700, width: 784, height: 100 };
    expect(withGlass.setGlass(rect)).toBe(true);
    // It grows in with the panel, then settles where the card is.
    expect(glass.bounds.width).toBeLessThan(784);
    vi.advanceTimersByTime(600);
    expect(glass.opacity).toBe(1);
    expect(glass.bounds).toEqual({
      x: panel.bounds.x + 40,
      y: panel.bounds.y + 700,
      width: 784,
      height: 100,
    });
    expect(glass.showInactive).toHaveBeenCalledOnce();
    expect(panel.moveTop).toHaveBeenCalledOnce();
    // The shadow follows the new shape.
    expect(glass.setHasShadow).toHaveBeenLastCalledWith(true);
    glass.setHasShadow.mockClear();
    withGlass.setGlass(rect);
    expect(glass.setHasShadow).not.toHaveBeenCalled();
    expect(withGlass.isAuxiliary(glass as unknown as BrowserWindow)).toBe(true);

    withGlass.hide();
    expect(glass.visible).toBe(false);
    withGlass.show();
    // Shown before the panel, which then orders in above it.
    expect(glass.showInactive.mock.invocationCallOrder[1]).toBeLessThan(
      panel.show.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it("opens the glass into the window before the window fades in", () => {
    const glass = fakeWindow({ x: 0, y: 0, width: 1, height: 1 });
    const radii: number[] = [];
    const presenting: boolean[] = [];
    const handoffs: FakeWindow[] = [];
    const withGlass = new QuickComposerController({
      createPanel: (bounds) => {
        panel = fakeWindow(bounds);
        return panel as unknown as BrowserWindow;
      },
      createHandoffWindow: (bounds) => {
        const window = fakeWindow(bounds);
        handoffs.push(window);
        return window as unknown as BrowserWindow;
      },
      createGlass: () => glass as unknown as BrowserWindow,
      setGlassRadius: (_glass, radius) => radii.push(radius),
      windowCornerRadius: () => 12,
      setPresenting: (_window, value) => presenting.push(value),
    });
    withGlass.warmUp();
    panel.emit("ready-to-show");
    withGlass.show();
    withGlass.setGlass({ x: 40, y: 700, width: 784, height: 100 });
    vi.advanceTimersByTime(600);

    expect(withGlass.submit(request)).toBe(12);
    const [target] = handoffs as [FakeWindow];
    // Ready early, it still waits for the glass to fill its place.
    withGlass.present(target.webContents.id, composerRect);
    expect(presenting).toEqual([true]);
    vi.advanceTimersByTime(200);
    expect(target.visible).toBe(false);
    expect(glass.bounds.width).toBeGreaterThan(784);

    vi.advanceTimersByTime(300);
    // Just inside the window, which the composer alignment placed.
    expect(glass.bounds).toEqual({
      x: target.bounds.x + 1,
      y: target.bounds.y + 1,
      width: target.bounds.width - 2,
      height: target.bounds.height - 2,
    });
    expect(radii.at(-1)).toBe(11);
    expect(target.visible).toBe(true);
    // Focus moving to the new window leaves the panel up while it fades in.
    panel.emit("blur");
    vi.advanceTimersByTime(150);
    expect(panel.visible).toBe(true);
    expect(target.opacity).toBeGreaterThan(0);
    expect(target.opacity).toBeLessThan(1);

    vi.advanceTimersByTime(200);
    expect(target.opacity).toBe(1);
    // Then the panel fades out over it.
    expect(panel.visible).toBe(true);
    vi.advanceTimersByTime(120);
    expect(panel.opacity).toBeLessThan(1);
    expect(glass.opacity).toBeLessThan(1);
    vi.advanceTimersByTime(200);
    expect(presenting).toEqual([true, false]);
    expect(panel.visible).toBe(false);
    expect(glass.visible).toBe(false);
    // Hidden, it is as round as the card again for the next showing.
    expect(radii.at(-1)).toBe(QUICK_COMPOSER_GLASS_RADIUS);
  });

  it("reports no glass where the system has none", () => {
    controller.show();
    expect(controller.setGlass({ x: 0, y: 0, width: 1, height: 1 })).toBe(
      false,
    );
  });

  it("hides on blur unless a native dialog of the panel is open", async () => {
    controller.show();
    let close!: () => void;
    const dialog = controller.whileModal(
      panel.webContents as never,
      new Promise<void>((resolve) => (close = resolve)),
    );
    panel.emit("blur");
    expect(panel.visible).toBe(true);
    close();
    await dialog;
    panel.emit("blur");
    expect(panel.visible).toBe(false);
  });

  it("hands the message to the prepared window and presents it aligned", async () => {
    controller.show();
    const [target] = handoffWindows as [FakeWindow];
    const contents = target.webContents as never;
    const taken = controller.takeHandoff(contents);

    controller.submit(request);
    await expect(taken).resolves.toEqual({
      message: "Hello",
      approvalMode: "auto-approve",
      projectId: "tmp",
      context: [],
    });
    expect(controller.isAuxiliary(target as unknown as BrowserWindow)).toBe(
      false,
    );

    const panelBounds = panel.bounds;
    controller.present(target.webContents.id, {
      ...composerRect,
      y: composerRect.y - 10,
    });
    expect(target.bounds).toEqual({ ...panelBounds, y: panelBounds.y + 10 });
    // Shown once the panel has opened to its size.
    expect(target.visible).toBe(false);
    vi.runAllTimers();
    expect(target.visible).toBe(true);
    expect(panel.visible).toBe(false);
    // Presenting again does nothing: the window is the user's now.
    controller.present(target.webContents.id, composerRect);
    expect(target.show).toHaveBeenCalledOnce();
  });

  it("gives a message to the window that holds its project", () => {
    const owner = fakeWindow({ x: 0, y: 0, width: 1200, height: 800 });
    const delivered: unknown[] = [];
    const routed = new QuickComposerController({
      createPanel: (bounds) => {
        panel = fakeWindow(bounds);
        return panel as unknown as BrowserWindow;
      },
      createHandoffWindow: (bounds) =>
        fakeWindow(bounds) as unknown as BrowserWindow,
      ownerWindow: (projectId) =>
        projectId === "held" ? (owner as unknown as BrowserWindow) : null,
      deliver: (window, handoff) => delivered.push([window, handoff]),
    });
    routed.warmUp();
    panel.emit("ready-to-show");
    routed.show();
    vi.advanceTimersByTime(600);

    expect(routed.submit({ ...request, projectId: "held" })).toBeNull();
    expect(delivered).toEqual([
      [
        owner,
        {
          message: "Hello",
          approvalMode: "auto-approve",
          projectId: "held",
          context: [],
        },
      ],
    ]);
    // Focus moving to that window leaves the panel to fade out.
    panel.emit("blur");
    expect(panel.visible).toBe(true);
    vi.advanceTimersByTime(300);
    expect(panel.visible).toBe(false);
  });

  it("keeps a message sent before the window asks for it", async () => {
    controller.show();
    controller.submit(request);
    const [target] = handoffWindows as [FakeWindow];
    await expect(
      controller.takeHandoff(target.webContents as never),
    ).resolves.toMatchObject({ message: "Hello" });
    await expect(
      controller.takeHandoff({ id: 999 } as never),
    ).resolves.toBeNull();
  });

  it("shows the window anyway when it never reports its composer", () => {
    controller.show();
    controller.submit(request);
    vi.advanceTimersByTime(3000);
    expect(handoffWindows[0]?.visible).toBe(true);
  });

  it("destroys only windows that never showed when disposed", () => {
    controller.show();
    const [prepared] = handoffWindows as [FakeWindow];
    controller.dispose();
    expect(prepared.destroy).toHaveBeenCalledOnce();
    expect(panel.destroy).toHaveBeenCalledOnce();
  });

  describe("with the app the user was in", () => {
    type Captured = Omit<QuickComposerContext, "shownId">;
    const captured: Captured = {
      attachments: [
        {
          extension: "png",
          kind: "file",
          modifiedAt: "2026-10-30T00:00:00.000Z",
          name: "Notes.png",
          path: "/tmp/notes.png",
          size: 10,
          source: { app: "Notes" },
        },
      ],
      missing: ["accessibility"],
    };
    let captures: Array<(context: Captured) => void>;
    let visibleWhenNoted: boolean[];
    let discarded: unknown[][];

    beforeEach(() => {
      captures = [];
      visibleWhenNoted = [];
      discarded = [];
      controller.dispose();
      controller = new QuickComposerController({
        createPanel: (bounds) => {
          panel = fakeWindow(bounds);
          return panel as unknown as BrowserWindow;
        },
        createHandoffWindow: (bounds) => {
          const window = fakeWindow(bounds);
          handoffWindows.push(window);
          return window as unknown as BrowserWindow;
        },
        captureContext: () => {
          visibleWhenNoted.push(panel.visible);
          return () => new Promise((resolve) => captures.push(resolve));
        },
        discardContext: (attachments) => discarded.push([...attachments]),
      });
      controller.warmUp();
      panel.emit("ready-to-show");
    });

    function sentContexts(): unknown[] {
      return panel.webContents.send.mock.calls
        .filter(([channel]) => channel === QUICK_COMPOSER_CONTEXT_CHANNEL)
        .map(([, context]) => context as unknown);
    }

    /** Shows the panel and lets its entrance finish, which starts a capture. */
    function showAndCapture(context: Captured = captured): Promise<void> {
      controller.show();
      vi.advanceTimersByTime(600);
      captures.at(-1)?.(context);
      const count = sentContexts().length;
      return vi.waitFor(() => expect(sentContexts()).toHaveLength(count + 1));
    }

    it("notes the app before the panel shows, and captures once it has appeared", async () => {
      controller.show();
      expect(visibleWhenNoted).toEqual([false]);
      expect(captures).toHaveLength(0);
      vi.advanceTimersByTime(600);
      expect(captures).toHaveLength(1);
      captures[0]?.(captured);
      await vi.waitFor(() => expect(sentContexts()).toHaveLength(1));
      expect(sentContexts()[0]).toEqual({ shownId: 1, ...captured });
    });

    it("sends what it captured with the message unless it was dropped", async () => {
      await showAndCapture();
      const [target] = handoffWindows as [FakeWindow];
      const taken = controller.takeHandoff(target.webContents as never);
      controller.submit({ ...request, withContext: true });
      await expect(taken).resolves.toMatchObject({
        context: captured.attachments,
      });
      // The session has it now.
      controller.hide();
      expect(discarded).toEqual([]);

      await showAndCapture();
      const next = handoffWindows.at(-1) as FakeWindow;
      const dropped = controller.takeHandoff(next.webContents as never);
      controller.submit({ ...request, withContext: false });
      await expect(dropped).resolves.toMatchObject({ context: [] });
      controller.hide();
      expect(discarded).toEqual([captured.attachments]);
    });

    it("deletes context closed without sending", async () => {
      await showAndCapture();
      controller.hide();
      expect(discarded).toEqual([captured.attachments]);
      controller.show();
      expect(discarded).toHaveLength(1);
    });

    it("captures nothing for a panel closed during its entrance", () => {
      controller.show();
      controller.hide();
      vi.advanceTimersByTime(600);
      expect(captures).toHaveLength(0);
    });

    it("deletes a capture that finishes after the panel closed", async () => {
      controller.show();
      vi.advanceTimersByTime(600);
      controller.hide();
      captures[0]?.(captured);
      await vi.waitFor(() => expect(discarded).toEqual([captured.attachments]));
      expect(sentContexts()).toEqual([]);
    });
  });
});
