export interface SignalConfig {
  host: string;
  port: number;
  /** Browser origins allowed to call the service; desktop clients send none. */
  allowedOrigins: string[];
  /** Read the client address from CF-Connecting-IP; only behind Cloudflare. */
  trustCloudflareAddress: boolean;
  turn?: { keyId: string; apiToken: string; ttlSeconds: number };
  turnDailyLimit: number;
}

function integer(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function readConfig(
  env: Record<string, string | undefined>,
): SignalConfig {
  const origins = (env.RC_SIGNAL_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0)
    throw new Error("RC_SIGNAL_ORIGINS must list the allowed page origins.");
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`RC_SIGNAL_ORIGINS has an invalid origin: ${origin}`);
    }
    if (parsed.origin !== origin || origin === "null")
      throw new Error(`RC_SIGNAL_ORIGINS must be bare origins: ${origin}`);
  }
  const keyId = env.CF_TURN_KEY_ID;
  const apiToken = env.CF_TURN_API_TOKEN;
  if (Boolean(keyId) !== Boolean(apiToken))
    throw new Error(
      "Set both CF_TURN_KEY_ID and CF_TURN_API_TOKEN, or neither.",
    );
  return {
    host: env.RC_SIGNAL_HOST || "127.0.0.1",
    port: integer(env.RC_SIGNAL_PORT, 8787, "RC_SIGNAL_PORT"),
    allowedOrigins: origins,
    trustCloudflareAddress: env.RC_SIGNAL_TRUST_CF === "1",
    ...(keyId && apiToken
      ? {
          turn: {
            keyId,
            apiToken,
            ttlSeconds: integer(
              env.RC_TURN_TTL_SECONDS,
              3600,
              "RC_TURN_TTL_SECONDS",
            ),
          },
        }
      : {}),
    turnDailyLimit: integer(
      env.RC_TURN_DAILY_LIMIT,
      2000,
      "RC_TURN_DAILY_LIMIT",
    ),
  };
}
