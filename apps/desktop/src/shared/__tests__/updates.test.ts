import { describe, expect, it } from "vitest";
import { updateChangelogFor, type PineUpdateInfo } from "../updates";

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
