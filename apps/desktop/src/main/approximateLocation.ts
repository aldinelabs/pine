import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { Reader, type CityResponse } from "mmdb-lib";
import type { ApproximateLocation } from "../shared/approximateLocation";

const gunzipAsync = promisify(gunzip);

/** Echoes the caller's public address as `ip=...` in plain text. */
const PUBLIC_IP_URL = "https://1.1.1.1/cdn-cgi/trace";
const PUBLIC_IP_TIMEOUT_MS = 5_000;
/** Networks change rarely; look the address up again after this long. */
const LOOKUP_TTL_MS = 30 * 60 * 1000;

export interface ApproximateLocationServiceOptions {
  /** DB-IP's city database as Pine ships it, gzip-compressed. */
  databasePath: string;
  /** Electron's `net.fetch`, so requests follow the system proxy. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
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
 * Estimates where the user is from their public IP address, looked up in the
 * bundled GeoIP database so the address itself only reaches the echo service.
 */
export class ApproximateLocationService {
  private readonly now: () => number;
  private cached: { at: number; location: ApproximateLocation | null } | null =
    null;
  private lookupInFlight: Promise<ApproximateLocation | null> | undefined;

  constructor(private readonly options: ApproximateLocationServiceOptions) {
    this.now = options.now ?? Date.now;
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
    const ip = await this.publicIp();
    if (!ip) return null;
    let location: ApproximateLocation | null;
    try {
      // Decompressed on demand: the database is too large to keep in memory.
      const reader = new Reader<CityResponse>(
        await gunzipAsync(await readFile(this.options.databasePath)),
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
}
