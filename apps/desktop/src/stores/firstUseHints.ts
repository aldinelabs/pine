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
  "automation-run",
  "memory-saved",
  "stopped",
  "steering",
  "skill-used",
  "mcp-used",
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
 * buttons off hides them all. Each hint shows on its own, whatever other
 * hints are on screen; a moment that appears in several places shows its
 * hint only at the first.
 */
export const useFirstUseHintsStore = defineStore("first-use-hints", () => {
  const appearance = useAppearanceStore();
  const dismissed = ref<ReadonlySet<FirstUseHintId>>(readDismissed());
  subscribePreference(FIRST_USE_HINTS_PREFERENCE_KEY, (value) => {
    dismissed.value = parse(value);
  });

  /** Every place that could show a hint now, in the order they appeared. */
  const claimants = ref<readonly { id: FirstUseHintId; holder: symbol }[]>([]);

  const hasDismissed = computed(() => dismissed.value.size > 0);

  function isAvailable(id: FirstUseHintId): boolean {
    return appearance.helpGuides && !dismissed.value.has(id);
  }

  /**
   * Whether `holder` shows its hint: the hint is still available, and this
   * is the first place it appeared, so a moment seen several times (two
   * approval cards in one conversation) shows it once.
   */
  function shows(id: FirstUseHintId, holder: symbol): boolean {
    if (!isAvailable(id)) return false;
    return (
      claimants.value.find((claimant) => claimant.id === id)?.holder === holder
    );
  }

  function claim(id: FirstUseHintId, holder: symbol): void {
    if (claimants.value.some((claimant) => claimant.holder === holder)) return;
    claimants.value = [...claimants.value, { id, holder }];
  }

  function release(holder: symbol): void {
    claimants.value = claimants.value.filter(
      (claimant) => claimant.holder !== holder,
    );
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
