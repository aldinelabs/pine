import { createHash } from "node:crypto";

interface CachedRequest {
  signature: string;
  result: Promise<unknown>;
  expiresAt: number;
}

/** Bounded command receipts survive lost HTTP responses, without storing request bodies. */
export class WebRequestCache {
  private readonly entries = new Map<string, CachedRequest>();

  constructor(
    private readonly capacity = 256,
    private readonly ttlMs = 5 * 60_000,
  ) {}

  execute(
    id: string,
    channel: string,
    request: unknown,
    invoke: () => Promise<unknown>,
  ): Promise<unknown> {
    const now = Date.now();
    for (const [key, entry] of this.entries)
      if (entry.expiresAt <= now) this.entries.delete(key);
    const signature = createHash("sha256")
      .update(JSON.stringify([channel, request]))
      .digest("hex");
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.signature !== signature)
        throw new Error("Request ID was already used.");
      return existing.result;
    }
    if (this.entries.size >= this.capacity)
      throw new Error("Too many recent requests. Try again shortly.");
    const entry: CachedRequest = {
      signature,
      result: Promise.resolve().then(invoke),
      expiresAt: Infinity,
    };
    this.entries.set(id, entry);
    const expire = () => {
      entry.expiresAt = Date.now() + this.ttlMs;
    };
    void entry.result.then(expire, expire);
    return entry.result;
  }
}
