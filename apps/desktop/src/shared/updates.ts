import { compareVersions, isPrerelease } from "./semver";

export const CHECK_FOR_UPDATE_CHANNEL = "update:check" as const;
export const DOWNLOAD_UPDATE_CHANNEL = "update:download" as const;
export const INSTALL_UPDATE_CHANNEL = "update:install" as const;
export const UPDATE_EVENT_CHANNEL = "update:event" as const;

export const UPDATE_CHANGELOG_LOCALES = ["zh-CN", "en-US"] as const;
export type UpdateChangelogLocale = (typeof UPDATE_CHANGELOG_LOCALES)[number];

export type UpdateChangelogs = Partial<Record<UpdateChangelogLocale, string>>;

/** One published version's notes. */
export interface PineReleaseNotes {
  changelogs: UpdateChangelogs;
  /** Release date as written in the changelog, `YYYY-MM-DD`. */
  date?: string;
  version: string;
}

export interface PineUpdateInfo {
  /** Notes in every language, for versions without per-language notes. */
  changelog: string;
  /** Notes per interface language, from releases that publish them. */
  changelogs?: UpdateChangelogs;
  internalVersion: string;
  publishedAt: string;
  /**
   * Every version after the installed one, up to and including this update,
   * newest first. Absent when the update manifest carries no history.
   */
  releases?: PineReleaseNotes[];
  version: string;
}

/**
 * The versions a user skips when updating from `installed` to `target`:
 * newer than `installed`, not newer than `target`, newest first. A stable
 * target leaves out prereleases, whose notes the stable release restates.
 */
export function releaseNotesBetween(
  history: readonly PineReleaseNotes[],
  installed: string,
  target: string,
): PineReleaseNotes[] {
  const includePrereleases = isPrerelease(target);
  const seen = new Set<string>();
  return history
    .filter((release) => {
      if (seen.has(release.version)) return false;
      seen.add(release.version);
      if (!includePrereleases && isPrerelease(release.version)) return false;
      return (
        compareVersions(release.version, installed) > 0 &&
        compareVersions(release.version, target) <= 0
      );
    })
    .sort((left, right) => compareVersions(right.version, left.version));
}

function releaseBodyFor(
  changelogs: UpdateChangelogs,
  locale: string,
): string | undefined {
  return (
    changelogs[locale as UpdateChangelogLocale] ??
    (locale.startsWith("zh") ? changelogs["zh-CN"] : undefined) ??
    changelogs["en-US"] ??
    changelogs["zh-CN"]
  );
}

/** The notes to show in the given interface language. */
export function updateChangelogFor(
  update: PineUpdateInfo,
  locale: string,
): string {
  if (update.releases && update.releases.length > 0) {
    return update.releases
      .map((release) => {
        const heading = release.date
          ? `## ${release.version} · ${release.date}`
          : `## ${release.version}`;
        const body = releaseBodyFor(release.changelogs, locale);
        return body ? `${heading}\n\n${body}` : heading;
      })
      .join("\n\n");
  }
  return (
    update.changelogs?.[locale as UpdateChangelogLocale] ?? update.changelog
  );
}

export type UpdateCheckResult =
  | { status: "available"; update: PineUpdateInfo }
  | { status: "current" | "unconfigured" | "unsupported" };

export interface DownloadUpdateResult {
  ready: boolean;
}

export interface InstallUpdateResult {
  started: boolean;
}

export type PineUpdateEvent =
  | {
      percent: number;
      totalBytes: number;
      transferredBytes: number;
      type: "download-progress";
    }
  | { type: "download-ready" }
  | { message: string; type: "error" };

export type UpdateEventListener = (event: PineUpdateEvent) => void;
