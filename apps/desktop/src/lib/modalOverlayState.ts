/** Set on the left sidebar while a dialog, sheet or alert dialog overlay is mounted. */
export const BEHIND_MODAL_ATTRIBUTE = "data-behind-modal";

const OVERLAY_SELECTOR = [
  "dialog-overlay",
  "sheet-overlay",
  "alert-dialog-overlay",
]
  .map((slot) => `:scope > [data-slot="${slot}"]`)
  .join(", ");

const SIDEBAR_SELECTOR = '[data-slot="sidebar-container"][data-side="left"]';

/**
 * Marks the left sidebar while a modal overlay is mounted, so CSS can turn
 * it opaque behind the overlay (see `index.css`). A `:has()` on the root did
 * this before, but it made Chromium restyle the whole window on every DOM
 * insertion anywhere, which stalled dialogs and streamed replies in long
 * sessions. The mark goes on the sidebar itself rather than on `<html>`:
 * a root attribute keyed to `[data-slot]` descendants would still restyle
 * most of the window each time it flips.
 *
 * Overlays are teleported straight into `<body>` and stay mounted through
 * their close animation, so watching body's children keeps the timing the
 * selector had.
 */
export function trackModalOverlays(doc: Document = document): () => void {
  let open = false;
  const mark = (value: boolean): void => {
    for (const sidebar of doc.querySelectorAll(SIDEBAR_SELECTOR))
      sidebar.toggleAttribute(BEHIND_MODAL_ATTRIBUTE, value);
  };
  const update = (): void => {
    const next = doc.body.querySelector(OVERLAY_SELECTOR) !== null;
    if (next === open) return;
    open = next;
    mark(open);
  };
  const observer = new MutationObserver(update);
  observer.observe(doc.body, { childList: true });
  update();
  return () => {
    observer.disconnect();
    mark(false);
  };
}
