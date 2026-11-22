import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/app/i18n";
import enUS from "../content/en-US";
import zhCN from "../content/zh-CN";
import {
  HELP_TOPIC_GROUPS,
  HELP_TOPIC_IDS,
  HELP_TOPIC_STEPS,
  helpContentLocale,
  isHelpTopicId,
  resolveHelpTopic,
} from "..";

describe("help content", () => {
  it.each([
    ["en-US", enUS],
    ["zh-CN", zhCN],
  ])("%s has text for every step of every topic", (_locale, content) => {
    for (const id of HELP_TOPIC_IDS) {
      const topic = content[id];
      expect(topic.steps).toHaveLength(HELP_TOPIC_STEPS[id].length);
      for (const step of topic.steps) {
        expect(step.title.trim()).not.toBe("");
        expect(step.body.length).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to Simplified Chinese for Traditional and English otherwise", () => {
    expect(helpContentLocale("zh-CN")).toBe("zh-CN");
    expect(helpContentLocale("zh-TW")).toBe("zh-CN");
    expect(helpContentLocale("ja-JP")).toBe("en-US");
    for (const locale of APP_LOCALES)
      expect(resolveHelpTopic("context-window", locale).steps).toHaveLength(
        HELP_TOPIC_STEPS["context-window"].length,
      );
  });

  it("pairs each step with its illustration", () => {
    const topic = resolveHelpTopic("approval-modes", "en-US");
    expect(topic.steps.map((step) => step.illustration)).toEqual(
      HELP_TOPIC_STEPS["approval-modes"],
    );
    expect(topic.locale).toBe("en-US");
  });

  it("lists every guide in exactly one overview group", () => {
    const grouped = HELP_TOPIC_GROUPS.flatMap((group) => group.topics);
    expect([...grouped].sort()).toEqual([...HELP_TOPIC_IDS].sort());
  });

  it("recognizes topic ids", () => {
    expect(isHelpTopicId("approval-modes")).toBe(true);
    expect(isHelpTopicId("nope")).toBe(false);
    expect(isHelpTopicId(3)).toBe(false);
  });
});
