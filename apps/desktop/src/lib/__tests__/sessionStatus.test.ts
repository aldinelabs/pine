import { describe, expect, it } from "vitest";
import { isAwaitingFirstResponse } from "../sessionStatus";

type Message = Parameters<typeof isAwaitingFirstResponse>[0][number];

function user(): Message {
  return {
    role: "user",
    status: "complete",
    blocks: [{ type: "text", text: "hi" }],
  };
}

function assistant(
  status: Message["status"],
  blocks: Message["blocks"] = [],
): Message {
  return { role: "assistant", status, blocks };
}

describe("isAwaitingFirstResponse", () => {
  it("is false when not running or with no messages", () => {
    expect(isAwaitingFirstResponse([user()], false)).toBe(false);
    expect(isAwaitingFirstResponse([], true)).toBe(false);
  });

  it("is true while the user's message is the tail", () => {
    expect(isAwaitingFirstResponse([user()], true)).toBe(true);
    expect(
      isAwaitingFirstResponse([user(), assistant("complete"), user()], true),
    ).toBe(true);
  });

  it("is true for an empty streaming reply right after the user's message", () => {
    expect(
      isAwaitingFirstResponse([user(), assistant("streaming")], true),
    ).toBe(true);
  });

  it("is false once the reply has any content", () => {
    for (const block of [
      { type: "thinking", thinking: "Let me see" },
      { type: "text", text: "Sure" },
      { type: "toolCall" },
      { type: "error" },
    ])
      expect(
        isAwaitingFirstResponse(
          [user(), assistant("streaming", [block])],
          true,
        ),
      ).toBe(false);
  });

  it("is true while the reply has only blank thinking or text", () => {
    expect(
      isAwaitingFirstResponse(
        [
          user(),
          assistant("streaming", [
            { type: "thinking", thinking: "" },
            { type: "text", text: "  \n" },
          ]),
        ],
        true,
      ),
    ).toBe(true);
  });

  it("is false for a complete reply", () => {
    expect(isAwaitingFirstResponse([user(), assistant("complete")], true)).toBe(
      false,
    );
  });

  it("is false for an empty reply after a tool turn", () => {
    expect(
      isAwaitingFirstResponse(
        [
          user(),
          assistant("complete", [{ type: "toolCall" }]),
          assistant("streaming"),
        ],
        true,
      ),
    ).toBe(false);
  });
});
