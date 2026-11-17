import { describe, expect, it } from "vitest";
import {
  PINE_TITLE_SUGGESTION_ENTRY,
  PINE_TITLE_SUGGESTION_REPLY_ENTRY,
  PINE_USER_TITLE_ENTRY,
  isUserChosenTitle,
  titleSuggestionFromEntries,
} from "../sessions";

const marker = (name: string) => ({
  type: "custom",
  customType: PINE_USER_TITLE_ENTRY,
  data: { name },
});

describe("isUserChosenTitle", () => {
  it("is true while the title is the one the user last chose", () => {
    const entries = [marker("Old"), { type: "message" }, marker("Mine")];

    expect(isUserChosenTitle(entries, "Mine")).toBe(true);
    expect(isUserChosenTitle(entries, "Old")).toBe(false);
  });

  it("is false for titles Pine or the agent set", () => {
    expect(isUserChosenTitle([{ type: "message" }], "Generated")).toBe(false);
    expect(isUserChosenTitle([marker("Mine")], undefined)).toBe(false);
  });
});

describe("titleSuggestionFromEntries", () => {
  const suggestion = (name: string) => ({
    type: "custom",
    customType: PINE_TITLE_SUGGESTION_ENTRY,
    data: { name },
  });
  const reply = (value: "dismiss" | "never") => ({
    type: "custom",
    customType: PINE_TITLE_SUGGESTION_REPLY_ENTRY,
    data: { reply: value },
  });

  it("keeps the newest suggestion open until the user answers", () => {
    expect(
      titleSuggestionFromEntries([
        marker("Mine"),
        suggestion("First"),
        suggestion("Second"),
      ]),
    ).toEqual({ suggestion: "Second", declined: false });
  });

  it("settles a suggestion on Not now or a user rename", () => {
    expect(
      titleSuggestionFromEntries([suggestion("Idea"), reply("dismiss")]),
    ).toEqual({ suggestion: undefined, declined: false });
    expect(
      titleSuggestionFromEntries([suggestion("Idea"), marker("Idea")]),
    ).toEqual({ suggestion: undefined, declined: false });
  });

  it("stays declined for good after Don't suggest again", () => {
    expect(
      titleSuggestionFromEntries([
        suggestion("Idea"),
        reply("never"),
        suggestion("Later"),
      ]),
    ).toEqual({ declined: true });
  });
});
