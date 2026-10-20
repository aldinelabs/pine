import { afterEach, expect, it, vi } from "vitest";
import { useCollapseTransition } from "../useCollapseTransition";

const IN_OUT = "cubic-bezier(0.87, 0, 0.13, 1)";
const OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

function animatedElement() {
  const element = document.createElement("div");
  const animations: EventTarget[] = [];
  const animate = vi.fn<
    (frames: Keyframe[], options: KeyframeAnimationOptions) => Animation
  >(() => {
    const animation = new EventTarget();
    animations.push(animation);
    return animation as Animation;
  });
  Object.assign(element, { animate, getAnimations: () => [] });
  return { element, animate, animations };
}

/** Each step as the properties it animates, its curve, delay and fill. */
function steps(animate: ReturnType<typeof animatedElement>["animate"]) {
  return animate.mock.calls.map(([frames, options]) => [
    Object.keys(frames[0] ?? {}),
    options.easing,
    options.delay ?? 0,
    options.fill ?? "none",
  ]);
}

function row(...children: HTMLElement[]): HTMLElement {
  const parent = document.createElement("div");
  parent.style.columnGap = "8px";
  parent.append(...children);
  document.body.append(parent);
  return parent;
}

afterEach(() => {
  document.body.replaceChildren();
});

it("makes room beside a neighbour, then blurs in", () => {
  const { onEnter } = useCollapseTransition("width");
  const { element, animate } = animatedElement();
  row(document.createElement("div"), element);

  onEnter(element, () => {});

  expect(steps(animate)).toEqual([
    [["width", "height", "marginInlineStart"], OUT, 0, "none"],
    [["opacity", "transform", "filter"], IN_OUT, 200, "backwards"],
  ]);
  expect(animate.mock.calls[0]?.[0][0]).toMatchObject({
    marginInlineStart: "-8px",
  });
});

it("blurs out, then gives its room back to the neighbour", () => {
  const { onLeave } = useCollapseTransition("width");
  const { element, animate } = animatedElement();
  row(element, document.createElement("div"));

  onLeave(element, () => {});

  expect(steps(animate)).toEqual([
    [["opacity", "transform", "filter"], IN_OUT, 0, "forwards"],
    [["width", "height", "marginInlineEnd"], OUT, 350, "forwards"],
  ]);
});

it("only blurs when no neighbour needs to move", () => {
  const { onEnter, onLeave } = useCollapseTransition("width");
  const { element, animate } = animatedElement();
  row(element);

  onEnter(element, () => {});
  onLeave(element, () => {});

  expect(steps(animate)).toEqual([
    [["opacity", "transform", "filter"], IN_OUT, 0, "backwards"],
    [["opacity", "transform", "filter"], IN_OUT, 0, "forwards"],
  ]);
});

it("always makes room vertically", () => {
  const { onEnter } = useCollapseTransition("height");
  const { element, animate } = animatedElement();

  onEnter(element, () => {});

  expect(steps(animate)[0]).toEqual([["height"], OUT, 0, "none"]);
});

it("finishes once every step has", () => {
  const { onLeave } = useCollapseTransition("height");
  const { element, animations } = animatedElement();
  const done = vi.fn();

  onLeave(element, done);
  animations[0]?.dispatchEvent(new Event("finish"));
  expect(done).not.toHaveBeenCalled();
  animations[1]?.dispatchEvent(new Event("finish"));

  expect(done).toHaveBeenCalledOnce();
});

it("finishes at once without the Web Animations API", () => {
  const { onLeave } = useCollapseTransition();
  const done = vi.fn();
  const element = document.createElement("div");
  Object.defineProperty(element, "animate", { value: undefined });

  onLeave(element, done);

  expect(done).toHaveBeenCalledOnce();
});
