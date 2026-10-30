import type { PineApprovalMode } from "./agent";
import type { PineAttachment } from "./attachments";

export const GET_QUICK_COMPOSER_CHANNEL =
  "preferences:get-quick-composer" as const;
export const SET_QUICK_COMPOSER_CHANNEL =
  "preferences:set-quick-composer" as const;
export const HIDE_QUICK_COMPOSER_CHANNEL = "quick-composer:hide" as const;
export const SET_QUICK_COMPOSER_PASS_THROUGH_CHANNEL =
  "quick-composer:set-pass-through" as const;
export const SUBMIT_QUICK_COMPOSER_CHANNEL = "quick-composer:submit" as const;
export const QUICK_COMPOSER_SHOWN_CHANNEL = "quick-composer:shown" as const;
/** The panel resets for its next showing while nobody sees it. */
export const QUICK_COMPOSER_HIDDEN_CHANNEL = "quick-composer:hidden" as const;
export const SET_QUICK_COMPOSER_GLASS_CHANNEL =
  "quick-composer:set-glass" as const;
export const TAKE_QUICK_COMPOSER_HANDOFF_CHANNEL =
  "quick-composer:take-handoff" as const;
export const PRESENT_QUICK_COMPOSER_HANDOFF_CHANNEL =
  "quick-composer:present-handoff" as const;
/** Main sends what it captured from the app the user was in. */
export const QUICK_COMPOSER_CONTEXT_CHANNEL = "quick-composer:context" as const;
export const REQUEST_QUICK_COMPOSER_PERMISSION_CHANNEL =
  "quick-composer:request-permission" as const;
/** Main gives a message to the window that already holds its project. */
export const DELIVER_QUICK_COMPOSER_CHANNEL = "quick-composer:deliver" as const;

/** The global shortcut that summons the floating composer. */
export const QUICK_COMPOSER_ACCELERATOR = "CommandOrControl+;" as const;
/** Off until the user turns it on: a global shortcut reaches every app. */
export const DEFAULT_QUICK_COMPOSER_ENABLED = false;
/** Passed to a window that takes over a message from the floating composer. */
export const QUICK_COMPOSER_HANDOFF_ARGUMENT =
  "--pine-launch=quick-composer-handoff" as const;
export const QUICK_COMPOSER_ROUTE_HASH = "quick-composer" as const;
/** How far the glass card reaches past the composer's controls, in CSS px. */
/**
 * The floating composer and its glass fade in growing from this scale, on
 * the app's curve.
 */
export const QUICK_COMPOSER_ENTRANCE_SCALE = 0.96;
/**
 * After a send, the glass and card grow to the new window's size over this
 * long; only then does the window fade in over them.
 */
export const QUICK_COMPOSER_EXPAND_MS = 450;
export const QUICK_COMPOSER_GLASS_INSET = 8;
/** Concentric with the 24px pill input inside it. */
export const QUICK_COMPOSER_GLASS_RADIUS = 24 + QUICK_COMPOSER_GLASS_INSET;

export interface SetQuickComposerRequest {
  enabled: boolean;
}

/** `registered` is false when another app already holds the shortcut. */
export interface SetQuickComposerResult {
  enabled: boolean;
  registered: boolean;
}

/** A rectangle in CSS pixels, relative to the window's content. */
export interface QuickComposerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SubmitQuickComposerRequest {
  /** The serialized message, attachments included. */
  message: string;
  approvalMode: PineApprovalMode;
  projectId: string;
  /** Sends the context main captured for this showing along. */
  withContext: boolean;
  /** Where the composer is in the floating window. */
  composerRect: QuickComposerRect;
}

/** The message the new window sends, as the floating composer had it. */
export interface QuickComposerHandoff {
  message: string;
  approvalMode: PineApprovalMode;
  projectId: string;
  /**
   * Taken from the app the user was in. It shows apart from the message
   * until sent, and goes ahead of its attachments.
   */
  context: PineAttachment[];
}

/** Sent each time the floating composer appears. */
export interface QuickComposerShown {
  id: number;
}

/** What capturing the app's context needs and does not have. */
export type QuickComposerPermission = "accessibility" | "screen";

/**
 * Taken from the app the user was in when the composer appeared: a
 * screenshot of its window and the text selected in it, each knowing which
 * app and window it came from.
 */
export interface QuickComposerContext {
  /** Matches the `shown` it belongs to; a later one replaces it. */
  shownId: number;
  attachments: PineAttachment[];
  /** Left out because Pine may not see them; asking may let it. */
  missing: QuickComposerPermission[];
}

export interface PineQuickComposerApi {
  getQuickComposer: () => Promise<boolean>;
  setQuickComposer: (
    request: SetQuickComposerRequest,
  ) => Promise<SetQuickComposerResult>;
  hideQuickComposer: () => Promise<void>;
  /** Lets clicks on the floating window's empty area reach the app behind. */
  setQuickComposerPassThrough: (passThrough: boolean) => Promise<void>;
  /**
   * Places Liquid Glass under the composer's card; resolves false where the
   * system has none, so the page draws its own background.
   */
  setQuickComposerGlass: (rect: QuickComposerRect) => Promise<boolean>;
  /**
   * Opens the panel into a new window with the message. Resolves with that
   * window's corner radius, which the card rounds to as it grows, or null
   * when the window that holds the project takes the message instead.
   */
  submitQuickComposer: (
    request: SubmitQuickComposerRequest,
  ) => Promise<number | null | undefined>;
  /** Fires once the app the user was in has been captured. */
  onQuickComposerContext: (
    listener: (context: QuickComposerContext) => void,
  ) => () => void;
  /** Asks the system for a permission the context needs. */
  requestQuickComposerPermission: (
    permission: QuickComposerPermission,
  ) => Promise<void>;
  /** Fires as the panel hides; its context is gone by then. */
  onQuickComposerHidden: (listener: () => void) => () => void;
  onQuickComposerShown: (
    listener: (shown: QuickComposerShown) => void,
  ) => () => void;
  /** True in a window opened to continue a floating composer's message. */
  isQuickComposerHandoff: boolean;
  /** Resolves once a message is sent to this window; null in other windows. */
  takeQuickComposerHandoff: () => Promise<QuickComposerHandoff | null>;
  /**
   * Moves this window so its composer covers the floating one, shows it and
   * hides the floating composer.
   */
  presentQuickComposerHandoff: (
    composerRect: QuickComposerRect,
  ) => Promise<void>;
  /**
   * Fires with a floating composer message for a project this window holds;
   * it opens in a new draft here.
   */
  onQuickComposerDelivered: (
    listener: (handoff: QuickComposerHandoff) => void,
  ) => () => void;
}
