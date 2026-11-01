import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { Reader, type CityResponse } from "mmdb-lib";
import {
  isApproximateLocation,
  type ApproximateLocation,
} from "../shared/approximateLocation";

const gunzipAsync = promisify(gunzip);

/** Echoes the caller's public address as `ip=...` in plain text. */
const PUBLIC_IP_URL = "https://1.1.1.1/cdn-cgi/trace";
const PUBLIC_IP_TIMEOUT_MS = 5_000;
/** Networks change rarely; confirm the address again after this long. */
const LOOKUP_TTL_MS = 30 * 60 * 1000;

export interface ApproximateLocationServiceOptions {
  /** DB-IP's city database as Pine ships it, gzip-compressed. */
  databasePath: string;
  /** Where the last estimate survives restarts. */
  cachePath: string;
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

interface CachedLocation {
  /** When the public address was last confirmed. */
  at: number;
  /** SHA-256 of the address, so the cache never holds it in the clear. */
  ipHash: string;
  /** Size and time of the database the location came from. */
  database: string;
  location: ApproximateLocation | null;
}

function isCachedLocation(value: unknown): value is CachedLocation {
  if (typeof value !== "object" || value === null) return false;
  const cache = value as Record<string, unknown>;
  return (
    typeof cache.at === "number" &&
    typeof cache.ipHash === "string" &&
    typeof cache.database === "string" &&
    (cache.location === null || isApproximateLocation(cache.location))
  );
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

/**
 * Estimates where the user is from their public IP address, looked up in the
 * bundled GeoIP database so the address itself only reaches the echo service.
 *
 * A turn never waits on the network or the database: {@link current} answers
 * from the cache and refreshes it in the background. The database, slow to
 * decompress, is only read when the address changes.
 */
export class ApproximateLocationService {
  private readonly now: () => number;
  private cached: CachedLocation | null = null;
  private loaded: Promise<void> | undefined;
  private refreshInFlight: Promise<void> | undefined;

  constructor(private readonly options: ApproximateLocationServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  /** The latest estimate, possibly stale; null until one exists. */
  async current(): Promise<ApproximateLocation | null> {
    await this.load();
    if (!this.cached || this.now() - this.cached.at >= LOOKUP_TTL_MS)
      void this.refresh();
    return this.cached?.location ?? null;
  }

  /** Confirm the public address, looking it up again only if it changed. */
  refresh(): Promise<void> {
    this.refreshInFlight ??= this.refreshNow().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const value: unknown = JSON.parse(
          await readFile(this.options.cachePath, "utf8"),
        );
        if (isCachedLocation(value)) this.cached ??= value;
      } catch {
        // No usable cache yet.
      }
    })();
    return this.loaded;
  }

  private async refreshNow(): Promise<void> {
    await this.load();
    const ip = await this.publicIp();
    // Offline or blocked: keep the last estimate.
    if (!ip) return;
    const database = await this.databaseVersion();
    if (!database) return;
    const ipHash = hashIp(ip);
    const previous = this.cached;
    const location =
      previous?.ipHash === ipHash && previous.database === database
        ? previous.location
        : await this.lookUp(ip);
    if (location === undefined) return;
    this.cached = { at: this.now(), ipHash, database, location };
    try {
      await writeFile(this.options.cachePath, JSON.stringify(this.cached));
    } catch {
      // The estimate still serves this run.
    }
  }

  /** Undefined when the database does not open. */
  private async lookUp(
    ip: string,
  ): Promise<ApproximateLocation | null | undefined> {
    try {
      // Decompressed on demand: the database is too large to keep in memory.
      const reader = new Reader<CityResponse>(
        await gunzipAsync(await readFile(this.options.databasePath)),
      );
      return locationFromRecord(reader.get(ip));
    } catch {
      return undefined;
    }
  }

  private async databaseVersion(): Promise<string | undefined> {
    try {
      const { size, mtimeMs } = await stat(this.options.databasePath);
      return `${size}:${mtimeMs}`;
    } catch {
      return undefined;
    }
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
