// Pine does not rate-limit what the bound account may do (plan ground rule
// 13). What stays is protecting the reply budget: the same error reply is not
// sent again within ERROR_REPEAT_MS (CMD §6.3, last row).

import { ERROR_REPEAT_MS } from "./constants";

export interface RateLimitsOptions {
  now: () => number;
}

export class RateLimits {
  private readonly lastSent = new Map<string, number>();

  constructor(private readonly options: RateLimitsOptions) {}

  /**
   * Whether the error reply `errorId` (a template id, optionally with its
   * distinguishing data, e.g. "E-CODE:42") may be sent now. A `true` answer
   * counts as sent.
   */
  repeatAllowed(errorId: string): boolean {
    const now = this.options.now();
    for (const [id, atMs] of this.lastSent) {
      if (now - atMs >= ERROR_REPEAT_MS) this.lastSent.delete(id);
    }
    if (this.lastSent.has(errorId)) return false;
    this.lastSent.set(errorId, now);
    return true;
  }

  /** A new budget window (new context token) starts over. */
  reset(): void {
    this.lastSent.clear();
  }
}
