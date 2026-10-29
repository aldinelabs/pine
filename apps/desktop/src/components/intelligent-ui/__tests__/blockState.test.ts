import { describe, expect, it } from "vitest";
import {
  interactionMessage,
  readBlockState,
  writeBlockState,
} from "../blockState";

describe("interactionMessage", () => {
  it("sends the text alone when the block has no values", () => {
    expect(interactionMessage("  Plan another day ", {})).toBe(
      "Plan another day",
    );
  });

  it("appends the block's current values", () => {
    expect(
      interactionMessage("Tailor my trip", {
        $pace: "Relaxed",
        $budget: 300,
        $kids: false,
        $notes: "",
        $stops: ["Alfama", "Belém"],
        field: { value: "wrapped", componentType: "Input" },
      }),
    ).toBe(
      'Tailor my trip\n\n(pace: Relaxed; budget: 300; kids: false; stops: ["Alfama","Belém"]; field: wrapped)',
    );
  });

  it("sends nothing for an empty message", () => {
    expect(interactionMessage(" ", { $pace: "Relaxed" })).toBe("");
  });
});

describe("block state", () => {
  it("keeps state per key and ignores blocks without one", () => {
    writeBlockState("message-1\ncode", { $done: true });
    writeBlockState(undefined, { $done: false });

    expect(readBlockState("message-1\ncode")).toEqual({ $done: true });
    expect(readBlockState(undefined)).toBeUndefined();
  });

  it("forgets the least recently written blocks past the limit", () => {
    writeBlockState("oldest", { $n: 0 });
    for (let index = 0; index < 200; index += 1) {
      writeBlockState(`block-${index}`, { $n: index });
    }

    expect(readBlockState("oldest")).toBeUndefined();
    expect(readBlockState("block-199")).toEqual({ $n: 199 });
  });
});
