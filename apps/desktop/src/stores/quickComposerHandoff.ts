import { defineStore } from "pinia";
import { shallowRef } from "vue";
import type { QuickComposerHandoff } from "@/shared/quickComposer";

/** Whether this window was opened to continue a floating composer message. */
export function isQuickComposerHandoffWindow(): boolean {
  return window.pine?.isQuickComposerHandoff === true;
}

/**
 * The message a window continues from the floating composer. Such a window
 * loads hidden ahead of time and waits here until one is sent.
 */
export const useQuickComposerHandoffStore = defineStore(
  "quick-composer-handoff",
  () => {
    const pending = shallowRef<QuickComposerHandoff | null>(null);
    let isWaiting = false;

    function initialize(): void {
      if (isWaiting || !isQuickComposerHandoffWindow()) return;
      isWaiting = true;
      void window.pine
        .takeQuickComposerHandoff()
        .then((handoff) => {
          pending.value = handoff;
        })
        .catch(() => undefined);
    }

    /** A message for a project this window holds, for its new draft. */
    function deliver(handoff: QuickComposerHandoff): void {
      pending.value = handoff;
    }

    /** Hands the message to the composer that sends it, once. */
    function take(): QuickComposerHandoff | null {
      const handoff = pending.value;
      pending.value = null;
      return handoff;
    }

    return { pending, initialize, deliver, take };
  },
);
