import { expect, it } from "vitest";
import { extractPairingUrl } from "../pairingInput";

it("keeps a full pairing link", () => {
  const url = "https://remote.example.com/#pair=abc_DEF-123";
  expect(extractPairingUrl(`  ${url}\n`)).toBe(url);
});

it("finds the link inside surrounding text", () => {
  expect(
    extractPairingUrl("Pair here: https://r.test/#pair=abc123 thanks"),
  ).toBe("https://r.test/#pair=abc123");
});

it("accepts just the fragment", () => {
  expect(extractPairingUrl("#pair=abc123")).toMatch(/#pair=abc123$/);
});

it("passes other text through for the invalid-link notice", () => {
  expect(extractPairingUrl("  hello ")).toBe("hello");
});
