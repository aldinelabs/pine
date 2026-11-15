import type { ArtifactVersion } from "@/shared/artifacts";

/** How a version's submission time is shown. */
export function versionTimeFormat(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A stable key for a version in lists. */
export function versionKey(version: ArtifactVersion): string {
  return version.ref.kind === "submission"
    ? `submission:${version.ref.toolCallId}`
    : `backup:${version.ref.id}`;
}
