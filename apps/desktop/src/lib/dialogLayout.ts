/**
 * Large dialogs cover a phone screen instead of floating as a card, so their
 * content keeps the whole width, and rise from the bottom edge rather than
 * zooming in. Pass it after the dialog's own classes.
 */
export const PHONE_FULLSCREEN_DIALOG =
  "max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:border-y-transparent max-sm:border-t-(length:--safe-area-top) max-sm:border-b-(length:--safe-area-bottom) max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:content-start max-sm:rounded-none max-sm:ring-0 max-sm:duration-500 max-sm:ease-out-expo max-sm:data-open:fade-in-100 max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom max-sm:data-closed:duration-300 max-sm:data-closed:fade-out-100 max-sm:data-closed:zoom-out-100 max-sm:data-closed:slide-out-to-bottom";
