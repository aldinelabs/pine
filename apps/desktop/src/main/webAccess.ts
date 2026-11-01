import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  MIN_WEB_PASSWORD_LENGTH,
  type WebRememberFor,
} from "../shared/webControl";

const MAX_PASSWORD_LENGTH = 1_024;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const DAY_SECONDS = 24 * 60 * 60;
/**
 * A cookie that ends with the browser still carries an expiry of its own,
 * so a browser that restores its session cannot keep it forever.
 */
const BROWSER_SESSION_SECONDS = DAY_SECONDS;
const REMEMBER_SECONDS: Record<WebRememberFor, number | null> = {
  session: null,
  "1d": DAY_SECONDS,
  "7d": 7 * DAY_SECONDS,
  "30d": 30 * DAY_SECONDS,
};

const storedSchema = z.object({
  password: z
    .object({
      salt: z.string().min(1),
      hash: z.string().min(1),
      N: z.number().int().positive(),
      r: z.number().int().positive(),
      p: z.number().int().positive(),
    })
    .optional(),
  secret: z.string().min(32),
});
type StoredAccess = z.infer<typeof storedSchema>;

function scrypt(
  password: string,
  salt: Buffer,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(password, salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

function newSecret(): string {
  return randomBytes(32).toString("hex");
}

export interface WebSessionCookie {
  value: string;
  /** Seconds the browser keeps it; absent for a cookie that ends with the browser. */
  maxAge?: number;
}

/**
 * The browser interface's password and the key that signs its sessions. Only
 * an scrypt hash of the password is stored. A session is a signed expiry, so
 * signing in survives restarts; replacing the key signs every browser out.
 */
export class WebAccessStore {
  private stored: StoredAccess = { secret: newSecret() };

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      this.stored = storedSchema.parse(
        JSON.parse(await readFile(this.filePath, "utf8")),
      );
    } catch {
      // Without a readable file there is no password, so access stays off
      // until one is set.
      this.stored = { secret: newSecret() };
    }
  }

  hasPassword(): boolean {
    return this.stored.password !== undefined;
  }

  /** Replaces the password and signs every browser out. */
  async setPassword(password: string): Promise<void> {
    if (
      password.length < MIN_WEB_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    )
      throw new Error("Invalid browser access password.");
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, SCRYPT);
    await this.save({
      password: {
        salt: salt.toString("base64"),
        hash: hash.toString("base64"),
        N: SCRYPT.N,
        r: SCRYPT.r,
        p: SCRYPT.p,
      },
      secret: newSecret(),
    });
  }

  async verify(password: string): Promise<boolean> {
    const stored = this.stored.password;
    if (!stored || password.length > MAX_PASSWORD_LENGTH) return false;
    const expected = Buffer.from(stored.hash, "base64");
    const actual = await scrypt(password, Buffer.from(stored.salt, "base64"), {
      N: stored.N,
      r: stored.r,
      p: stored.p,
      maxmem: SCRYPT.maxmem,
    });
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  async signOutAll(): Promise<void> {
    await this.save({ ...this.stored, secret: newSecret() });
  }

  issue(rememberFor: WebRememberFor, now = Date.now()): WebSessionCookie {
    const maxAge = REMEMBER_SECONDS[rememberFor];
    const expires =
      Math.floor(now / 1000) + (maxAge ?? BROWSER_SESSION_SECONDS);
    const value = `${expires}.${this.sign(String(expires))}`;
    return maxAge === null ? { value } : { value, maxAge };
  }

  isValid(value: string, now = Date.now()): boolean {
    const [expires, signature, ...rest] = value.split(".");
    if (!expires || !signature || rest.length > 0 || !/^\d+$/.test(expires))
      return false;
    const expected = Buffer.from(this.sign(expires));
    const actual = Buffer.from(signature);
    return (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected) &&
      Number(expires) * 1000 > now
    );
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.stored.secret)
      .update(payload)
      .digest("base64url");
  }

  private async save(next: StoredAccess): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
    this.stored = next;
  }
}

const FREE_ATTEMPTS = 5;
const FIRST_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;
const FORGET_AFTER_MS = 60 * 60_000;

/**
 * Slows password guessing per client address: a few free attempts, then a
 * lockout that doubles with each further failure.
 */
export class WebLoginThrottle {
  private readonly clients = new Map<
    string,
    { failures: number; lockedUntil: number; lastFailure: number }
  >();

  /** Milliseconds the client must still wait, or 0. */
  retryAfter(client: string, now = Date.now()): number {
    this.forgetStale(now);
    const entry = this.clients.get(client);
    return entry ? Math.max(0, entry.lockedUntil - now) : 0;
  }

  failed(client: string, now = Date.now()): void {
    const entry = this.clients.get(client) ?? {
      failures: 0,
      lockedUntil: 0,
      lastFailure: now,
    };
    entry.failures++;
    entry.lastFailure = now;
    if (entry.failures >= FREE_ATTEMPTS)
      entry.lockedUntil =
        now +
        Math.min(
          FIRST_LOCKOUT_MS * 2 ** (entry.failures - FREE_ATTEMPTS),
          MAX_LOCKOUT_MS,
        );
    this.clients.set(client, entry);
  }

  succeeded(client: string): void {
    this.clients.delete(client);
  }

  private forgetStale(now: number): void {
    for (const [client, entry] of this.clients)
      if (entry.lockedUntil <= now && now - entry.lastFailure > FORGET_AFTER_MS)
        this.clients.delete(client);
  }
}
