import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { childrenLayoutBounds, layoutRect } from "../layoutRect";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  parent: HTMLElement | null;
}
// Keyed by id: the test DOM may hand out proxies of the same element.
const boxes = new Map<string, Box>();
function boxOf(element: HTMLElement): Box {
  return (
    boxes.get(element.id) ?? {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      parent: null,
    }
  );
}

const getters = {
  offsetLeft: (box: Box) => box.left,
  offsetTop: (box: Box) => box.top,
  offsetWidth: (box: Box) => box.width,
  offsetHeight: (box: Box) => box.height,
  offsetParent: (box: Box) => box.parent,
};
const originals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  const proto = HTMLElement.prototype;
  for (const [name, read] of Object.entries(getters)) {
    originals.set(name, Object.getOwnPropertyDescriptor(proto, name));
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: HTMLElement) {
        return read(boxOf(this));
      },
    });
  }
  // What a scaled ancestor makes of the screen box: never used.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 999,
    y: 999,
    width: 1,
    height: 1,
  } as DOMRect);
});
afterEach(() => {
  const proto = HTMLElement.prototype;
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(proto, name, descriptor);
    else Reflect.deleteProperty(proto, name);
  }
  vi.restoreAllMocks();
});

function place(
  element: HTMLElement,
  box: { left: number; top: number; width: number; height: number },
  parent: HTMLElement | null,
): HTMLElement {
  element.id ||= `box-${boxes.size + 1}`;
  boxes.set(element.id, { ...box, parent });
  return element;
}

describe("layoutRect", () => {
  it("adds up offsets to the ancestor, whatever transforms it has", () => {
    const backdrop = document.createElement("div");
    backdrop.style.transform = "scale(0.96)";
    const composer = place(
      document.createElement("form"),
      { left: 40, top: 500, width: 800, height: 200 },
      backdrop,
    );
    const input = place(
      document.createElement("div"),
      { left: 16, top: 10, width: 768, height: 120 },
      composer,
    );
    expect(layoutRect(input, backdrop)).toEqual({
      x: 56,
      y: 510,
      width: 768,
      height: 120,
    });
    expect(layoutRect(input, document.createElement("div"))).toBeNull();
  });

  it("bounds what the children draw, leaving out screen-reader-only ones", () => {
    const backdrop = document.createElement("div");
    const composer = place(
      document.createElement("form"),
      { left: 40, top: 500, width: 800, height: 200 },
      backdrop,
    );
    const label = place(
      document.createElement("label"),
      { left: 15, top: -1, width: 1, height: 1 },
      composer,
    );
    const input = place(
      document.createElement("div"),
      { left: 16, top: 0, width: 768, height: 120 },
      composer,
    );
    const footer = place(
      document.createElement("div"),
      { left: 16, top: 128, width: 768, height: 32 },
      composer,
    );
    composer.append(label, input, footer);
    expect(childrenLayoutBounds(composer, backdrop)).toEqual({
      x: 56,
      y: 500,
      width: 768,
      height: 160,
    });
  });
});
