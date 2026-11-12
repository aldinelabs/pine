import { describe, expect, it } from "vitest";
import { PINE_USER_TITLE_ENTRY, isUserChosenTitle } from "../sessions";

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
