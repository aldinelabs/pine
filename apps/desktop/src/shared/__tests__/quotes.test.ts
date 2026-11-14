import { describe, expect, it } from "vitest";
import { serializeAttachmentMessage } from "../attachments";
import {
  MAX_QUOTE_LENGTH,
  isSameQuote,
  normalizeQuoteText,
  parseQuoteMessage,
  quoteSourceLabel,
  serializeQuoteMessage,
} from "../quotes";
import { parseMessageBlocks } from "../sessions";

describe("quote messages", () => {
  it("round-trips quotes ahead of the prompt", () => {
    const quotes = [{ text: "first\nline", role: "assistant" as const }];
    const message = serializeQuoteMessage(quotes, "  why?  ");
    expect(parseQuoteMessage(message)).toEqual({ quotes, prompt: "why?" });
  });

  it("leaves a message without quotes alone", () => {
    expect(serializeQuoteMessage([], " hi ")).toBe("hi");
    expect(parseQuoteMessage("hi")).toEqual({ quotes: [], prompt: "hi" });
  });

  it("keeps a malformed block as prompt text", () => {
    const message = '<pine_quotes version="1">\nnot json\n</pine_quotes>';
    expect(parseQuoteMessage(message)).toEqual({ quotes: [], prompt: message });
  });

  it("parses quotes after attachments into their own block", () => {
    const message = serializeAttachmentMessage(
      [],
      serializeQuoteMessage([{ text: "passage" }], "explain"),
    );
    expect(parseMessageBlocks({ role: "user", content: message })).toEqual([
      { type: "quotes", quotes: [{ text: "passage" }] },
      { type: "text", text: "explain" },
    ]);
  });

  it("trims and caps a selection", () => {
    expect(normalizeQuoteText("  \r\n ")).toBeUndefined();
    expect(normalizeQuoteText(" a\r\nb ")).toBe("a\nb");
    expect(normalizeQuoteText("x".repeat(MAX_QUOTE_LENGTH + 5))).toHaveLength(
      MAX_QUOTE_LENGTH + 1,
    );
  });

  it("round-trips a preview comment as plain JSON fields", () => {
    const quotes = [
      {
        text: "const a = 1;",
        file: "/repo/src/a.ts",
        lines: "12-18",
        comment: "Rename this",
      },
      {
        text: "old",
        file: "/repo/src/a.ts",
        comment: "Gone?",
        stale: true as const,
      },
    ];
    const message = serializeQuoteMessage(quotes, "");
    expect(message).toContain(
      '{"text":"const a = 1;","file":"/repo/src/a.ts","lines":"12-18","comment":"Rename this"}',
    );
    expect(parseQuoteMessage(message)).toEqual({ quotes, prompt: "" });
  });

  it.each([
    { file: "" },
    { lines: 12 },
    { comment: null },
    { comment: ["x"] },
    { stale: false },
  ])("rejects a quote with an invalid comment field %o", (field) => {
    const message = [
      '<pine_quotes version="1">',
      JSON.stringify({ quotes: [{ text: "passage", ...field }] }),
      "</pine_quotes>",
    ].join("\n");
    expect(parseQuoteMessage(message)).toEqual({
      quotes: [],
      prompt: message,
    });
  });

  it("labels where a comment points", () => {
    expect(
      quoteSourceLabel({ text: "a", file: "C:\\repo\\b.md", lines: "3" }),
    ).toBe("b.md:3");
    expect(quoteSourceLabel({ text: "a", file: "/repo/b.md" })).toBe("b.md");
    expect(quoteSourceLabel({ text: "a", lines: "3-4" })).toBe("3-4");
    expect(quoteSourceLabel({ text: "a" })).toBe("");
  });

  it("treats quotes as the same by text, file, and comment", () => {
    const quote = { text: "a", file: "/b.md", comment: "c" };
    expect(isSameQuote(quote, { ...quote, lines: "1" })).toBe(true);
    expect(isSameQuote(quote, { ...quote, comment: "d" })).toBe(false);
    expect(isSameQuote({ text: "a" }, { text: "a", role: "user" })).toBe(true);
  });
});
