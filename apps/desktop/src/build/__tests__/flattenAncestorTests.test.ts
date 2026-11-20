import { describe, expect, it } from "vitest";
import {
  flattenAncestorTests,
  flattenAncestorTestsPlugin,
} from "../flattenAncestorTests";

describe("flattenAncestorTests", () => {
  it("moves a group-has ancestor test out of :is()", () => {
    expect(
      flattenAncestorTests(
        '.group-has-data-\\[slot\\=item-description\\]\\/item\\:self-start:is(:where(.group\\/item):has([data-slot="item-description"]) *)',
      ),
    ).toBe(
      ':where(.group\\/item):has([data-slot="item-description"]) .group-has-data-\\[slot\\=item-description\\]\\/item\\:self-start',
    );
  });

  it("keeps the subject's other conditions and pseudo-elements", () => {
    expect(
      flattenAncestorTests(
        '.a:is(:where(.group\\/c)[data-size="default"] *):is(:where(.group\\/c):has([data-slot="media"]) *)::after',
      ),
    ).toBe(
      ':where(.group\\/c):has([data-slot="media"]) .a:is(:where(.group\\/c)[data-size="default"] *)::after',
    );
  });

  it("keeps sibling combinators from peer-has variants", () => {
    expect(flattenAncestorTests(".b:is(:where(.peer):has(:checked) ~ *)")).toBe(
      ":where(.peer):has(:checked) ~ .b",
    );
  });

  it("rewrites only the compound that holds the test", () => {
    expect(
      flattenAncestorTests(
        ".list > .a:is(:where(.group\\/tab):has(:is(:focus-visible)) *) svg",
      ),
    ).toBe(".list > :where(.group\\/tab):has(:is(:focus-visible)) .a svg");
  });

  it("rewrites each selector in a list", () => {
    expect(
      flattenAncestorTests(
        ".a:is(:where(.g):has(> input) *), .b:is(:where(.g):has(> input) *)",
      ),
    ).toBe(":where(.g):has(> input) .a, :where(.g):has(> input) .b");
  });

  it("moves group-data and peer-data tests out of :is()", () => {
    expect(
      flattenAncestorTests(
        '.group-data-\\[collapsible\\=offcanvas\\]\\:w-0:is(:where(.group)[data-collapsible="offcanvas"] *)',
      ),
    ).toBe(
      ':where(.group)[data-collapsible="offcanvas"] .group-data-\\[collapsible\\=offcanvas\\]\\:w-0',
    );
    expect(
      flattenAncestorTests(
        '.a:is(:where(.peer)[data-variant="inset"] ~ *):is(:where(.peer)[data-state="collapsed"] ~ *)',
      ),
    ).toBe(
      ':where(.peer)[data-variant="inset"] ~ .a:is(:where(.peer)[data-state="collapsed"] ~ *)',
    );
    expect(
      flattenAncestorTests(".a:is(.dark *):has(:is([aria-invalid=true]))"),
    ).toBe(".dark .a:has(:is([aria-invalid=true]))");
  });

  it("moves out one test per selector, preferring :has()", () => {
    // One group element may meet both tests; chaining them would require two.
    expect(
      flattenAncestorTests(
        '.a:is(:where(.group)[data-state="open"] *):is(:where(.group)[data-size="sm"] *)',
      ),
    ).toBe(
      ':where(.group)[data-state="open"] .a:is(:where(.group)[data-size="sm"] *)',
    );
  });

  it("leaves other :is() and :has() selectors alone", () => {
    for (const selector of [
      ".a:has(> textarea)",
      ".a:is(.b:has(.c) .d *)",
      ".x\\:is\\(\\:has\\(y\\)\\)",
      "html.vibrancy:has([data-slot=overlay]) .sidebar",
    ]) {
      expect(flattenAncestorTests(selector)).toBe(selector);
    }
  });

  it("updates PostCSS rules in place", () => {
    const rule = { selector: ".a:is(:where(.g):has(.b) *)" };
    flattenAncestorTestsPlugin().Rule(rule);
    expect(rule.selector).toBe(":where(.g):has(.b) .a");
  });
});
