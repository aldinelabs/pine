import { describe, expect, it, vi } from "vitest";
import { cloudflareTurn } from "../turn";

const ICE = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "u",
      credential: "c",
    },
  ],
};

function provider(fetchImpl: typeof fetch) {
  return cloudflareTurn({
    keyId: "key id",
    apiToken: "secret-token",
    ttlSeconds: 600,
    fetch: fetchImpl,
  });
}

describe("cloudflareTurn", () => {
  it("asks for short-lived credentials and drops the port browsers cannot use", async () => {
    const fetchMock = vi.fn(async () => Response.json(ICE, { status: 201 }));
    const servers = await provider(
      fetchMock as unknown as typeof fetch,
    ).issue();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key%20id/credentials/generate-ice-servers",
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ ttl: 600 }));
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
    expect(servers).toHaveLength(2);
    expect(servers[1]?.urls).toEqual([
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turns:turn.cloudflare.com:443?transport=tcp",
    ]);
    expect(servers[1]).toMatchObject({ username: "u", credential: "c" });
  });

  it("fails on an error status or an unexpected body", async () => {
    await expect(
      provider(
        (async () => new Response("no", { status: 403 })) as typeof fetch,
      ).issue(),
    ).rejects.toThrow(/403/);
    await expect(
      provider((async () =>
        Response.json({}, { status: 201 })) as typeof fetch).issue(),
    ).rejects.toThrow(/unexpected/);
  });
});
