import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { Reader, type CityResponse } from "mmdb-lib";
import type { ApproximateLocation } from "../shared/approximateLocation";

/** DB-IP's free city database, CC BY 4.0; a new one appears each month. */
const DATABASE_URL = (month: string) =>
  `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`;
const DATABASE_FILE = "dbip-city-lite.mmdb";
/** Replace the database once it is older than about a month. */
const DATABASE_MAX_AGE_MS = 35 * 24 * 60 * 60 * 1000;
/** Echoes the caller's public address as `ip=...` in plain text. */
const PUBLIC_IP_URL = "https://1.1.1.1/cdn-cgi/trace";
const PUBLIC_IP_TIMEOUT_MS = 5_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
/** Networks change rarely; look the address up again after this long. */
const LOOKUP_TTL_MS = 30 * 60 * 1000;

export interface ApproximateLocationServiceOptions {
  /** Where the downloaded database lives. */
  directory: string;
  /** Electron's `net.fetch`, so requests follow the system proxy. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}

function yearMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** This month's database, then last month's while this one is unpublished. */
export function databaseMonths(now: Date): string[] {
  const previous = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  return [yearMonth(now), yearMonth(previous)];
}

export function parsePublicIp(trace: string): string | undefined {
  const line = trace.split("\n").find((entry) => entry.startsWith("ip="));
  const ip = line?.slice(3).trim();
  return ip || undefined;
}

export function locationFromRecord(
  record: CityResponse | null,
): ApproximateLocation | null {
  const country = record?.country?.names.en;
  if (!record || !country) return null;
  const city = record.city?.names.en;
  const region = record.subdivisions?.[0]?.names.en;
  return {
    ...(city ? { city } : {}),
    ...(region && region !== city ? { region } : {}),
    country,
    ...(record.country?.iso_code
      ? { countryCode: record.country.iso_code }
      : {}),
  };
}

/**
 * Estimates where the user is from their public IP address, looked up in a
 * local GeoIP database so the address itself only reaches the echo service.
 */
export class ApproximateLocationService {
  private readonly databasePath: string;
  private readonly now: () => number;
  private download: Promise<void> | undefined;
  private cached: { at: number; location: ApproximateLocation | null } | null =
    null;
  private lookupInFlight: Promise<ApproximateLocation | null> | undefined;

  constructor(private readonly options: ApproximateLocationServiceOptions) {
    this.databasePath = path.join(options.directory, DATABASE_FILE);
    this.now = options.now ?? Date.now;
  }

  /** Download the database unless a current one is already on disk. */
  async prepare(): Promise<void> {
    const age = await this.databaseAge();
    if (age !== undefined && age < DATABASE_MAX_AGE_MS) return;
    await this.downloadDatabase();
  }

  /** Remove the database and forget the last location. */
  async clear(): Promise<void> {
    await this.download?.catch(() => undefined);
    this.cached = null;
    await rm(this.options.directory, { recursive: true, force: true });
  }

  /** Null when the address or the database is unavailable. */
  lookup(): Promise<ApproximateLocation | null> {
    if (this.cached && this.now() - this.cached.at < LOOKUP_TTL_MS)
      return Promise.resolve(this.cached.location);
    this.lookupInFlight ??= this.lookUpNow().finally(() => {
      this.lookupInFlight = undefined;
    });
    return this.lookupInFlight;
  }

  private async lookUpNow(): Promise<ApproximateLocation | null> {
    const age = await this.databaseAge();
    if (age === undefined) {
      // The download is a one-off; this turn goes without a location.
      void this.downloadDatabase().catch(() => undefined);
      return null;
    }
    if (age >= DATABASE_MAX_AGE_MS)
      void this.downloadDatabase().catch(() => undefined);
    const ip = await this.publicIp();
    if (!ip) return null;
    let location: ApproximateLocation | null = null;
    try {
      // Read on demand: the database is too large to keep in memory.
      const reader = new Reader<CityResponse>(
        await readFile(this.databasePath),
      );
      location = locationFromRecord(reader.get(ip));
    } catch {
      return null;
    }
    this.cached = { at: this.now(), location };
    return location;
  }

  private async publicIp(): Promise<string | undefined> {
    try {
      const response = await this.options.fetch(PUBLIC_IP_URL, {
        signal: AbortSignal.timeout(PUBLIC_IP_TIMEOUT_MS),
      });
      if (!response.ok) return undefined;
      return parsePublicIp(await response.text());
    } catch {
      return undefined;
    }
  }

  private async databaseAge(): Promise<number | undefined> {
    try {
      return this.now() - (await stat(this.databasePath)).mtimeMs;
    } catch {
      return undefined;
    }
  }

  private downloadDatabase(): Promise<void> {
    this.download ??= this.fetchDatabase().finally(() => {
      this.download = undefined;
    });
    return this.download;
  }

  private async fetchDatabase(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true });
    const partial = `${this.databasePath}.partial`;
    let lastError: unknown;
    for (const month of databaseMonths(new Date(this.now()))) {
      try {
        const response = await this.options.fetch(DATABASE_URL(month), {
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
        if (!response.ok || !response.body) {
          lastError = new Error(
            `The location database download failed (HTTP ${response.status}).`,
          );
          continue;
        }
        await pipeline(
          Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
          createGunzip(),
          createWriteStream(partial),
        );
        // Check it opens before replacing a working copy.
        new Reader<CityResponse>(await readFile(partial));
        await rename(partial, this.databasePath);
        this.cached = null;
        return;
      } catch (error) {
        lastError = error;
        await rm(partial, { force: true });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("The location database download failed.");
  }
}
