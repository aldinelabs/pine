import { afterEach, describe, expect, it } from "vitest";
import { flipTransform, visibleSourceRect } from "../imageViewerFlight";

const WINDOW = { width: 1000, height: 800 };

function element(
  rect: { left: number; top: number; width: number; height: number },
  parent: HTMLElement = document.body,
): HTMLElement {
  const node = document.createElement("img");
  node.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }) as DOMRect;
  parent.append(node);
  return node;
}

describe("flipTransform", () => {
  it("draws the target box over the source box", () => {
    expect(
      flipTransform(
        { left: 40, top: 300, width: 200, height: 100 },
        { left: 100, top: 64, width: 800, height: 400 },
      ),
    ).toBe("translate(-60px, 236px) scale(0.25, 0.25)");
    expect(
      flipTransform(
        { left: 0, top: 0, width: 300, height: 100 },
        { left: 10, top: 20, width: 150, height: 200 },
      ),
    ).toBe("translate(-10px, -20px) scale(2, 0.5)");
  });
});

describe("visibleSourceRect", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the rect of a visible image", () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    expect(visibleSourceRect(element(rect), WINDOW)).toEqual(rect);
  });

  it("has no rect for a removed, empty or off-screen image", () => {
    expect(visibleSourceRect(undefined, WINDOW)).toBeUndefined();
    const removed = element({ left: 0, top: 0, width: 10, height: 10 });
    removed.remove();
    expect(visibleSourceRect(removed, WINDOW)).toBeUndefined();
    expect(
      visibleSourceRect(
        element({ left: 0, top: 0, width: 0, height: 10 }),
        WINDOW,
      ),
    ).toBeUndefined();
    expect(
      visibleSourceRect(
        element({ left: 0, top: 900, width: 100, height: 100 }),
        WINDOW,
      ),
    ).toBeUndefined();
    expect(
      visibleSourceRect(
        element({ left: -300, top: 0, width: 100, height: 100 }),
        WINDOW,
      ),
    ).toBeUndefined();
  });

  it("has no rect for an image scrolled out of its scroller", () => {
    const scroller = document.createElement("div");
    scroller.dataset.slot = "scroll-area-viewport";
    scroller.getBoundingClientRect = () =>
      ({ left: 0, top: 100, right: 1000, bottom: 500 }) as DOMRect;
    document.body.append(scroller);
    const inner = document.createElement("div");
    scroller.append(inner);
    expect(
      visibleSourceRect(
        element({ left: 0, top: 10, width: 100, height: 80 }, inner),
        WINDOW,
      ),
    ).toBeUndefined();
    expect(
      visibleSourceRect(
        element({ left: 0, top: 450, width: 100, height: 80 }, inner),
        WINDOW,
      ),
    ).toEqual({ left: 0, top: 450, width: 100, height: 80 });
  });
});
