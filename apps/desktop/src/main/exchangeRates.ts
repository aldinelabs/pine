import { z } from "zod";
import {
  PINE_CURRENCIES,
  type PineCurrency,
  type PineExchangeRates,
} from "../shared/currency";

/** European Central Bank reference rates; free, no API key. */
export const EXCHANGE_RATES_URL =
  "https://api.frankfurter.dev/v1/latest?base=USD";

const ResponseSchema = z.object({
  date: z.string().min(1).max(32),
  rates: z.record(z.string(), z.number().positive().finite()),
});

interface ExchangeRateServiceOptions {
  fetch?: typeof fetch;
  now?: () => number;
  retryDelayMs?: number;
  timeoutMs?: number;
  ttlMs?: number;
  url?: string;
}

/**
 * Caches the day's exchange rates. A failed refresh keeps serving the last
 * good rates, or null when there have never been any.
 */
export class ExchangeRateService {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly url: string;
  private cached: PineExchangeRates | null = null;
  private expiresAt = 0;
  private pending: Promise<PineExchangeRates | null> | undefined;

  constructor(options: ExchangeRateServiceOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.retryDelayMs = options.retryDelayMs ?? 5 * 60_000;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.ttlMs = options.ttlMs ?? 6 * 60 * 60_000;
    this.url = options.url ?? EXCHANGE_RATES_URL;
  }

  get(): Promise<PineExchangeRates | null> {
    if (this.now() < this.expiresAt) return Promise.resolve(this.cached);
    if (this.pending) return this.pending;
    this.pending = this.refresh().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async refresh(): Promise<PineExchangeRates | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(this.url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Exchange rate API returned ${response.status}.`);
      }
      const body = ResponseSchema.parse(await response.json());
      const rates: Partial<Record<PineCurrency, number>> = { USD: 1 };
      for (const code of PINE_CURRENCIES) {
        const rate = body.rates[code];
        if (rate !== undefined) rates[code] = rate;
      }
      this.cached = { base: "USD", date: body.date, rates };
      this.expiresAt = this.now() + this.ttlMs;
    } catch {
      this.expiresAt = this.now() + this.retryDelayMs;
    } finally {
      clearTimeout(timeout);
    }
    return this.cached;
  }
}
