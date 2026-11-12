import { describe, expect, it } from "vitest";
import { escapeProseDollarDelimiters } from "../escapeProseDollarDelimiters";

describe("escapeProseDollarDelimiters", () => {
  it("returns a source without dollars unchanged", () => {
    const source = "Plain prose with `code` and **bold** text.";
    expect(escapeProseDollarDelimiters(source)).toBe(source);
  });

  it("escapes a currency pair that wraps prose", () => {
    expect(escapeProseDollarDelimiters("It costs $5 and then $10 more.")).toBe(
      "It costs \\$5 and then $10 more.",
    );
  });

  it("keeps a real inline formula", () => {
    const source = "The area is $a^2$.";
    expect(escapeProseDollarDelimiters(source)).toBe(source);
  });
});
