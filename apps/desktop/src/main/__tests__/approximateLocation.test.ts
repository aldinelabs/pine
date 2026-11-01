import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApproximateLocationService,
  locationFromRecord,
  parsePublicIp,
} from "../approximateLocation";

describe("parsePublicIp", () => {
  it("reads the ip line of a Cloudflare trace", () => {
    expect(parsePublicIp("fl=1\nh=1.1.1.1\nip=203.0.113.7\nts=1\n")).toBe(
      "203.0.113.7",
    );
    expect(parsePublicIp("fl=1\n")).toBeUndefined();
  });
});

describe("locationFromRecord", () => {
  it("keeps English names and drops a region that repeats the city", () => {
    expect(
      locationFromRecord({
        city: { geoname_id: 1, names: { en: "Singapore" } },
        country: { geoname_id: 2, iso_code: "SG", names: { en: "Singapore" } },
        subdivisions: [
          { geoname_id: 3, iso_code: "", names: { en: "Singapore" } },
        ],
      }),
    ).toEqual({ city: "Singapore", country: "Singapore", countryCode: "SG" });
  });

  it("is null without a country", () => {
    expect(locationFromRecord(null)).toBeNull();
    expect(locationFromRecord({})).toBeNull();
  });
});

describe("ApproximateLocationService", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "pine-geoip-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function trace(ip = "203.0.113.7") {
    return vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(new Response(`ip=${ip}\n`)),
    );
  }

  async function database(): Promise<string> {
    const databasePath = path.join(directory, "city.mmdb.gz");
    await writeFile(databasePath, gzipSync(Buffer.from("not a database")));
    return databasePath;
  }

  async function cache(ip: string, at: number): Promise<string> {
    const cachePath = path.join(directory, "cache.json");
    const { size, mtimeMs } = await stat(path.join(directory, "city.mmdb.gz"));
    await writeFile(
      cachePath,
      JSON.stringify({
        at,
        ipHash: createHash("sha256").update(ip).digest("hex"),
        database: `${size}:${mtimeMs}`,
        location: { city: "Lyon", country: "France", countryCode: "FR" },
      }),
    );
    return cachePath;
  }

  it("answers before any lookup finishes, then has nothing to give", async () => {
    let answer!: (response: Response) => void;
    const fetch = vi.fn<(url: string) => Promise<Response>>(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const service = new ApproximateLocationService({
      databasePath: await database(),
      cachePath: path.join(directory, "cache.json"),
      fetch,
    });

    expect(await service.current()).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    answer(new Response("ip=203.0.113.7\n"));
  });

  it("serves a saved estimate and keeps it while the address is unchanged", async () => {
    const databasePath = await database();
    const now = Date.parse("2026-10-31T12:00:00Z");
    const service = new ApproximateLocationService({
      databasePath,
      cachePath: await cache("203.0.113.7", now - 60 * 60 * 1000),
      fetch: trace("203.0.113.7"),
      now: () => now,
    });

    expect(await service.current()).toEqual({
      city: "Lyon",
      country: "France",
      countryCode: "FR",
    });
    // The database here does not open, so a lookup would drop the estimate.
    await service.refresh();
    expect(await service.current()).toMatchObject({ city: "Lyon" });
    expect(
      JSON.parse(await readFile(path.join(directory, "cache.json"), "utf8")),
    ).toMatchObject({ at: now });
  });

  it("looks a new address up instead of reusing the saved estimate", async () => {
    const databasePath = await database();
    const now = Date.parse("2026-10-31T12:00:00Z");
    const service = new ApproximateLocationService({
      databasePath,
      cachePath: await cache("203.0.113.7", now),
      fetch: trace("198.51.100.1"),
      now: () => now,
    });

    await service.refresh();

    // The unreadable database leaves the old estimate in place.
    expect(await service.current()).toMatchObject({ city: "Lyon" });
    expect(
      JSON.parse(await readFile(path.join(directory, "cache.json"), "utf8")),
    ).toMatchObject({
      ipHash: createHash("sha256").update("203.0.113.7").digest("hex"),
    });
  });

  it("keeps the estimate while offline", async () => {
    const databasePath = await database();
    const service = new ApproximateLocationService({
      databasePath,
      cachePath: await cache("203.0.113.7", 0),
      fetch: vi.fn<(url: string) => Promise<Response>>(() =>
        Promise.reject(new Error("offline")),
      ),
    });

    await service.refresh();

    expect(await service.current()).toMatchObject({ city: "Lyon" });
  });
});
