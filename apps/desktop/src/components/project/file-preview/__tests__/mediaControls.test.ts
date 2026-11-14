import { afterEach, describe, expect, it } from "vitest";
import {
  mediaShortcut,
  normalizeSpan,
  spanPercent,
  spanRect,
  timeAtPosition,
} from "../mediaControls";

describe("timeline math", () => {
  it("maps a pointer position to a time within the recording", () => {
    const rect = { left: 100, width: 200 };
    expect(timeAtPosition(200, rect, 60)).toBe(30);
    expect(timeAtPosition(50, rect, 60)).toBe(0);
    expect(timeAtPosition(400, rect, 60)).toBe(60);
    expect(timeAtPosition(200, { left: 0, width: 0 }, 60)).toBe(0);
  });

  it("orders and rounds marked times", () => {
    expect(normalizeSpan(12.34, 3.06)).toEqual({ start: 3.1, end: 12.3 });
    expect(normalizeSpan(5, 5)).toEqual({ start: 5, end: 5 });
  });

  it("places spans as percentages, clamped to the recording", () => {
    expect(spanPercent({ start: 15, end: 30 }, 60)).toEqual({
      left: 25,
      width: 25,
    });
    expect(spanPercent({ start: 50, end: 90 }, 60)).toEqual({
      left: (50 / 60) * 100,
      width: (10 / 60) * 100,
    });
    expect(spanPercent({ start: 1, end: 2 }, 0)).toEqual({ left: 0, width: 0 });
  });

  it("gives a span's box, at least a pixel wide", () => {
    const rect = { left: 10, top: 20, width: 400, height: 8 };
    const box = spanRect(rect, { start: 25, end: 50 }, 100);
    expect([box.x, box.y, box.width, box.height]).toEqual([110, 20, 100, 8]);
    expect(spanRect(rect, { start: 25, end: 25 }, 100).width).toBe(1);
  });
});

describe("mediaShortcut", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function press(
    target: Element,
    key: string,
    init: KeyboardEventInit = {},
  ): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  function player(): HTMLElement {
    document.body.innerHTML = `
      <div id="scope"><button id="play">Play</button>
        <div role="slider" id="slider" tabindex="0"></div></div>
      <input id="field" /><button id="outside">Other</button>`;
    return document.getElementById("scope")!;
  }

  it("maps keys with nothing focused", () => {
    const scope = player();
    expect(mediaShortcut(press(document.body, " "), scope)).toBe("toggle");
    expect(mediaShortcut(press(document.body, "K"), scope)).toBe("toggle");
    expect(mediaShortcut(press(document.body, "ArrowLeft"), scope)).toBe(
      "back",
    );
    expect(mediaShortcut(press(document.body, "l"), scope)).toBe("forwardLong");
    expect(mediaShortcut(press(document.body, "m"), scope)).toBe("mute");
    expect(mediaShortcut(press(document.body, "f"), scope)).toBe("fullscreen");
    expect(mediaShortcut(press(document.body, "i"), scope)).toBe("markIn");
    expect(mediaShortcut(press(document.body, "x"), scope)).toBeUndefined();
  });

  it("works in the player but not elsewhere or while typing", () => {
    const scope = player();
    const play = document.getElementById("play")!;
    expect(mediaShortcut(press(scope, "j"), scope)).toBe("backLong");
    expect(mediaShortcut(press(play, "ArrowRight"), scope)).toBe("forward");
    expect(
      mediaShortcut(press(document.getElementById("field")!, "k"), scope),
    ).toBeUndefined();
    expect(
      mediaShortcut(press(document.getElementById("outside")!, "k"), scope),
    ).toBeUndefined();
  });

  it("leaves keys controls use themselves, and modified keys", () => {
    const scope = player();
    const play = document.getElementById("play")!;
    const slider = document.getElementById("slider")!;
    expect(mediaShortcut(press(play, " "), scope)).toBeUndefined();
    expect(mediaShortcut(press(slider, "ArrowLeft"), scope)).toBeUndefined();
    expect(mediaShortcut(press(slider, "m"), scope)).toBe("mute");
    expect(
      mediaShortcut(press(document.body, "k", { metaKey: true }), scope),
    ).toBeUndefined();
  });
});
