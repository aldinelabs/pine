import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { preferenceStorage } from "@/lib/preferenceStorage";
import { CURRENCY_PREFERENCE_KEY } from "@/shared/preferenceStorage";
import {
  PINE_CURRENCIES,
  currencySymbol,
  displayCurrency,
  formatCurrency,
  isPineCurrency,
  preferredCurrency,
  type PineCurrency,
  type PineExchangeRates,
} from "@/shared/currency";

export const CURRENCY_STORAGE_KEY = CURRENCY_PREFERENCE_KEY;
export type CurrencyPreference = "auto" | PineCurrency;

function readPreference(): CurrencyPreference {
  try {
    const stored = preferenceStorage.getItem(CURRENCY_STORAGE_KEY);
    return isPineCurrency(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

/**
 * The currency costs are shown in. Amounts are tracked in USD everywhere
 * else; this store converts at the latest published rate and falls back to
 * USD while no rates are available.
 */
export const useCurrencyStore = defineStore("currency", () => {
  const preference = ref<CurrencyPreference>(readPreference());
  const rates = ref<PineExchangeRates | null>(null);
  const systemRegion = ref<string | null>(null);
  let loadPromise: Promise<void> | null = null;

  const systemCurrency = computed(() =>
    preferredCurrency(
      null,
      systemRegion.value,
      typeof navigator === "undefined" ? undefined : navigator.languages,
    ),
  );
  const wanted = computed<PineCurrency>(() =>
    preference.value === "auto" ? systemCurrency.value : preference.value,
  );
  const display = computed(() => displayCurrency(wanted.value, rates.value));
  /** What amounts are actually shown in right now. */
  const currency = computed<PineCurrency>(() => display.value.currency);
  const rateValue = computed(() => display.value.rate);

  function load(): Promise<void> {
    if (rates.value) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        if (typeof window.pine?.getExchangeRates === "function") {
          const info = await window.pine.getExchangeRates();
          systemRegion.value = info.systemRegion;
          rates.value = info.rates;
        }
      } catch {
        // Offline: amounts stay in USD until a later load succeeds.
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  }

  function setPreference(next: CurrencyPreference): void {
    preference.value = next;
    try {
      if (next === "auto") preferenceStorage.removeItem(CURRENCY_STORAGE_KEY);
      else preferenceStorage.setItem(CURRENCY_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice still holds for this window.
    }
  }

  const fromUsd = (usd: number): number => usd * rateValue.value;
  const toUsd = (amount: number): number => amount / rateValue.value;

  /**
   * Formats a USD amount in the display currency. `narrow` uses the bare
   * symbol ("¥" rather than "CN¥") where space is tight.
   */
  function format(
    usd: number,
    fractionDigits?: number,
    { narrow = false }: { narrow?: boolean } = {},
  ): string {
    return formatCurrency(fromUsd(usd), currency.value, {
      ...(fractionDigits === undefined ? {} : { fractionDigits }),
      narrow,
    });
  }

  /** The symbol alone ("$", "¥"), for an input prefix. */
  const symbol = computed(() => currencySymbol(currency.value));

  return {
    preference,
    rates,
    systemCurrency,
    currency,
    symbol,
    options: PINE_CURRENCIES,
    load,
    setPreference,
    fromUsd,
    toUsd,
    format,
  };
});
