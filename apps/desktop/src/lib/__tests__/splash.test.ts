import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissSplash,
  holdSplash,
  holdSplashWhile,
  resetSplashForTesting,
} from "../splash";

function splash(): HTMLElement | null {
  return document.getElementById("pine-splash");
}

async function settle(): Promise<void> {
  // Fonts, then two frames.
  await vi.advanceTimersByTimeAsync(100);
}

describe("splash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 16),
    );
    resetSplashForTesting();
    document.body.innerHTML = '<div id="pine-splash"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fades out once every hold is released", async () => {
    const releaseBoot = holdSplash();
    const releaseView = holdSplash();
    releaseBoot();
    await settle();
    expect(splash()?.dataset.state).toBeUndefined();

    releaseView();
    await settle();
    expect(splash()?.dataset.state).toBe("leaving");
    await vi.advanceTimersByTimeAsync(320);
    expect(splash()).toBeNull();
  });

  it("stays when a new hold arrives before it settles", async () => {
    const release = holdSplash();
    release();
    const late = holdSplash();
    await settle();
    expect(splash()?.dataset.state).toBeUndefined();
    late();
    await settle();
    expect(splash()?.dataset.state).toBe("leaving");
  });

  it("counts each release once", async () => {
    const first = holdSplash();
    holdSplash();
    first();
    first();
    await settle();
    expect(splash()?.dataset.state).toBeUndefined();
  });

  it("releases a task's hold however the task ends", async () => {
    await expect(
      holdSplashWhile(Promise.reject(new Error("offline"))),
    ).rejects.toThrow("offline");
    await settle();
    expect(splash()?.dataset.state).toBe("leaving");
  });

  it("gives up on startup that never finishes", async () => {
    holdSplash();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(splash()?.dataset.state).toBe("leaving");
  });

  it("goes at once when dismissed, and ignores later holds", async () => {
    holdSplash();
    dismissSplash();
    expect(splash()).toBeNull();

    document.body.innerHTML = '<div id="pine-splash"></div>';
    holdSplash()();
    await settle();
    expect(splash()?.dataset.state).toBeUndefined();
  });
});

describe("index.html splash", () => {
  const html = readFileSync(
    path.resolve(__dirname, "../../../index.html"),
    "utf8",
  );

  it("draws the logo the build fills in", () => {
    expect(html).toContain('id="pine-splash"');
    expect(html).toContain('viewBox="__PINE_LOGO_VIEW_BOX__"');
    expect(html).toContain('d="__PINE_LOGO_PATH__"');
  });

  it("fades for as long as the script waits", () => {
    expect(html).toMatch(/#pine-splash\s*{[^}]*transition: opacity 320ms/);
  });
});
