import { describe, expect, it } from "vitest";
import { isAwaitingFirstResponse } from "../sessionStatus";

type Message = Parameters<typeof isAwaitingFirstResponse>[0][number];

function user(): Message {
  return { role: "user", status: "complete", blocks: [{ type: "text" }] };
}

function assistant(
  status: Message["status"],
  blocks: readonly unknown[] = [],
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
    for (const type of ["thinking", "text", "toolCall", "error"])
      expect(
        isAwaitingFirstResponse(
          [user(), assistant("streaming", [{ type }])],
          true,
        ),
      ).toBe(false);
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
