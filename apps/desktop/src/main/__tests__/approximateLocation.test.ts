import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  function trace() {
    return vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(new Response("ip=203.0.113.7\n")),
    );
  }

  it("has no location when the database is missing", async () => {
    const fetch = trace();
    const service = new ApproximateLocationService({
      databasePath: path.join(directory, "missing.mmdb.gz"),
      fetch,
    });

    expect(await service.lookup()).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("has no location when the database does not open", async () => {
    const databasePath = path.join(directory, "broken.mmdb.gz");
    await writeFile(databasePath, gzipSync(Buffer.from("not a database")));
    const service = new ApproximateLocationService({
      databasePath,
      fetch: trace(),
    });

    expect(await service.lookup()).toBeNull();
  });

  it("asks only for the public address, and stops without one", async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.reject(new Error("offline")),
    );
    const service = new ApproximateLocationService({
      databasePath: path.join(directory, "missing.mmdb.gz"),
      fetch,
    });

    expect(await service.lookup()).toBeNull();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://1.1.1.1/cdn-cgi/trace",
    ]);
  });
});
