import { describe, expect, it } from "vitest";
import {
  PROMPT_REWRITE_MESSAGE_LENGTH,
  PROMPT_REWRITE_RECENT_TURNS,
  promptRewriteConversation,
  type PromptRewriteMessage,
} from "../promptRewrite";

function user(text: string): PromptRewriteMessage {
  return { role: "user", text };
}

function agent(text: string): PromptRewriteMessage {
  return { role: "assistant", text };
}

/** `count` turns: a request, a progress note and a final reply each. */
function turns(count: number): PromptRewriteMessage[] {
  return Array.from({ length: count }, (_, index) => [
    user(`request ${index}`),
    agent(`working on ${index}`),
    agent(`reply ${index}`),
  ]).flat();
}

describe("promptRewriteConversation", () => {
  it("keeps a short conversation's turns with each final reply", () => {
    expect(
      promptRewriteConversation([
        user(" goal "),
        agent("looking"),
        agent(""),
        agent("done"),
      ]),
    ).toEqual({
      conversation: [user("goal"), agent("done")],
      trimmed: false,
    });
  });

  it("keeps the opening request and the latest turns of a long one", () => {
    const { conversation, trimmed } = promptRewriteConversation(turns(10));
    expect(trimmed).toBe(true);
    expect(conversation).toEqual([
      user("request 0"),
      ...Array.from({ length: PROMPT_REWRITE_RECENT_TURNS }, (_, offset) => {
        const index = 10 - PROMPT_REWRITE_RECENT_TURNS + offset;
        return [user(`request ${index}`), agent(`reply ${index}`)];
      }).flat(),
    ]);
  });

  it("is not trimmed when only the opening turn's reply is left out", () => {
    const { conversation, trimmed } = promptRewriteConversation(
      turns(PROMPT_REWRITE_RECENT_TURNS + 1),
    );
    expect(trimmed).toBe(false);
    expect(conversation[0]).toEqual(user("request 0"));
    expect(conversation[1]).toEqual(user("request 1"));
  });

  it("cuts only an unusually long message, keeping its start and end", () => {
    const long = `START${"x".repeat(10_000)}END`;
    const [message] = promptRewriteConversation([user(long)]).conversation;
    expect(message?.text.length).toBeLessThanOrEqual(
      PROMPT_REWRITE_MESSAGE_LENGTH,
    );
    expect(message?.text.startsWith("START")).toBe(true);
    expect(message?.text.endsWith("END")).toBe(true);
    expect(message?.text).toContain("…[truncated]…");
  });
});
