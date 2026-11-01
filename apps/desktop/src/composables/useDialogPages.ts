import { nextTick } from "vue";
import { usePhoneLayout } from "./usePhoneLayout";

export type DialogPageDirection = "forward" | "back";

let currentTransition: ViewTransition | null = null;

/**
 * On a phone a dialog's levels move like a navigation stack: a deeper page
 * slides in from the right over the one it covers, and going back reverses
 * it. The dialog marks itself with `data-dialog-pages`; index.css animates
 * it. Elsewhere, or with reduced motion, the page just changes.
 */
export function useDialogPages() {
  const isPhone = usePhoneLayout();

  return function showPage(
    direction: DialogPageDirection,
    update: () => void,
  ): void {
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!isPhone.value || !document.startViewTransition || reduceMotion) {
      update();
      return;
    }
    const root = document.documentElement;
    root.dataset.dialogPage = direction;
    const transition = document.startViewTransition(async () => {
      update();
      await nextTick();
    });
    currentTransition = transition;
    void transition.finished.finally(() => {
      // A quick second tap starts a newer transition that keeps the marker.
      if (currentTransition !== transition) return;
      currentTransition = null;
      delete root.dataset.dialogPage;
    });
  };
}
