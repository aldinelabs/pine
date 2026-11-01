import { describe, expect, it } from "vitest";
import { readConfig } from "../config";

const base = { RC_SIGNAL_ORIGINS: "https://rc.aldine.cn" };

describe("readConfig", () => {
  it("defaults to a loopback listener and no TURN", () => {
    expect(readConfig(base)).toMatchObject({
      host: "127.0.0.1",
      port: 8787,
      allowedOrigins: ["https://rc.aldine.cn"],
      trustCloudflareAddress: false,
      turnDailyLimit: 2000,
    });
    expect(readConfig(base).turn).toBeUndefined();
  });

  it("requires explicit page origins and rejects wildcards or paths", () => {
    expect(() => readConfig({})).toThrow(/RC_SIGNAL_ORIGINS/);
    expect(() => readConfig({ RC_SIGNAL_ORIGINS: "*" })).toThrow();
    expect(() =>
      readConfig({ RC_SIGNAL_ORIGINS: "https://a.example/x" }),
    ).toThrow();
  });

  it("needs both halves of the TURN key, or neither", () => {
    expect(() => readConfig({ ...base, CF_TURN_KEY_ID: "k" })).toThrow();
    expect(
      readConfig({ ...base, CF_TURN_KEY_ID: "k", CF_TURN_API_TOKEN: "t" }).turn,
    ).toEqual({ keyId: "k", apiToken: "t", ttlSeconds: 3600 });
  });

  it("rejects numbers that are not positive integers", () => {
    expect(() => readConfig({ ...base, RC_SIGNAL_PORT: "abc" })).toThrow();
    expect(() => readConfig({ ...base, RC_TURN_DAILY_LIMIT: "0" })).toThrow();
  });
});
