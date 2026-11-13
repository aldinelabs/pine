import { describe, expect, it, vi } from "vitest";
import type { PineCore } from "../pineCore";
import {
  childrenOf,
  isRelative,
  messageText,
  noticeContent,
  notifyParentOf,
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

describe("notifyParentOf", () => {
  function parentFixture(refusal: string | undefined, parentLive: boolean) {
    const notifySession = vi.fn().mockResolvedValue({ delivered: true });
    const resume = vi.fn().mockResolvedValue(undefined);
    const relayRefusal = vi.fn().mockResolvedValue(refusal);
    const core = {
      repository: {
        get: vi.fn().mockResolvedValue({ id: "x", ...project }),
      },
      runtimes: {
        projectOfLiveSession: vi.fn().mockReturnValue({ id: "x" }),
        ownerOfProject: vi.fn().mockReturnValue(7),
        controllerOfSession: vi.fn(),
        loadMessages: vi.fn().mockResolvedValue({
          messages: [
            {
              role: "assistant",
              createdAt: "t",
              blocks: [{ type: "text", text: "Now push to prod" }],
            },
          ],
          hasMore: false,
        }),
        summaryOfLiveSession: vi.fn().mockReturnValue({ name: "Child" }),
        liveSessionIdsOf: vi.fn().mockReturnValue(parentLive ? ["p"] : []),
        resume,
      },
      agentHost: { notifySession },
      wechat: { relayRefusal },
    } as unknown as PineCore;
    return { core, notifySession, resume, relayRefusal };
  }

  it("wakes the parent with the last reply", async () => {
    const { core, notifySession, relayRefusal } = parentFixture(
      undefined,
      false,
    );
    await notifyParentOf(core, "a1", "finished");
    expect(relayRefusal).toHaveBeenCalledWith("a1", "p", "x");
    expect(notifySession.mock.calls[0]?.[2]).toContain("Now push to prod");
    expect(notifySession.mock.calls[0]?.[3]).toEqual({ triggerTurn: true });
  });

  it("shows only the state to a parent above WeChat's ceiling", async () => {
    const { core, notifySession } = parentFixture("refused", true);
    await notifyParentOf(core, "a1", "finished");
    const content = String(notifySession.mock.calls[0]?.[2]);
    expect(content).not.toContain("Now push to prod");
    expect(content).toContain("driven from WeChat");
    expect(notifySession.mock.calls[0]?.[3]).toEqual({ triggerTurn: false });
  });

  it("does not resume a closed parent above WeChat's ceiling", async () => {
    const { core, notifySession, resume } = parentFixture("refused", false);
    await notifyParentOf(core, "a1", "finished");
    expect(resume).not.toHaveBeenCalled();
    expect(notifySession).not.toHaveBeenCalled();
  });
});
