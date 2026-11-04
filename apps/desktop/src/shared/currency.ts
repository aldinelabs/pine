/** Currencies Pine can show costs in: USD plus those the ECB publishes. */
export const PINE_CURRENCIES = [
  "USD",
  "EUR",
  "CNY",
  "JPY",
  "GBP",
  "KRW",
  "HKD",
  "AUD",
  "CAD",
  "CHF",
  "SGD",
  "INR",
  "BRL",
  "MXN",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "ISK",
  "TRY",
  "ZAR",
  "ILS",
  "THB",
  "MYR",
  "IDR",
  "PHP",
] as const;

export type PineCurrency = (typeof PINE_CURRENCIES)[number];

export const GET_EXCHANGE_RATES_CHANNEL =
  "currency:get-exchange-rates" as const;

/** Units of each currency that one US dollar buys. */
export interface PineExchangeRates {
  base: "USD";
  /** The day the rates were published (YYYY-MM-DD). */
  date: string;
  rates: Partial<Record<PineCurrency, number>>;
}

/** What the renderer needs to show costs in the user's currency. */
export interface PineCurrencyInfo {
  rates: PineExchangeRates | null;
  /** The region chosen in the operating system (ISO 3166, e.g. "CA"). */
  systemRegion: string | null;
}

export function isPineCurrency(value: unknown): value is PineCurrency {
  return (
    typeof value === "string" &&
    (PINE_CURRENCIES as readonly string[]).includes(value)
  );
}

const EURO_REGIONS = [
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
];

const REGION_CURRENCIES: Record<string, PineCurrency> = {
  ...Object.fromEntries(EURO_REGIONS.map((region) => [region, "EUR"])),
  US: "USD",
  CN: "CNY",
  JP: "JPY",
  GB: "GBP",
  KR: "KRW",
  HK: "HKD",
  TW: "USD",
  AU: "AUD",
  CA: "CAD",
  CH: "CHF",
  SG: "SGD",
  IN: "INR",
  BR: "BRL",
  MX: "MXN",
  NZ: "NZD",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  HU: "HUF",
  RO: "RON",
  BG: "BGN",
  IS: "ISK",
  TR: "TRY",
  ZA: "ZAR",
  IL: "ILS",
  TH: "THB",
  MY: "MYR",
  ID: "IDR",
  PH: "PHP",
};

/** The currency of an ISO region code, or undefined when unsupported. */
export function currencyForRegion(
  region: string | null | undefined,
): PineCurrency | undefined {
  return region ? REGION_CURRENCIES[region.toUpperCase()] : undefined;
}

/**
 * The currency of the user's region, read from the system's preferred
 * languages (`zh-CN` → CNY). Falls back to USD when nothing matches.
 */
export function currencyForLocales(
  locales: readonly string[] | undefined,
): PineCurrency {
  for (const tag of locales ?? []) {
    try {
      const currency = currencyForRegion(
        new Intl.Locale(tag).maximize().region,
      );
      // maximize() guesses a region for bare languages ("en" → US), which is
      // right for the first preference and harmless for the rest.
      if (currency) return currency;
    } catch {
      // Malformed tag: try the next preference.
    }
  }
  return "USD";
}
