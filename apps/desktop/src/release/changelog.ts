export interface ChangelogSection {
  body: string;
  date?: string;
  version: string;
}

const RELEASE_HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/;

export function isReleaseVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    version,
  );
}

export function extractChangelogSection(
  changelog: string,
  version: string,
  fileName = "CHANGELOG.md",
): ChangelogSection {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  let date: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const match = RELEASE_HEADING.exec(lines[index]);
    if (match?.[1] === version) {
      start = index + 1;
      date = match[2];
      break;
    }
  }

  if (start === -1) {
    throw new Error(`${fileName} has no release section for ${version}`);
  }
  if (date === undefined) {
    throw new Error(
      `${fileName} section ${version} must include a release date`,
    );
  }

  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (RELEASE_HEADING.test(lines[index])) {
      end = index;
      break;
    }
  }

  const body = lines.slice(start, end).join("\n").trim();
  if (body.length === 0) {
    throw new Error(`${fileName} section ${version} is empty`);
  }

  return { body, date, version };
}

/** Each release is written once per language, in a changelog file of its own. */
export const CHANGELOG_FILES = {
  "zh-CN": "CHANGELOG.zh-CN.md",
  "en-US": "CHANGELOG.md",
} as const;

export type ChangelogLocale = keyof typeof CHANGELOG_FILES;
export type ReleaseChangelogs = Record<ChangelogLocale, string>;

const ENTRY = /^- /;

function countEntries(body: string): number {
  return body.split("\n").filter((line) => ENTRY.test(line)).length;
}

/**
 * The release's notes in every language. Both changelogs must have a dated
 * section for the version, with the same number of entries, so one language
 * cannot silently fall behind the other.
 */
export function extractReleaseChangelogs(
  changelogs: ReleaseChangelogs,
  version: string,
): ReleaseChangelogs {
  const zh = extractChangelogSection(
    changelogs["zh-CN"],
    version,
    CHANGELOG_FILES["zh-CN"],
  );
  const en = extractChangelogSection(
    changelogs["en-US"],
    version,
    CHANGELOG_FILES["en-US"],
  );
  if (zh.date !== en.date) {
    throw new Error(
      `${CHANGELOG_FILES["zh-CN"]} and ${CHANGELOG_FILES["en-US"]} give ${version} different dates`,
    );
  }
  const zhEntries = countEntries(zh.body);
  const enEntries = countEntries(en.body);
  if (zhEntries !== enEntries) {
    throw new Error(
      `${CHANGELOG_FILES["zh-CN"]} has ${zhEntries} entries for ${version}, but ${CHANGELOG_FILES["en-US"]} has ${enEntries}`,
    );
  }
  return { "zh-CN": zh.body, "en-US": en.body };
}

/** Release notes for readers of either language: all Chinese, then all English. */
export function formatBilingualChangelog(
  changelogs: ReleaseChangelogs,
): string {
  return [
    "## 中文",
    "",
    changelogs["zh-CN"],
    "",
    "## English",
    "",
    changelogs["en-US"],
  ].join("\n");
}
