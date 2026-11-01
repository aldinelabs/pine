import { useMediaQuery } from "@vueuse/core";

/**
 * Below Tailwind's `sm` breakpoint large dialogs fill the screen and show
 * their list and detail one at a time; matches the `max-sm:` variant.
 */
export function usePhoneLayout() {
  return useMediaQuery("(width < 40rem)");
}
