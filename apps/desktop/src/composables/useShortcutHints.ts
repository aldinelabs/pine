import { createSharedComposable, useEventListener } from "@vueuse/core";
import { computed, ref } from "vue";
import { usePhoneLayout } from "./usePhoneLayout";

// Soft keyboards rarely produce these; a physical keyboard does as soon as
// the user reaches for a shortcut.
const PHYSICAL_ONLY_KEYS = new Set([
  "Control",
  "Meta",
  "Alt",
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/**
 * Whether keyboard shortcut hints are worth showing. They always show on a
 * wide window; on a phone-width one they wait until a physical keyboard has
 * been used, because a touch screen has no way to press them.
 */
export const useShortcutHints = createSharedComposable(() => {
  const isPhone = usePhoneLayout();
  const hasPhysicalKeyboard = ref(false);

  useEventListener(
    window,
    "keydown",
    (event: KeyboardEvent) => {
      if (hasPhysicalKeyboard.value || event.isComposing) return;
      if (PHYSICAL_ONLY_KEYS.has(event.key) || event.ctrlKey || event.metaKey)
        hasPhysicalKeyboard.value = true;
    },
    { passive: true },
  );

  return computed(() => !isPhone.value || hasPhysicalKeyboard.value);
});
