import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { preferenceStorage } from "@/lib/preferenceStorage";
import {
  PINE_CURRENCIES,
  currencyForLocales,
  currencyForRegion,
  isPineCurrency,
  type PineCurrency,
  type PineExchangeRates,
} from "@/shared/currency";

export const CURRENCY_STORAGE_KEY = "pine.currency";
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

  const systemCurrency = computed(
    () =>
      currencyForRegion(systemRegion.value) ??
      currencyForLocales(
        typeof navigator === "undefined" ? undefined : navigator.languages,
      ),
  );
  const wanted = computed<PineCurrency>(() =>
    preference.value === "auto" ? systemCurrency.value : preference.value,
  );
  /** What amounts are actually shown in right now. */
  const currency = computed<PineCurrency>(() =>
    rate(wanted.value) === null ? "USD" : wanted.value,
  );
  const rateValue = computed(() => rate(currency.value) ?? 1);

  function rate(code: PineCurrency): number | null {
    if (code === "USD") return 1;
    return rates.value?.rates[code] ?? null;
  }

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

  /** Formats a USD amount in the display currency. */
  function format(usd: number, fractionDigits?: number): string {
    const amount = fromUsd(usd);
    const digits =
      fractionDigits ?? (currency.value === "USD" || amount < 100 ? 4 : 2);
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency.value,
        minimumFractionDigits: Math.min(digits, 2),
        maximumFractionDigits: digits,
      }).format(amount);
    } catch {
      return `${amount.toFixed(digits)} ${currency.value}`;
    }
  }

  /** The symbol alone ("$", "¥"), for an input prefix. */
  const symbol = computed(() => {
    try {
      return (
        new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency.value,
          currencyDisplay: "narrowSymbol",
        })
          .formatToParts(0)
          .find((part) => part.type === "currency")?.value ?? currency.value
      );
    } catch {
      return currency.value;
    }
  });

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
