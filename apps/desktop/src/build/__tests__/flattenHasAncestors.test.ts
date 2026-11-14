import { describe, expect, it } from "vitest";
import {
  flattenHasAncestors,
  flattenHasAncestorsPlugin,
} from "../flattenHasAncestors";

describe("flattenHasAncestors", () => {
  it("moves a group-has ancestor test out of :is()", () => {
    expect(
      flattenHasAncestors(
        '.group-has-data-\\[slot\\=item-description\\]\\/item\\:self-start:is(:where(.group\\/item):has([data-slot="item-description"]) *)',
      ),
    ).toBe(
      ':where(.group\\/item):has([data-slot="item-description"]) .group-has-data-\\[slot\\=item-description\\]\\/item\\:self-start',
    );
  });

  it("keeps the subject's other conditions and pseudo-elements", () => {
    expect(
      flattenHasAncestors(
        '.a:is(:where(.group\\/c)[data-size="default"] *):is(:where(.group\\/c):has([data-slot="media"]) *)::after',
      ),
    ).toBe(
      ':where(.group\\/c):has([data-slot="media"]) .a:is(:where(.group\\/c)[data-size="default"] *)::after',
    );
  });

  it("keeps sibling combinators from peer-has variants", () => {
    expect(flattenHasAncestors(".b:is(:where(.peer):has(:checked) ~ *)")).toBe(
      ":where(.peer):has(:checked) ~ .b",
    );
  });

  it("rewrites only the compound that holds the test", () => {
    expect(
      flattenHasAncestors(
        ".list > .a:is(:where(.group\\/tab):has(:is(:focus-visible)) *) svg",
      ),
    ).toBe(".list > :where(.group\\/tab):has(:is(:focus-visible)) .a svg");
  });

  it("rewrites each selector in a list", () => {
    expect(
      flattenHasAncestors(
        ".a:is(:where(.g):has(> input) *), .b:is(:where(.g):has(> input) *)",
      ),
    ).toBe(":where(.g):has(> input) .a, :where(.g):has(> input) .b");
  });

  it("leaves other :is() and :has() selectors alone", () => {
    for (const selector of [
      ".a:is(.dark *):has(:is([aria-invalid=true]))",
      '.a:is(:where(.group\\/t)[data-spacing="0"] *):has([data-icon])',
      ".a:has(> textarea)",
      ".a:is(.b:has(.c) .d *)",
      ".x\\:is\\(\\:has\\(y\\)\\)",
      "html.vibrancy:has([data-slot=overlay]) .sidebar",
    ]) {
      expect(flattenHasAncestors(selector)).toBe(selector);
    }
  });

  it("updates PostCSS rules in place", () => {
    const rule = { selector: ".a:is(:where(.g):has(.b) *)" };
    flattenHasAncestorsPlugin().Rule(rule);
    expect(rule.selector).toBe(":where(.g):has(.b) .a");
  });
});
