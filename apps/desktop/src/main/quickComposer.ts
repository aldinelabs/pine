import {
  screen,
  systemPreferences,
  type BrowserWindow,
  type Rectangle,
  type WebContents,
} from "electron";
import { easeOutExpo } from "../lib/animateScroll";
import { DURATION_MS } from "../lib/motion";
import type { PineAttachment } from "../shared/attachments";
import { PROJECT_LIST_WINDOW_SIZE } from "../shared/window";
import {
  QUICK_COMPOSER_ENTRANCE_SCALE,
  QUICK_COMPOSER_EXPAND_MS,
  QUICK_COMPOSER_GLASS_RADIUS,
  QUICK_COMPOSER_CONTEXT_CHANNEL,
  QUICK_COMPOSER_HIDDEN_CHANNEL,
  QUICK_COMPOSER_SHOWN_CHANNEL,
  type QuickComposerContext,
  type QuickComposerHandoff,
  type QuickComposerShown,
  type QuickComposerRect,
  type SubmitQuickComposerRequest,
} from "../shared/quickComposer";
import { PROJECT_WINDOW_WIDTH, SIDEBAR_WIDTH } from "./windowExpansion";

const DEFAULT_WINDOW_RADIUS = 16;
/** A project window with both sidebars collapsed. */
export const COLLAPSED_WINDOW_WIDTH = PROJECT_WINDOW_WIDTH - SIDEBAR_WIDTH;
/** Shown anyway if the new window never reports where its composer is. */
const HANDOFF_PRESENT_TIMEOUT_MS = 3000;
/** How far above the bottom of the screen the area the composer sits in ends. */
export const QUICK_COMPOSER_BOTTOM_GAP = 48;
const ENTRANCE_FRAME_MS = 16;
/** The window fades in over this long once the glass fills its place. */
const HANDOFF_FADE_MS = 300;
/** Then the panel and its glass fade out over the window. */
const HANDOFF_FADE_OUT_MS = 250;
/** How far inside the window the grown glass stays. */
const HANDOFF_GLASS_INSET = 1;
/** A window's corner radius when the system does not say. */

/**
 * The floating composer covers the area the new window will take, centred
 * near the bottom of the work area, so its composer already sits where the
 * window's will.
 */
export function quickComposerBounds(workArea: Rectangle): Rectangle {
  const width = Math.min(COLLAPSED_WINDOW_WIDTH, workArea.width);
  const height = Math.min(PROJECT_LIST_WINDOW_SIZE.height, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.max(
      workArea.y,
      workArea.y + workArea.height - height - QUICK_COMPOSER_BOTTOM_GAP,
    ),
    width,
    height,
  };
}

/**
 * Moves a window so the composer at `windowRect` in its content lands on the
 * screen rectangle `screenRect`, keeping the window's size.
 */
export function alignedWindowBounds(
  window: Rectangle,
  content: Rectangle,
  windowRect: QuickComposerRect,
  screenRect: QuickComposerRect,
): Rectangle {
  const dx = screenRect.x - (content.x + windowRect.x);
  const dy = screenRect.y - (content.y + windowRect.y);
  return {
    ...window,
    x: Math.round(window.x + dx),
    y: Math.round(window.y + dy),
  };
}

/**
 * Plays `onFrame` with eased progress from 0 to 1 over `duration`, then
 * `onDone`. Returns a function that stops it early.
 */
function tween(
  duration: number,
  onFrame: (progress: number) => void,
  onDone?: () => void,
): () => void {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const step = () => {
    const time = duration > 0 ? (Date.now() - startedAt) / duration : 1;
    onFrame(easeOutExpo(Math.min(1, time)));
    if (time < 1) return;
    stop();
    onDone?.();
  };
  timer = setInterval(step, ENTRANCE_FRAME_MS);
  return stop;
}

function prefersReducedMotion(): boolean {
  return systemPreferences.getAnimationSettings().prefersReducedMotion;
}

interface HandoffWindow {
  window: BrowserWindow;
  handoff: QuickComposerHandoff | null;
  /** The renderer is waiting for a message to continue. */
  waiting: ((handoff: QuickComposerHandoff) => void) | null;
  /** The floating composer on screen, in screen coordinates. */
  composerRect: QuickComposerRect | null;
  timeout: ReturnType<typeof setTimeout> | null;
}

export interface QuickComposerWindows {
  /** A frameless, transparent window that loads the quick composer route. */
  createPanel: (bounds: Rectangle) => BrowserWindow;
  /** A hidden project window that waits to continue a panel message. */
  createHandoffWindow: (bounds: Rectangle) => BrowserWindow;
  /**
   * A click-through window of Liquid Glass shown under the composer, or null
   * where the system has none.
   */
  createGlass?: () => BrowserWindow | null;
  /** Rounds the glass to `radius` points. */
  setGlassRadius?: (glass: BrowserWindow, radius: number) => void;
  /** How round the system draws a window's corners, if it says. */
  windowCornerRadius?: (window: BrowserWindow) => number | undefined;
  /**
   * The window that already holds a project, which a message for it goes
   * to instead of a new window; null when none does.
   */
  ownerWindow?: (projectId: string) => BrowserWindow | null;
  /** Gives a message to a window that holds its project. */
  deliver?: (window: BrowserWindow, handoff: QuickComposerHandoff) => void;
  /**
   * Readies a window to take over from the panel, or makes it ordinary
   * again: it shows without the system's opening animation.
   */
  setPresenting?: (window: BrowserWindow, presenting: boolean) => void;
  /**
   * Notes the app in front, before the panel takes focus; null when there is
   * none to capture, such as Pine itself. What it returns captures what that
   * app shows, which takes the main thread a while, so it runs once the
   * panel has appeared.
   */
  captureContext?: () =>
    (() => Promise<Omit<QuickComposerContext, "shownId">>) | null;
  /** Deletes the files of context that was not sent. */
  discardContext?: (attachments: readonly PineAttachment[]) => void;
}

/**
 * The floating composer summoned by the global shortcut, and the windows that
 * take over its messages. The panel is kept and reused so it appears at once,
 * and a hidden window is prepared while it shows, so sending does not wait
 * for a new window to load.
 */
export class QuickComposerController {
  private panel: BrowserWindow | null = null;
  /** Hidden until they present; then they are ordinary project windows. */
  private readonly handoffs = new Map<number, HandoffWindow>();
  /** The prepared window the next message goes to. */
  private prepared: HandoffWindow | null = null;
  /** Counts showings, so a capture from an earlier one is dropped. */
  private shownId = 0;
  /** What was captured for this showing, kept for a panel not shown yet. */
  private context: QuickComposerContext | null = null;
  /** Captures this showing's context once the panel has appeared. */
  private pendingCapture:
    (() => Promise<Omit<QuickComposerContext, "shownId">>) | null = null;
  /** Native dialogs of the panel take focus without dismissing it. */
  private modalCount = 0;
  /** The panel has painted once; until then showing it would flash. */
  private isPanelReady = false;
  /** Summoned while still loading; it shows once it has painted. */
  private showWhenReady = false;
  /** Liquid Glass under the composer; undefined until first asked for. */
  private glass: BrowserWindow | null | undefined;
  /** Where the glass goes, in the panel's content. */
  private glassRect: QuickComposerRect | null = null;
  /** Stops the entrance or handoff animations under way. */
  private readonly stops = new Set<() => void>();
  /** The glass's scale while it grows in; 1 once settled. */
  private glassScale = 1;
  /**
   * How far the glass has grown from the card to the whole panel while a
   * sent message's window takes over, from 0 to 1.
   */
  private glassExpansion = 0;
  /**
   * A sent message's window is taking over: the glass grows to it while it
   * fades in, and the panel stays until both have finished.
   */
  private handoff: {
    /** The glass has grown to the window's size. */
    expanded: boolean;
    /** The window, once it is ready to show. */
    window: BrowserWindow | null;
    /** The window's corner radius, which the glass rounds towards. */
    radius: number;
    /** Where the window shows, on screen, once it is placed. */
    bounds: Rectangle | null;
  } | null = null;
  /** A message went to the window that holds its project. */
  private isDelivering = false;
  /** The size the glass's shadow was last shaped for. */
  private shadowSize: { width: number; height: number } | null = null;

  constructor(private readonly windows: QuickComposerWindows) {}

  isPanel(contents: WebContents): boolean {
    return this.panel !== null && this.panel.webContents === contents;
  }

  /** The panel and prepared windows, which never count as open windows. */
  isAuxiliary(window: BrowserWindow): boolean {
    return (
      window === this.panel ||
      window === this.glass ||
      this.prepared?.window === window
    );
  }

  /** Loads the panel ahead of time, so the first shortcut shows it at once. */
  warmUp(): void {
    this.ensurePanel(quickComposerBounds(screen.getPrimaryDisplay().workArea));
  }

  toggle(): void {
    if (this.panel?.isVisible() || this.showWhenReady) this.hide();
    else this.show();
  }

  show(): void {
    this.discardContext();
    this.shownId += 1;
    // Before the panel takes focus, while the user's app is still in front.
    this.pendingCapture = this.windows.captureContext?.() ?? null;
    const { workArea } = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const bounds = quickComposerBounds(workArea);
    const panel = this.ensurePanel(bounds);
    panel.setBounds(bounds);
    panel.setIgnoreMouseEvents(true, { forward: true });
    this.placeGlass();
    this.prepare(bounds);
    if (this.isPanelReady) this.reveal(panel);
    else this.showWhenReady = true;
  }

  hide(): void {
    this.discardContext();
    this.stopAnimations();
    this.handoff = null;
    this.isDelivering = false;
    this.showWhenReady = false;
    if (this.panel && !this.panel.isDestroyed()) {
      this.panel.hide();
      this.panel.webContents.send(QUICK_COMPOSER_HIDDEN_CHANNEL);
    }
    if (this.glass && !this.glass.isDestroyed()) {
      this.glass.hide();
      // It last took the shape of the window a message opened into.
      this.windows.setGlassRadius?.(this.glass, QUICK_COMPOSER_GLASS_RADIUS);
    }
  }

  /**
   * Moves the glass under the composer as it changes size. Returns false
   * where there is no glass, so the page draws its own background.
   */
  setGlass(rect: QuickComposerRect): boolean {
    const glass = this.ensureGlass();
    if (!glass) return false;
    this.glassRect = rect;
    this.placeGlass();
    const panel = this.panel;
    if (panel?.isVisible() && !glass.isVisible()) {
      // Joins a fade already under way.
      glass.setOpacity(panel.getOpacity());
      glass.showInactive();
      // The glass stays under the composer it backs.
      panel.moveTop();
    }
    return true;
  }

  setPassThrough(passThrough: boolean): void {
    if (this.panel && !this.panel.isDestroyed())
      this.panel.setIgnoreMouseEvents(passThrough, { forward: true });
  }

  /** Keeps the panel open while one of its native dialogs has focus. */
  async whileModal<T>(contents: WebContents, task: Promise<T>): Promise<T> {
    if (!this.isPanel(contents)) return task;
    this.modalCount += 1;
    try {
      return await task;
    } finally {
      this.modalCount -= 1;
      if (this.panel?.isVisible()) this.panel.focus();
    }
  }

  /**
   * Sends the message to the prepared window and opens the panel into it.
   * Returns that window's corner radius, which the page's card rounds to.
   */
  submit(request: SubmitQuickComposerRequest): number | null | undefined {
    const panel = this.panel;
    if (!panel || panel.isDestroyed()) return undefined;
    const handoff: QuickComposerHandoff = {
      message: request.message,
      approvalMode: request.approvalMode,
      projectId: request.projectId,
      // Only what main captured for this showing, never paths from the page.
      context:
        request.withContext && this.context?.shownId === this.shownId
          ? this.context.attachments
          : [],
    };
    // Sent context belongs to the session now; unsent goes when it hides.
    if (handoff.context.length > 0) this.context = null;
    // A project lives in one window; its message goes there.
    const owner = this.windows.ownerWindow?.(request.projectId);
    if (owner && this.windows.deliver) {
      this.deliverTo(owner, handoff, this.windows.deliver);
      return null;
    }
    const content = panel.getContentBounds();
    const target = this.prepare(panel.getBounds());
    this.prepared = null;
    target.composerRect = {
      ...request.composerRect,
      x: content.x + request.composerRect.x,
      y: content.y + request.composerRect.y,
    };
    const id = target.window.webContents.id;
    const radius = this.expandGlass(target.window);
    // A window that fails to load still shows rather than vanishing.
    target.timeout = setTimeout(
      () => this.present(id),
      HANDOFF_PRESENT_TIMEOUT_MS,
    );
    if (target.waiting) {
      target.waiting(handoff);
      target.waiting = null;
    } else {
      target.handoff = handoff;
    }
    return radius;
  }

  /** Resolves with the message once one is sent to this window. */
  takeHandoff(contents: WebContents): Promise<QuickComposerHandoff | null> {
    const target = this.handoffs.get(contents.id);
    if (!target) return Promise.resolve(null);
    const { handoff } = target;
    if (handoff) {
      target.handoff = null;
      return Promise.resolve(handoff);
    }
    return new Promise((resolve) => {
      target.waiting = resolve;
    });
  }

  /** Shows a handoff window with its composer over the floating one. */
  present(webContentsId: number, windowRect?: QuickComposerRect): void {
    const target = this.handoffs.get(webContentsId);
    if (!target?.composerRect) return;
    this.handoffs.delete(webContentsId);
    if (target.timeout) clearTimeout(target.timeout);
    const { window } = target;
    if (window.isDestroyed()) return;
    if (windowRect) {
      window.setBounds(
        alignedWindowBounds(
          window.getBounds(),
          window.getContentBounds(),
          windowRect,
          target.composerRect,
        ),
      );
    }
    this.windows.setPresenting?.(window, true);
    if (this.handoff) {
      this.handoff.window = window;
      // The glass grows to exactly where the window shows.
      this.handoff.bounds = window.getBounds();
      this.revealHandoffWindow();
    } else {
      this.fadeInWindow(window);
    }
  }

  dispose(): void {
    for (const target of this.handoffs.values()) {
      if (target.timeout) clearTimeout(target.timeout);
      // Only windows that never showed belong to the quick composer.
      if (!target.window.isDestroyed() && !target.window.isVisible())
        target.window.destroy();
    }
    this.handoffs.clear();
    this.prepared = null;
    this.stopAnimations();
    if (this.panel && !this.panel.isDestroyed()) this.panel.destroy();
    this.panel = null;
    this.isPanelReady = false;
    this.showWhenReady = false;
    if (this.glass && !this.glass.isDestroyed()) this.glass.destroy();
    this.glass = undefined;
    this.glassRect = null;
    this.shadowSize = null;
  }

  private ensureGlass(): BrowserWindow | null {
    if (this.glass === undefined || this.glass?.isDestroyed())
      this.glass = this.windows.createGlass?.() ?? null;
    return this.glass;
  }

  private placeGlass(): void {
    const { glass, glassRect, panel, glassScale, glassExpansion } = this;
    if (!glass || !glassRect || !panel || glass.isDestroyed()) return;
    const content = panel.getContentBounds();
    // Scaled about its centre, where the page scales the card.
    const width = glassRect.width * glassScale;
    const height = glassRect.height * glassScale;
    const card = {
      x: glassRect.x + (glassRect.width - width) / 2,
      y: glassRect.y + (glassRect.height - height) / 2,
      width,
      height,
    };
    // Grows towards the window that takes over: the whole panel until it
    // is placed, then just inside it, so no edge shows past the window.
    const placed = this.handoff?.bounds;
    const target = placed
      ? {
          x: placed.x - content.x + HANDOFF_GLASS_INSET,
          y: placed.y - content.y + HANDOFF_GLASS_INSET,
          width: placed.width - 2 * HANDOFF_GLASS_INSET,
          height: placed.height - 2 * HANDOFF_GLASS_INSET,
        }
      : { x: 0, y: 0, width: content.width, height: content.height };
    const grow = (from: number, to: number) =>
      from + (to - from) * glassExpansion;
    const bounds = {
      x: Math.round(content.x + grow(card.x, target.x)),
      y: Math.round(content.y + grow(card.y, target.y)),
      width: Math.max(1, Math.round(grow(card.width, target.width))),
      height: Math.max(1, Math.round(grow(card.height, target.height))),
    };
    glass.setBounds(bounds);
    if (this.handoff)
      this.windows.setGlassRadius?.(
        glass,
        grow(
          QUICK_COMPOSER_GLASS_RADIUS,
          Math.max(0, this.handoff.radius - HANDOFF_GLASS_INSET),
        ),
      );
    // A transparent window keeps the shadow of its old shape until it is
    // switched off and on again; while it grows in, only once it settles.
    // While it opens into a window it has none: the window brings its own.
    const shaped = this.shadowSize;
    if (
      glassScale === 1 &&
      glassExpansion === 0 &&
      (shaped?.width !== bounds.width || shaped.height !== bounds.height)
    ) {
      glass.setHasShadow(false);
      glass.setHasShadow(true);
      this.shadowSize = { width: bounds.width, height: bounds.height };
    }
  }

  private sendContext(): void {
    const panel = this.panel;
    if (!this.context || !panel || panel.isDestroyed() || !panel.isVisible())
      return;
    panel.webContents.send(QUICK_COMPOSER_CONTEXT_CHANNEL, this.context);
  }

  private prepare(bounds: Rectangle): HandoffWindow {
    const current = this.prepared;
    if (current && !current.window.isDestroyed()) {
      current.window.setBounds(bounds);
      return current;
    }
    const window = this.windows.createHandoffWindow(bounds);
    const id = window.webContents.id;
    const target: HandoffWindow = {
      window,
      handoff: null,
      waiting: null,
      composerRect: null,
      timeout: null,
    };
    this.handoffs.set(id, target);
    window.once("closed", () => {
      if (target.timeout) clearTimeout(target.timeout);
      this.handoffs.delete(id);
      if (this.prepared === target) this.prepared = null;
    });
    this.prepared = target;
    return target;
  }

  private reveal(panel: BrowserWindow): void {
    const glass =
      this.glass && this.glassRect && !this.glass.isDestroyed()
        ? this.glass
        : null;
    glass?.setOpacity(0);
    panel.setOpacity(0);
    this.glassExpansion = 0;
    // The page skips its entrance then, so the glass must not grow alone.
    const grows = !prefersReducedMotion();
    this.glassScale = grows ? QUICK_COMPOSER_ENTRANCE_SCALE : 1;
    this.placeGlass();
    // Shown first, so the panel orders in above it.
    glass?.showInactive();
    panel.show();
    panel.focus();
    // The page blurs into focus and grows while the windows fade in.
    const shown: QuickComposerShown = { id: this.shownId };
    panel.webContents.send(QUICK_COMPOSER_SHOWN_CHANNEL, shown);
    this.sendContext();
    this.playEntrance(panel, grows);
  }

  private playEntrance(panel: BrowserWindow, grows: boolean): void {
    this.stopTweens();
    const stop = tween(
      DURATION_MS,
      (progress) => {
        // The glass may first show partway through, once the page measures
        // it.
        for (const window of [panel, this.glass])
          if (window && !window.isDestroyed()) window.setOpacity(progress);
        this.glassScale = grows
          ? QUICK_COMPOSER_ENTRANCE_SCALE +
            (1 - QUICK_COMPOSER_ENTRANCE_SCALE) * progress
          : 1;
        this.placeGlass();
      },
      () => {
        this.stops.delete(stop);
        this.capture();
      },
    );
    this.stops.add(stop);
  }

  /**
   * Captures the app's context now the panel has appeared, so the work does
   * not hold up its entrance. What arrives once the panel is closing or
   * sending is never seen, so it is deleted.
   */
  private capture(): void {
    const capture = this.pendingCapture;
    this.pendingCapture = null;
    if (!capture) return;
    const shownId = this.shownId;
    void capture()
      .then((captured) => {
        const panel = this.panel;
        if (
          shownId !== this.shownId ||
          this.handoff ||
          this.isDelivering ||
          !panel?.isVisible()
        ) {
          this.windows.discardContext?.(captured.attachments);
          return;
        }
        this.context = { shownId, ...captured };
        this.sendContext();
      })
      .catch(() => undefined);
  }

  /** Drops this showing's context, deleting its files unless it was sent. */
  private discardContext(): void {
    this.pendingCapture = null;
    const context = this.context;
    this.context = null;
    if (context?.attachments.length)
      this.windows.discardContext?.(context.attachments);
  }

  /**
   * Grows the glass to the window's size and roundness while that window
   * fades in. Returns the window's corner radius.
   */
  private expandGlass(window: BrowserWindow): number {
    this.stopAnimations();
    const radius =
      this.windows.windowCornerRadius?.(window) ?? DEFAULT_WINDOW_RADIUS;
    this.handoff = { expanded: false, window: null, radius, bounds: null };
    const glass = this.glass;
    if (glass && !glass.isDestroyed()) {
      glass.setHasShadow(false);
      this.shadowSize = null;
    }
    const stop = tween(
      prefersReducedMotion() ? 0 : QUICK_COMPOSER_EXPAND_MS,
      (progress) => {
        this.glassExpansion = progress;
        this.placeGlass();
      },
      () => {
        this.stops.delete(stop);
        if (this.handoff) this.handoff.expanded = true;
        this.revealHandoffWindow();
      },
    );
    this.stops.add(stop);
    return radius;
  }

  /**
   * Shows the window once the glass fills its place and it is ready, so it
   * appears where the glass already is.
   */
  private revealHandoffWindow(): void {
    const window = this.handoff?.expanded ? this.handoff.window : null;
    if (!window) return;
    this.handoff = { ...this.handoff!, window: null };
    this.fadeInWindow(window);
  }

  /**
   * Fades the window in under the panel and glass, which float above all
   * windows, then fades them out over it, so nothing switches at once.
   */
  private fadeInWindow(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    window.setOpacity(0);
    window.show();
    window.focus();
    const fadeIn = tween(
      HANDOFF_FADE_MS,
      (progress) => {
        if (!window.isDestroyed()) window.setOpacity(progress);
      },
      () => {
        this.stops.delete(fadeIn);
        const fadeOut = tween(
          HANDOFF_FADE_OUT_MS,
          (progress) => {
            for (const floating of [this.panel, this.glass])
              if (floating && !floating.isDestroyed())
                floating.setOpacity(1 - progress);
          },
          () => {
            this.stops.delete(fadeOut);
            // An ordinary window from now on.
            this.windows.setPresenting?.(window, false);
            this.hide();
          },
        );
        this.stops.add(fadeOut);
      },
    );
    this.stops.add(fadeIn);
  }

  /** Brings the window forward with the message, then fades the panel out. */
  private deliverTo(
    window: BrowserWindow,
    handoff: QuickComposerHandoff,
    deliver: (window: BrowserWindow, handoff: QuickComposerHandoff) => void,
  ): void {
    this.stopAnimations();
    this.isDelivering = true;
    deliver(window, handoff);
    const stop = tween(
      HANDOFF_FADE_OUT_MS,
      (progress) => {
        for (const floating of [this.panel, this.glass])
          if (floating && !floating.isDestroyed())
            floating.setOpacity(1 - progress);
      },
      () => {
        this.stops.delete(stop);
        this.hide();
      },
    );
    this.stops.add(stop);
  }

  private stopTweens(): void {
    for (const stop of this.stops) stop();
    this.stops.clear();
  }

  /** Stops any animation and settles the glass where it rests. */
  private stopAnimations(): void {
    this.stopTweens();
    this.glassScale = 1;
    this.glassExpansion = 0;
  }

  private ensurePanel(bounds: Rectangle): BrowserWindow {
    if (this.panel && !this.panel.isDestroyed()) return this.panel;
    const panel = this.windows.createPanel(bounds);
    this.isPanelReady = false;
    panel.once("ready-to-show", () => {
      this.isPanelReady = true;
      if (!this.showWhenReady) return;
      this.showWhenReady = false;
      this.reveal(panel);
    });
    panel.on("blur", () => {
      // The window a message went to takes focus while the panel opens into
      // it.
      if (this.modalCount === 0 && !this.handoff && !this.isDelivering)
        this.hide();
    });
    panel.on("closed", () => {
      if (this.panel !== panel) return;
      this.panel = null;
      this.isPanelReady = false;
      this.showWhenReady = false;
    });
    this.panel = panel;
    return panel;
  }
}
