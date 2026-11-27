import { describe, expect, it, vi } from "vitest";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../shared/projects";
import type { PineProject } from "../../../shared/projects";
import type { PineCore } from "../pineCore";
import {
  childrenOf,
  deleteSessionWithChildren,
  isRelative,
  localParentOf,
  messageText,
  noticeContent,
  notifyParentOf,
  parentProjectOf,
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

  it("keeps a parent in another project out of the session's relatives", () => {
    const dispatched = {
      id: "x",
      sessionParents: { d1: "o", d2: "o" },
      sessionParentProjects: { d1: "n", d2: "n" },
    };
    expect(localParentOf(dispatched, "d1")).toBeUndefined();
    expect(parentProjectOf(dispatched, "d1")).toBe("n");
    expect(parentProjectOf(dispatched, "a1")).toBe("x");
    expect(relativesOf(dispatched, "d1")).toEqual({
      children: [],
      siblings: [],
    });
    expect(isRelative(dispatched, "d1", "d2")).toBe(false);
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
    expect(content).toContain("before relying on it");
  });

  it("tells the parent the user stopped it and to ask before acting", () => {
    const content = noticeContent(
      { sessionId: "a1", projectId: "x", state: "stopped" },
      "Half a",
    );
    expect(content).toContain("<status>stopped</status>");
    expect(content).toContain("<last-reply>Half a</last-reply>");
    expect(content).toContain(
      "The user stopped this sub-session's turn themselves",
    );
    expect(content).toContain("Do not continue, retry or redo its work");
    expect(content).toContain("briefly ask the user what they want next");
    expect(content).not.toContain("ui_session_send to give it follow-up work");
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
    const sessionRelayed = vi.fn().mockResolvedValue(undefined);
    const relay = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({ id: "x", ...project });
    const isConversation = vi.fn().mockResolvedValue(false);
    const core = {
      repository: { get },
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
      wechat: { relayRefusal, sessionRelayed },
      assistant: { isConversation, relay },
    } as unknown as PineCore;
    return {
      core,
      notifySession,
      resume,
      relayRefusal,
      sessionRelayed,
      relay,
      get,
      isConversation,
    };
  }

  it("wakes the parent with the last reply", async () => {
    const { core, notifySession, relayRefusal, sessionRelayed } = parentFixture(
      undefined,
      false,
    );
    await notifyParentOf(core, "a1", "finished");
    expect(relayRefusal).toHaveBeenCalledWith("a1", "p", "x");
    expect(sessionRelayed).toHaveBeenCalledWith("a1", "p", "x");
    expect(notifySession.mock.calls[0]?.[2]).toContain("Now push to prod");
    expect(notifySession.mock.calls[0]?.[3]).toEqual({ triggerTurn: true });
  });

  it("shows only the state to a parent above WeChat's ceiling", async () => {
    const { core, notifySession, sessionRelayed } = parentFixture(
      "refused",
      true,
    );
    await notifyParentOf(core, "a1", "finished");
    expect(sessionRelayed).not.toHaveBeenCalled();
    const content = String(notifySession.mock.calls[0]?.[2]);
    expect(content).not.toContain("Now push to prod");
    expect(content).toContain("driven from WeChat");
    expect(notifySession.mock.calls[0]?.[3]).toEqual({ triggerTurn: false });
  });

  it("leaves the Orchestrator to relay the result of a session it dispatched", async () => {
    const { core, notifySession, relay, get, isConversation } = parentFixture(
      undefined,
      false,
    );
    get.mockResolvedValue({
      id: "x",
      name: "Blog",
      sessionParents: { a1: "p" },
      sessionParentProjects: { a1: TEMPORARY_WORKSPACE_PROJECT_ID },
    });
    isConversation.mockResolvedValue(true);

    await notifyParentOf(core, "a1", "finished");

    expect(isConversation).toHaveBeenCalledWith(
      "p",
      TEMPORARY_WORKSPACE_PROJECT_ID,
    );
    expect(relay).toHaveBeenCalledWith(
      "p",
      { sessionId: "a1", projectId: "x", state: "finished", title: "Child" },
      expect.stringContaining("<project>Blog (x)</project>"),
    );
    const content = String(relay.mock.calls[0]?.[2]);
    expect(content).toContain("<last-reply>Now push to prod</last-reply>");
    expect(content).toContain("Tell the user the outcome now");
    expect(notifySession).not.toHaveBeenCalled();
  });

  it("does not resume a closed parent above WeChat's ceiling", async () => {
    const { core, notifySession, resume } = parentFixture("refused", false);
    await notifyParentOf(core, "a1", "finished");
    expect(resume).not.toHaveBeenCalled();
    expect(notifySession).not.toHaveBeenCalled();
  });
});

describe("deleteSessionWithChildren", () => {
  it("unlinks, never deletes, what an Orchestrator conversation dispatched", async () => {
    const blog = {
      id: "b",
      sessionParents: { d1: "o", other: "q" },
      sessionParentProjects: { d1: TEMPORARY_WORKSPACE_PROJECT_ID },
    } as unknown as PineProject;
    const noProject = {
      id: TEMPORARY_WORKSPACE_PROJECT_ID,
      sessionParents: {},
    } as unknown as PineProject;
    const deleteSession = vi.fn().mockResolvedValue(true);
    let parents: Record<string, string> = { ...blog.sessionParents };
    const updateSessionParents = vi.fn(
      (_id: string, change: (value: Record<string, string>) => object) => {
        parents = change(parents) as Record<string, string>;
        return Promise.resolve();
      },
    );
    const notifySessionsDeleted = vi.fn();
    const core = {
      repository: {
        list: vi.fn().mockResolvedValue([noProject, blog]),
        updateSessionParents,
      },
      runtimes: { deleteSession },
      assistant: { isConversation: vi.fn().mockResolvedValue(true) },
      notifySessionsDeleted,
      notifyLibraryChanged: vi.fn(),
    } as unknown as PineCore;

    await expect(
      deleteSessionWithChildren(core, 7, noProject, "o"),
    ).resolves.toBe(true);

    expect(deleteSession).toHaveBeenCalledExactlyOnceWith(
      7,
      TEMPORARY_WORKSPACE_PROJECT_ID,
      "o",
    );
    expect(notifySessionsDeleted).toHaveBeenCalledWith(["o"]);
    expect(updateSessionParents).toHaveBeenCalledOnce();
    expect(updateSessionParents.mock.calls[0]?.[0]).toBe("b");
    expect(parents).toEqual({ other: "q" });
  });
});
