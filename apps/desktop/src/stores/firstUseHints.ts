import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  preferenceStorage,
  subscribePreference,
} from "@/lib/preferenceStorage";
import { FIRST_USE_HINTS_PREFERENCE_KEY } from "@/shared/preferenceStorage";
import { useAppearanceStore } from "@/stores/appearance";

/** The moments that get a one-time hint, each pointing at a guide. */
export const FIRST_USE_HINT_IDS = [
  "approval-card",
  "compaction",
  "artifacts",
  "sub-sessions",
] as const;

export type FirstUseHintId = (typeof FIRST_USE_HINT_IDS)[number];

function parse(value: string | null): Set<FirstUseHintId> {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (Array.isArray(parsed))
      return new Set(
        parsed.filter((id): id is FirstUseHintId =>
          (FIRST_USE_HINT_IDS as readonly unknown[]).includes(id),
        ),
      );
  } catch {
    // Corrupt preferences show every hint again.
  }
  return new Set();
}

function readDismissed(): Set<FirstUseHintId> {
  try {
    return parse(preferenceStorage.getItem(FIRST_USE_HINTS_PREFERENCE_KEY));
  } catch {
    return new Set();
  }
}

/**
 * One-time hints: a short bar shown the first time a feature appears (the
 * first approval card, compaction, artifact, sub-session) until the user
 * dismisses it or opens its guide. Dismissals live in the user's
 * preferences, so they survive restarts and reach every window. Guide
 * buttons off hides them all. Only one place shows a given hint at a time:
 * the first to claim it.
 */
export const useFirstUseHintsStore = defineStore("first-use-hints", () => {
  const appearance = useAppearanceStore();
  const dismissed = ref<ReadonlySet<FirstUseHintId>>(readDismissed());
  const holders = ref<ReadonlyMap<FirstUseHintId, symbol>>(new Map());

  subscribePreference(FIRST_USE_HINTS_PREFERENCE_KEY, (value) => {
    dismissed.value = parse(value);
  });

  const hasDismissed = computed(() => dismissed.value.size > 0);

  function isAvailable(id: FirstUseHintId): boolean {
    return appearance.helpGuides && !dismissed.value.has(id);
  }

  /** Whether `holder` is the place that shows hint `id` right now. */
  function shows(id: FirstUseHintId, holder: symbol): boolean {
    if (!isAvailable(id)) return false;
    return holders.value.get(id) === holder;
  }

  function claim(id: FirstUseHintId, holder: symbol): void {
    if (holders.value.has(id)) return;
    holders.value = new Map(holders.value).set(id, holder);
  }

  function release(id: FirstUseHintId, holder: symbol): void {
    if (holders.value.get(id) !== holder) return;
    const next = new Map(holders.value);
    next.delete(id);
    holders.value = next;
  }

  function persist(): void {
    try {
      preferenceStorage.setItem(
        FIRST_USE_HINTS_PREFERENCE_KEY,
        JSON.stringify([...dismissed.value]),
      );
    } catch {
      // Keep the dismissal for this window when storage is unavailable.
    }
  }

  function dismiss(id: FirstUseHintId): void {
    if (dismissed.value.has(id)) return;
    dismissed.value = new Set(dismissed.value).add(id);
    persist();
  }

  /** Shows every hint again. */
  function reset(): void {
    dismissed.value = new Set();
    persist();
  }

  return {
    dismissed,
    hasDismissed,
    isAvailable,
    shows,
    claim,
    release,
    dismiss,
    reset,
  };
});

if (import.meta.hot)
  import.meta.hot.accept(
    acceptHMRUpdate(useFirstUseHintsStore, import.meta.hot),
  );
