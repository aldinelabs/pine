export const CHECK_FOR_UPDATE_CHANNEL = "update:check" as const;
export const DOWNLOAD_UPDATE_CHANNEL = "update:download" as const;
export const INSTALL_UPDATE_CHANNEL = "update:install" as const;
export const UPDATE_EVENT_CHANNEL = "update:event" as const;

export const UPDATE_CHANGELOG_LOCALES = ["zh-CN", "en-US"] as const;
export type UpdateChangelogLocale = (typeof UPDATE_CHANGELOG_LOCALES)[number];

export interface PineUpdateInfo {
  /** Notes in every language, for versions without per-language notes. */
  changelog: string;
  /** Notes per interface language, from releases that publish them. */
  changelogs?: Partial<Record<UpdateChangelogLocale, string>>;
  internalVersion: string;
  publishedAt: string;
  version: string;
}

/** The notes to show in the given interface language. */
export function updateChangelogFor(
  update: PineUpdateInfo,
  locale: string,
): string {
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
