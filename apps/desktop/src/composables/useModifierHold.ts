import { createSharedComposable, useEventListener } from "@vueuse/core";
import { onScopeDispose, readonly, ref, type Ref } from "vue";

/** How long the modifier must be held alone before shortcut hints appear. */
export const MODIFIER_HOLD_DELAY_MS = 500;

/**
 * Whether the shortcut modifier (Cmd on macOS, Ctrl elsewhere) has been held
 * long enough to reveal shortcut hints. Pressing any other key hides them, so
 * using a shortcut does not flash the hints; releasing the modifier or leaving
 * the window hides them too.
 */
export const useModifierHold = createSharedComposable(
  (): Readonly<Ref<boolean>> => {
    const modifierKey =
      (window.pine?.platform ?? "darwin") === "darwin" ? "Meta" : "Control";
    const held = ref(false);
    let timer: ReturnType<typeof setTimeout> | undefined;

    function release() {
      clearTimeout(timer);
      timer = undefined;
      held.value = false;
    }

    useEventListener(window, "keydown", (event: KeyboardEvent) => {
      if (event.key !== modifierKey) {
        release();
        return;
      }
      if (event.repeat || held.value || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        held.value = true;
      }, MODIFIER_HOLD_DELAY_MS);
    });
    useEventListener(window, "keyup", (event: KeyboardEvent) => {
      if (event.key === modifierKey) release();
    });
    useEventListener(window, "blur", release);
    // The main process swallows Cmd/Ctrl+W, N and T before the page sees the
    // key, and the modifier's keyup can go missing after them as well.
    const unsubscribers = [
      window.pine?.onCloseTabRequested?.(release),
      window.pine?.onNewTabRequested?.(release),
    ];
    onScopeDispose(() =>
      unsubscribers.forEach((unsubscribe) => unsubscribe?.()),
    );

    return readonly(held);
  },
);
