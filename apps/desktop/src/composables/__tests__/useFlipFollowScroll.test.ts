import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { easeOutExpo } from "@/lib/animateScroll";
import {
  createFlipFollowScroll,
  useFlipFollowScroll,
} from "../useFlipFollowScroll";

interface FakeAnimation {
  currentTime: number | null;
  playState: AnimationPlayState;
  cancel: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
}

function fakeScroller(maxTop = 10_000) {
  let top = 0;
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    top = Math.min(maxTop, Math.max(0, options.top ?? top));
  });
  const element = {
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = value;
    },
    scrollTo,
  } as unknown as HTMLElement;
  return { element, scrollTo, setTop: (value: number) => (top = value) };
}

function fakeContent(withAnimate = true) {
  const animations: FakeAnimation[] = [];
  const animate = vi.fn<
    (keyframes: Keyframe[], options: KeyframeAnimationOptions) => FakeAnimation
  >((): FakeAnimation => {
    const animation: FakeAnimation = {
      currentTime: 0,
      playState: "running",
      cancel: vi.fn(),
      addEventListener: vi.fn(),
    };
    animations.push(animation);
    return animation;
  });
  const element = (withAnimate ? { animate } : {}) as unknown as HTMLElement;
  return { element, animate, animations };
}

function setup(options: { reducedMotion?: boolean; animate?: boolean } = {}) {
  const scroller = fakeScroller();
  const content = fakeContent(options.animate ?? true);
  const follow = createFlipFollowScroll({
    scroller: () => scroller.element,
    content: () => content.element,
    reducedMotion: () => options.reducedMotion ?? false,
  });
  return { scroller, content, follow };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFlipFollowScroll", () => {
  it("writes the scroll position once and glides the content from where it showed", () => {
    const { scroller, content, follow } = setup();
    follow.glideTo(300);
    expect(scroller.scrollTo.mock.calls).toEqual([
      [{ top: 300, behavior: "instant" }],
    ]);
    expect(content.animate).toHaveBeenCalledTimes(1);
    expect(content.animate).toHaveBeenCalledWith(
      [{ transform: "translateY(300px)" }, { transform: "none" }],
      { duration: 500, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    expect(follow.offset()).toBe(300);
    expect(follow.isGliding()).toBe(true);
  });

  it("retargets mid-glide from the on-screen position", () => {
    const { scroller, content, follow } = setup();
    follow.glideTo(300);
    const first = content.animations[0];
    first.currentTime = 100;
    const shown = 300 * (1 - easeOutExpo(0.2));
    expect(follow.offset()).toBeCloseTo(shown, 6);
    const visualBefore = 300 - follow.offset();

    scroller.scrollTo.mockClear();
    follow.glideTo(400);
    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);
    const [keyframes] = content.animate.mock.calls[1] as unknown as [
      Keyframe[],
    ];
    const from = Number(
      /translateY\((.+)px\)/.exec(String(keyframes[0].transform))?.[1],
    );
    expect(from).toBeCloseTo(400 - visualBefore, 6);
    // No jump: at the new glide's start the content shows where it did.
    expect(400 - follow.offset()).toBeCloseTo(visualBefore, 6);
  });

  it("reads a pending glide as its start and a finished one as idle", () => {
    const { content, follow } = setup();
    follow.glideTo(300);
    const animation = content.animations[0];
    animation.currentTime = null;
    expect(follow.offset()).toBe(300);
    animation.currentTime = 500;
    animation.playState = "finished";
    expect(follow.offset()).toBe(0);
    expect(follow.isGliding()).toBe(false);
    follow.glideTo(450);
    expect(animation.cancel).not.toHaveBeenCalled();
    // A glide from the settled position: the full distance.
    expect(follow.offset()).toBe(150);
  });

  it("stops a glide on interrupt, keeping the on-screen position", () => {
    const { scroller, content, follow } = setup();
    follow.interrupt();
    expect(scroller.scrollTo).not.toHaveBeenCalled();

    follow.glideTo(300);
    content.animations[0].currentTime = 100;
    const shown = follow.offset();
    scroller.scrollTo.mockClear();
    follow.interrupt();
    expect(content.animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTo.mock.calls[0][0].behavior).toBe("instant");
    expect(scroller.scrollTo.mock.calls[0][0].top).toBeCloseTo(300 - shown, 6);
    expect(follow.offset()).toBe(0);
  });

  it.each([
    ["reduced motion", { reducedMotion: true }],
    ["no Web Animations", { animate: false }],
  ])("jumps without a glide under %s", (_name, options) => {
    const { scroller, content, follow } = setup(options);
    follow.glideTo(300);
    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 300,
      behavior: "instant",
    });
    expect(content.animate).not.toHaveBeenCalled();
    expect(follow.offset()).toBe(0);
  });

  it("writes nothing for the same position and does not glide a sub-pixel step", () => {
    const { scroller, content, follow } = setup();
    scroller.setTop(200);
    follow.glideTo(200);
    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(content.animate).not.toHaveBeenCalled();
    follow.glideTo(200.5);
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);
    expect(content.animate).not.toHaveBeenCalled();
  });

  it("glides only as far as the clamped scroll position", () => {
    const scroller = fakeScroller(250);
    const content = fakeContent();
    const follow = createFlipFollowScroll({
      scroller: () => scroller.element,
      content: () => content.element,
      reducedMotion: () => false,
    });
    follow.glideTo(300);
    expect(follow.offset()).toBe(250);
  });

  it("never asks for an animation frame", () => {
    const frame = vi.spyOn(window, "requestAnimationFrame");
    const { content, follow } = setup();
    follow.glideTo(300);
    content.animations[0].currentTime = 120;
    follow.glideTo(500);
    follow.interrupt();
    expect(frame).not.toHaveBeenCalled();
  });
});

describe("useFlipFollowScroll", () => {
  it("drops the glide without a scroll write when its scope ends", () => {
    const scroller = fakeScroller();
    const content = fakeContent();
    const scope = effectScope();
    const follow = scope.run(() =>
      useFlipFollowScroll({
        scroller: () => scroller.element,
        content: () => content.element,
        reducedMotion: () => false,
      }),
    );
    follow?.glideTo(300);
    scroller.scrollTo.mockClear();
    scope.stop();
    expect(content.animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(follow?.offset()).toBe(0);
  });
});
