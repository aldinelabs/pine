/**
 * Live Context translation between Pine's main process, which batches final
 * segments, and the agent process, which calls the live translation model.
 * See docs/live-context.md.
 */

export interface LiveTranslationRequest {
  /** The language to translate into (BCP 47, e.g. "fr-FR"). */
  language: string;
  /** The language the speech was transcribed in, when known. */
  sourceLanguage?: string;
  /**
   * The segments just before, already translated, oldest first: for names
   * and terms to stay the same. They are not translated again.
   */
  context: { text: string; translation: string }[];
  /** The segments to translate, in order. */
  segments: string[];
}

export type LiveTranslationResult =
  /** One per segment, in order; "" when the model left one out. */
  | { translations: string[] }
  /** No live translation (or title) model is set up. */
  | { error: "no_model" };

/** The most segments and characters one request sends. */
export const LIVE_TRANSLATION_LIMITS = {
  segments: 40,
  segmentLength: 4_000,
  contextSegments: 4,
} as const;
