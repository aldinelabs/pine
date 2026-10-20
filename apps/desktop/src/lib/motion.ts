/**
 * The app's curves, `--ease-in-out-expo` and `--ease-out-expo` from
 * `index.css`, for Web Animations. Its `@theme inline` block inlines them
 * into utilities rather than declaring them on `:root`, so script cannot read
 * them back.
 */
export const EASE_IN_OUT_EXPO = "cubic-bezier(0.87, 0, 0.13, 1)";
export const EASE_OUT_EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";

/** The app-wide transition length; see `duration-500` throughout the UI. */
export const DURATION_MS = 500;
