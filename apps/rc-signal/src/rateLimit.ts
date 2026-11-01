/** A token bucket per key: `capacity` requests at once, refilled steadily. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  take(key: string, now: number): boolean {
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + ((now - bucket.at) / 1000) * this.refillPerSecond,
    );
    bucket.at = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return allowed;
  }

  /** Forgets keys that have been idle long enough to be full again. */
  sweep(now: number): void {
    const refill = (this.capacity / this.refillPerSecond) * 1000;
    for (const [key, bucket] of this.buckets)
      if (now - bucket.at > refill) this.buckets.delete(key);
  }
}

/** A cap on how many TURN credentials one UTC day may issue in total. */
export class DailyBudget {
  private day = -1;
  private used = 0;

  constructor(private readonly limit: number) {}

  take(now: number): boolean {
    const day = Math.floor(now / 86_400_000);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}
