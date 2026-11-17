/**
 * `@open-auto-focus` for a dialog whose first tabbable element is a tab or a
 * scrolling list rather than a field. Opened from a menu, Chromium treats
 * that automatic focus as keyboard focus and rings the element, which looks
 * like a selection. Focusing the dialog itself (tabindex -1, no ring) keeps
 * the focus trap, so Tab still moves into the dialog and real keyboard
 * navigation still shows focus rings.
 */
export function focusDialogContainer(event: Event): void {
  event.preventDefault();
  if (event.target instanceof HTMLElement)
    event.target.focus({ preventScroll: true });
}
