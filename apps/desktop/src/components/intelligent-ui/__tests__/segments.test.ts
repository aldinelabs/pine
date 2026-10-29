import { describe, expect, it } from "vitest";
import { splitTranscriptText } from "../segments";

describe("splitTranscriptText", () => {
  it("keeps plain markdown as one segment", () => {
    expect(splitTranscriptText("Hello\n\n```ts\nconst a = 1;\n```")).toEqual([
      { kind: "markdown", text: "Hello\n\n```ts\nconst a = 1;\n```" },
    ]);
  });

  it("pulls openui fences out between markdown segments", () => {
    expect(
      splitTranscriptText(
        "Before\n```openui\nroot = Stack([])\n```\nAfter\n```OpenUI extra\nroot = Card([])\n```",
      ),
    ).toEqual([
      { kind: "markdown", text: "Before" },
      { kind: "interface", code: "root = Stack([])", closed: true },
      { kind: "markdown", text: "After" },
      { kind: "interface", code: "root = Card([])", closed: true },
    ]);
  });

  it("marks a fence that is still streaming as open", () => {
    expect(splitTranscriptText("Here:\n```openui\nroot = Sta")).toEqual([
      { kind: "markdown", text: "Here:" },
      { kind: "interface", code: "root = Sta", closed: false },
    ]);
  });

  it("leaves openui fences quoted inside another fence alone", () => {
    const text =
      "````markdown\n```openui\nroot = Stack([])\n```\n````\n~~~openui\nroot = Stack([])\n~~~";
    expect(splitTranscriptText(text)).toEqual([{ kind: "markdown", text }]);
  });

  it("only closes a fence with a long enough bare marker", () => {
    expect(
      splitTranscriptText(
        '````openui\nroot = Stack([a])\n```\na = Text("x")\n````',
      ),
    ).toEqual([
      {
        kind: "interface",
        code: 'root = Stack([a])\n```\na = Text("x")',
        closed: true,
      },
    ]);
  });
});
