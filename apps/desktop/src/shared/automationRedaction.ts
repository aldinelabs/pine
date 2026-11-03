import type { PineJsonValue } from "./agent";

/** Shorter values match ordinary text too often to be replaced safely. */
export const MIN_REDACTED_SECRET_LENGTH = 6;

export interface ResolvedSecret {
  name: string;
  value: string;
}

export function redactText(
  text: string,
  secrets: readonly ResolvedSecret[],
): string {
  let result = text;
  // Longer values first, so one secret containing another is fully replaced.
  for (const secret of [...secrets].sort(
    (a, b) => b.value.length - a.value.length,
  )) {
    if (secret.value.length < MIN_REDACTED_SECRET_LENGTH) continue;
    result = result.split(secret.value).join(`[secret:${secret.name}]`);
  }
  return result;
}

export function redactJson<T extends PineJsonValue | undefined>(
  value: T,
  secrets: readonly ResolvedSecret[],
): T {
  if (secrets.length === 0 || value === undefined) return value;
  if (typeof value === "string") return redactText(value, secrets) as T;
  if (Array.isArray(value))
    return value.map((entry) => redactJson(entry, secrets)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        redactText(key, secrets),
        redactJson(entry, secrets),
      ]),
    ) as T;
  return value;
}
