export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface TurnProvider {
  issue(): Promise<IceServer[]>;
}

const ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys";

/**
 * Asks Cloudflare for credentials that expire. The long-lived key stays on
 * this server; only the short-lived username and credential reach a device.
 */
export function cloudflareTurn(options: {
  keyId: string;
  apiToken: string;
  ttlSeconds: number;
  fetch?: typeof fetch;
}): TurnProvider {
  const request = options.fetch ?? fetch;
  return {
    async issue() {
      const response = await request(
        `${ENDPOINT}/${encodeURIComponent(options.keyId)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ttl: options.ttlSeconds }),
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (response.status !== 201)
        throw new Error(`TURN provider answered ${response.status}.`);
      const body = (await response.json()) as { iceServers?: unknown };
      if (!Array.isArray(body.iceServers))
        throw new Error("TURN provider sent an unexpected answer.");
      return body.iceServers.flatMap((server: unknown) => {
        const value = server as Partial<IceServer> | null;
        if (
          !value ||
          !Array.isArray(value.urls) ||
          !value.urls.every((url) => typeof url === "string")
        )
          return [];
        // Browsers cannot use port 53 and wait for it to time out.
        const urls = value.urls.filter((url) => !/:53(\?|$)/.test(url));
        if (urls.length === 0) return [];
        return [
          {
            urls,
            ...(typeof value.username === "string"
              ? { username: value.username }
              : {}),
            ...(typeof value.credential === "string"
              ? { credential: value.credential }
              : {}),
          },
        ];
      });
    },
  };
}
