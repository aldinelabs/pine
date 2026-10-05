import { describe, expect, it } from "vitest";
import {
  extractChangelogSection,
  extractReleaseChangelogs,
  formatBilingualChangelog,
  isReleaseVersion,
} from "../changelog";

describe("release changelog", () => {
  it("extracts one dated release without including the next release", () => {
    const changelog = `# Changelog

## [Unreleased]

## [1.2.0] - 2026-09-10

### Added

- New release flow.

## [1.1.0] - 2026-08-01

- Older entry.
`;

    expect(extractChangelogSection(changelog, "1.2.0")).toEqual({
      body: "### Added\n\n- New release flow.",
      date: "2026-09-10",
      version: "1.2.0",
    });
  });

  it("rejects missing, undated, and empty release sections", () => {
    expect(() => extractChangelogSection("# Changelog\n", "1.0.0")).toThrow(
      "no release section",
    );
    expect(() =>
      extractChangelogSection("## [1.0.0]\n\n- Entry\n", "1.0.0"),
    ).toThrow("must include a release date");
    expect(() =>
      extractChangelogSection(
        "## [1.0.0] - 2026-09-10\n\n## [0.9.0] - 2026-08-01\n",
        "1.0.0",
      ),
    ).toThrow("is empty");
  });

  it("accepts semantic release versions", () => {
    expect(isReleaseVersion("1.2.3")).toBe(true);
    expect(isReleaseVersion("1.2.3-rc.1+build.4")).toBe(true);
    expect(isReleaseVersion("26w36a")).toBe(false);
  });

  it("extracts one release from the Chinese and English changelogs", () => {
    const changelogs = extractReleaseChangelogs(
      {
        "zh-CN": "## [1.2.0] - 2026-09-10\n\n### 新增\n\n- 新的发布流程。\n",
        "en-US":
          "## [1.2.0] - 2026-09-10\n\n### Added\n\n- New release flow.\n",
      },
      "1.2.0",
    );
    expect(changelogs).toEqual({
      "zh-CN": "### 新增\n\n- 新的发布流程。",
      "en-US": "### Added\n\n- New release flow.",
    });
    expect(formatBilingualChangelog(changelogs)).toBe(
      "## 中文\n\n### 新增\n\n- 新的发布流程。\n\n## English\n\n### Added\n\n- New release flow.",
    );
  });

  it("rejects a release whose languages disagree", () => {
    const en = "## [1.2.0] - 2026-09-10\n\n- One.\n- Two.\n";
    expect(() =>
      extractReleaseChangelogs(
        { "zh-CN": "# 更新日志\n", "en-US": en },
        "1.2.0",
      ),
    ).toThrow("CHANGELOG.zh-CN.md has no release section for 1.2.0");
    expect(() =>
      extractReleaseChangelogs(
        { "zh-CN": "## [1.2.0] - 2026-09-11\n\n- 一。\n- 二。\n", "en-US": en },
        "1.2.0",
      ),
    ).toThrow("different dates");
    expect(() =>
      extractReleaseChangelogs(
        { "zh-CN": "## [1.2.0] - 2026-09-10\n\n- 一。\n", "en-US": en },
        "1.2.0",
      ),
    ).toThrow("has 1 entries for 1.2.0, but CHANGELOG.md has 2");
  });
});
