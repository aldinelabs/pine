import { describe, expect, it } from "vitest";
import {
  childrenOf,
  isRelative,
  messageText,
  noticeContent,
  relativesOf,
} from "../subSessions";

const project = {
  sessionParents: { a1: "p", a2: "p", b1: "q" },
};

describe("sub-session links", () => {
  it("finds children, parent and siblings", () => {
    expect(childrenOf(project, "p")).toEqual(["a1", "a2"]);
    expect(relativesOf(project, "a1")).toEqual({
      parent: "p",
      children: [],
      siblings: ["a2"],
    });
    expect(relativesOf(project, "p")).toEqual({
      children: ["a1", "a2"],
      siblings: [],
    });
  });

  it("reaches relatives only", () => {
    expect(isRelative(project, "a1", "a2")).toBe(true);
    expect(isRelative(project, "a1", "p")).toBe(true);
    expect(isRelative(project, "p", "a2")).toBe(true);
    expect(isRelative(project, "a1", "b1")).toBe(false);
    expect(isRelative(project, "p", "q")).toBe(false);
  });
});

describe("messageText", () => {
  it("keeps words and names tool calls", () => {
    expect(
      messageText([
        { type: "text", text: "Looking" },
        {
          type: "toolCall",
          toolCall: { id: "t", name: "bash", arguments: {} },
        } as never,
        { type: "stopped" } as never,
      ]),
    ).toBe("Looking\n[tool bash]\n[stopped]");
  });
});

describe("noticeContent", () => {
  it("escapes the reply and guides the parent", () => {
    const content = noticeContent(
      { sessionId: "a1", projectId: "x", title: "A <b>", state: "finished" },
      "1 < 2",
    );
    expect(content).toContain("<title>A &lt;b&gt;</title>");
    expect(content).toContain("<last-reply>1 &lt; 2</last-reply>");
    expect(content).toContain("Do not poll it");
  });

  it("asks the parent to tell the user about an approval", () => {
    const content = noticeContent(
      { sessionId: "a1", projectId: "x", state: "awaiting-approval" },
      "",
    );
    expect(content).not.toContain("<last-reply>");
    expect(content).toContain("Tell the user if they need to act.");
  });
});
