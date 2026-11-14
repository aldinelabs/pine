/**
 * The startup splash in index.html covers the window until everything that
 * starts with it is ready. Each part of startup holds it and releases it when
 * done; once nothing holds it, and fonts and two frames have settled, it
 * fades out and leaves the page.
 */

const SPLASH_ID = "pine-splash";
/** Matches the splash's opacity transition in index.html. */
const FADE_MS = 320;
/** Startup that takes longer than this shows the app as it is. */
const GIVE_UP_MS = 10_000;

let holds = 0;
let finished = false;
let giveUp: ReturnType<typeof setTimeout> | undefined;

function splashElement(): HTMLElement | null {
  return document.getElementById(SPLASH_ID);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function finish(fade: boolean): void {
  if (finished) return;
  finished = true;
  clearTimeout(giveUp);
  const splash = splashElement();
  if (!splash) return;
  const reducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (!fade || reducedMotion) {
    splash.remove();
    return;
  }
  splash.dataset.state = "leaving";
  setTimeout(() => splash.remove(), FADE_MS);
}

async function settle(): Promise<void> {
  // Text should not reflow under the fading splash.
  await document.fonts?.ready.catch(() => undefined);
  await nextFrame();
  await nextFrame();
  if (holds === 0) finish(true);
}

/**
 * Keeps the splash up until the returned function is called. Each release
 * counts once.
 */
export function holdSplash(): () => void {
  if (finished) return () => undefined;
  holds += 1;
  giveUp ??= setTimeout(() => finish(true), GIVE_UP_MS);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) void settle();
  };
}

/** Keeps the splash up while the task runs, however it ends. */
export async function holdSplashWhile<T>(task: Promise<T>): Promise<T> {
  const release = holdSplash();
  try {
    return await task;
  } finally {
    release();
  }
}

/** Removes the splash now, for windows and views that show without it. */
export function dismissSplash(options: { fade?: boolean } = {}): void {
  finish(options.fade ?? false);
}

/** Test seam: forgets earlier holds and dismissals. */
export function resetSplashForTesting(): void {
  holds = 0;
  finished = false;
  clearTimeout(giveUp);
  giveUp = undefined;
}
