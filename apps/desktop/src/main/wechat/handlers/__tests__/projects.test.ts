// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../../shared/projects";
import type { ParsedCommand } from "../../types";
import { createTestContext, type TestContext } from "../../__tests__/fakes";
import { projectHandlers } from "../projects";

vi.mock("../../../recentSessions", () => ({
  listProjectSessions: vi.fn(() =>
    Promise.resolve([{ id: "a" }, { id: "b" }, { id: "c" }]),
  ),
}));

function setup() {
  const ctx = createTestContext();
  const { core } = ctx.fake;
  core.addProject(TEMPORARY_WORKSPACE_PROJECT_ID, { name: "Temporary" });
  core.addProject("p1", {
    name: "Pine",
    folders: [
      {
        id: "f1",
        name: "pine",
        path: "/Users/me/src/pine",
        access: "read-write",
        isAvailable: true,
      },
      {
        id: "f2",
        name: "docs",
        path: "/Users/me/src/docs",
        access: "read-only",
        isAvailable: true,
      },
    ],
  });
  core.addProject("p2", { name: "Pinecone" });
  return { ctx, core };
}

async function run(
  ctx: TestContext,
  options: Partial<Omit<ParsedCommand, "kind" | "name">> = {},
) {
  const handler = projectHandlers.projects;
  if (!handler) throw new Error("no handler");
  return handler(ctx, {
    kind: "command",
    name: "projects",
    args: [],
    ...options,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe(".projects", () => {
  it("lists projects with the temporary workspace last and no paths", async () => {
    const { ctx, core } = setup();
    const result = await run(ctx);
    expect(result.text).toBe(
      "- **1** Pine\n- **2** Pinecone\n- **3** No Project · current\n\n> Reply `.number` to switch",
    );
    expect(result.text).not.toContain("/Users");
    expect(result.numbered).toEqual({ kind: "project" });
    expect(core.runtimes.share).not.toHaveBeenCalled();
  });

  it("selects a project by number: folders by base name, current cleared", async () => {
    const { ctx, core } = setup();
    await ctx.sessions.setCurrent({ projectId: "p2", sessionId: "s1" });
    await run(ctx);
    ctx.handles.noteDelivered("project", ctx.now);
    const result = await run(ctx, { args: ["1"] });
    expect(result.text).toBe(
      "New sessions will start in: Pine (pine, docs (read-only); 3 sessions)",
    );
    expect(result.text).not.toContain("/Users");
    expect(ctx.store.get().currentProjectId).toBe("p1");
    expect(ctx.store.get().current).toBeUndefined();
    // The bridge holds the project as its own client; no window handler runs.
    expect(core.runtimes.share).toHaveBeenCalledWith(
      -2,
      expect.objectContaining({ id: "p1" }),
      expect.anything(),
    );
  });

  it("matches names: unique, several, none", async () => {
    const { ctx } = setup();
    expect((await run(ctx, { tail: "pinecone" })).text).toContain(
      "New sessions will start in: Pinecone",
    );
    const many = await run(ctx, { tail: "pin" });
    expect(many.text).toBe(
      '"pin" matches several. Reply `.number` to choose:\n- **1** Pine\n- **2** Pinecone',
    );
    expect(many.numbered).toEqual({ kind: "project" });
    expect((await run(ctx, { tail: "zzz" })).text).toBe(
      'Nothing matches "zzz".',
    );
  });

  it("an expired number is E-REF", async () => {
    const { ctx } = setup();
    expect((await run(ctx, { args: ["2"] })).text).toBe(
      "Number 2 is no longer valid. List again (`.p`).",
    );
  });

  it("refuses a project whose folders are all unavailable", async () => {
    const { ctx, core } = setup();
    core.addProject("p3", {
      name: "Gone",
      folders: [
        {
          id: "g",
          name: "g",
          path: "/Volumes/usb/g",
          access: "read-write",
          isAvailable: false,
        },
      ],
    });
    expect((await run(ctx, { tail: "gone" })).text).toBe(
      "The folders of Gone are not available right now.",
    );
    expect(ctx.store.get().currentProjectId).toBeUndefined();
  });
});
