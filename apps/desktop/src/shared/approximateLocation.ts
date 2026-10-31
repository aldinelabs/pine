export const GET_APPROXIMATE_LOCATION_CHANNEL =
  "preferences:get-approximate-location" as const;
export const SET_APPROXIMATE_LOCATION_CHANNEL =
  "preferences:set-approximate-location" as const;

/** Where the user's public IP address places them; English place names. */
export interface ApproximateLocation {
  city?: string;
  region?: string;
  country: string;
  /** ISO 3166-1 alpha-2. */
  countryCode?: string;
}

export interface SetApproximateLocationRequest {
  enabled: boolean;
}

export interface SetApproximateLocationResult {
  enabled: boolean;
}

export function sameApproximateLocation(
  a: ApproximateLocation | undefined,
  b: ApproximateLocation | undefined,
): boolean {
  return (
    a?.city === b?.city &&
    a?.region === b?.region &&
    a?.country === b?.country &&
    a?.countryCode === b?.countryCode
  );
}

export function isApproximateLocation(
  value: unknown,
): value is ApproximateLocation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  const optional = (field: unknown) =>
    field === undefined || typeof field === "string";
  return (
    typeof record.country === "string" &&
    optional(record.city) &&
    optional(record.region) &&
    optional(record.countryCode)
  );
}
