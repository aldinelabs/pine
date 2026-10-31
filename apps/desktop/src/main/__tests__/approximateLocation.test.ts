import { mkdtemp, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApproximateLocationService,
  databaseMonths,
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

describe("databaseMonths", () => {
  it("tries this month, then last month across a year boundary", () => {
    expect(databaseMonths(new Date("2026-01-02T00:00:00Z"))).toEqual([
      "2026-01",
      "2025-12",
    ]);
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
    directory = path.join(
      await mkdtemp(path.join(os.tmpdir(), "pine-geoip-")),
      "geoip",
    );
  });

  afterEach(async () => {
    await rm(path.dirname(directory), { recursive: true, force: true });
  });

  it("falls back to last month and keeps nothing it cannot open", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.includes("2026-10")
          ? new Response("missing", { status: 404 })
          : new Response(gzipSync(Buffer.from("not a database"))),
      ),
    );
    const service = new ApproximateLocationService({
      directory,
      fetch,
      now: () => Date.parse("2026-10-31T00:00:00Z"),
    });

    await expect(service.prepare()).rejects.toThrow();

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz",
      "https://download.db-ip.com/free/dbip-city-lite-2026-09.mmdb.gz",
    ]);
    expect(await readdir(directory)).toEqual([]);
  });

  it("skips the download while a recent database is on disk", async () => {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "dbip-city-lite.mmdb"), "db");
    const fetch = vi.fn();
    const service = new ApproximateLocationService({ directory, fetch });

    await service.prepare();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("has no location before the database exists, without asking for the IP", async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(new Response("missing", { status: 404 })),
    );
    const service = new ApproximateLocationService({ directory, fetch });

    expect(await service.lookup()).toBeNull();
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(
      "https://1.1.1.1/cdn-cgi/trace",
    );
  });

  it("deletes the database when cleared", async () => {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "dbip-city-lite.mmdb"), "db");
    const service = new ApproximateLocationService({
      directory,
      fetch: vi.fn(),
    });

    await service.clear();

    await expect(stat(directory)).rejects.toThrow();
  });
});
