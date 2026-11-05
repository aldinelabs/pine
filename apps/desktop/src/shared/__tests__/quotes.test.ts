import { describe, expect, it } from "vitest";
import { serializeAttachmentMessage } from "../attachments";
import {
  MAX_QUOTE_LENGTH,
  normalizeQuoteText,
  parseQuoteMessage,
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
});
