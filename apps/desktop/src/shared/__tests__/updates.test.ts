import { describe, expect, it } from "vitest";
import {
  releaseNotesBetween,
  updateChangelogFor,
  type PineReleaseNotes,
  type PineUpdateInfo,
} from "../updates";

const update: PineUpdateInfo = {
  changelog: "## 中文\n\n- 更新。\n\n## English\n\n- Updates.",
  changelogs: { "zh-CN": "- 更新。", "en-US": "- Updates." },
  internalVersion: "abc1234",
  publishedAt: "2026-10-05T00:00:00.000Z",
  version: "1.2.0",
};

describe("updateChangelogFor", () => {
  it("shows the notes in the interface language", () => {
    expect(updateChangelogFor(update, "zh-CN")).toBe("- 更新。");
    expect(updateChangelogFor(update, "en-US")).toBe("- Updates.");
  });

  it("falls back to the combined notes", () => {
    expect(
      updateChangelogFor({ ...update, changelogs: undefined }, "zh-CN"),
    ).toBe(update.changelog);
    expect(
      updateChangelogFor(
        { ...update, changelogs: { "en-US": "- Updates." } },
        "zh-CN",
      ),
    ).toBe(update.changelog);
  });
});

const history: PineReleaseNotes[] = [
  { changelogs: { "en-US": "- Twenty." }, version: "0.20.0" },
  { changelogs: { "en-US": "- RC." }, version: "0.20.0-rc.1" },
  { changelogs: { "en-US": "- Nineteen one." }, version: "0.19.1" },
  { changelogs: { "en-US": "- Nineteen." }, version: "0.19.0" },
  { changelogs: { "en-US": "- Eighteen." }, version: "0.18.0" },
  { changelogs: { "en-US": "- Nine." }, version: "0.9.0" },
];

describe("releaseNotesBetween", () => {
  it("keeps the versions after the installed one up to the target", () => {
    expect(
      releaseNotesBetween(history, "0.18.0", "0.20.0").map((r) => r.version),
    ).toEqual(["0.20.0", "0.19.1", "0.19.0"]);
  });

  it("orders by SemVer, not by string or input order", () => {
    expect(
      releaseNotesBetween([...history].reverse(), "0.8.0", "0.19.0").map(
        (r) => r.version,
      ),
    ).toEqual(["0.19.0", "0.18.0", "0.9.0"]);
  });

  it("includes prereleases only when updating to one", () => {
    expect(
      releaseNotesBetween(history, "0.19.1", "0.20.0").map((r) => r.version),
    ).toEqual(["0.20.0"]);
    expect(
      releaseNotesBetween(history, "0.19.1", "0.20.0-rc.1").map(
        (r) => r.version,
      ),
    ).toEqual(["0.20.0-rc.1"]);
    // From a prerelease to its stable release.
    expect(
      releaseNotesBetween(history, "0.20.0-rc.1", "0.20.0").map(
        (r) => r.version,
      ),
    ).toEqual(["0.20.0"]);
  });
});

describe("updateChangelogFor with a version range", () => {
  const ranged: PineUpdateInfo = {
    ...update,
    releases: [
      {
        changelogs: { "zh-CN": "- 二十。", "en-US": "- Twenty." },
        date: "2026-11-14",
        version: "0.20.0",
      },
      { changelogs: { "en-US": "- Nineteen." }, version: "0.19.0" },
    ],
  };

  it("gives each version a heading, newest first", () => {
    expect(updateChangelogFor(ranged, "en-US")).toBe(
      "## 0.20.0 · 2026-11-14\n\n- Twenty.\n\n## 0.19.0\n\n- Nineteen.",
    );
  });

  it("falls back per version to a related or the English notes", () => {
    expect(updateChangelogFor(ranged, "zh-TW")).toBe(
      "## 0.20.0 · 2026-11-14\n\n- 二十。\n\n## 0.19.0\n\n- Nineteen.",
    );
    expect(updateChangelogFor(ranged, "ja-JP")).toContain("- Twenty.");
  });
});
