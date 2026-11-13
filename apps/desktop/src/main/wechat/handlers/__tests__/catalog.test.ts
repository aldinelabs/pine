// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PineMcpCatalog } from "../../../../shared/mcp";
import type { ListSkillsResult } from "../../../../shared/skills";
import { render } from "../../replies";
import type { ParsedCommand } from "../../types";
import { createTestContext, type TestContext } from "../../__tests__/fakes";
import { catalogHandlers } from "../catalog";

function run(name: "skills" | "mcp", ctx: TestContext) {
  const handler = catalogHandlers[name];
  if (!handler) throw new Error(`no handler for ${name}`);
  const parsed: ParsedCommand = { kind: "command", name, args: [] };
  return handler(ctx, parsed);
}

async function setup(): Promise<TestContext> {
  const ctx = createTestContext();
  ctx.fake.core.addProject("p1", { name: "pine" });
  await ctx.store.update((draft) => {
    draft.current = { projectId: "p1", sessionId: "s1", usedAtMs: ctx.now };
  });
  return ctx;
}

describe(".skills", () => {
  it("lists the current project's skills with scope, state and a short description", async () => {
    const ctx = await setup();
    const skills: ListSkillsResult = {
      diagnostics: [],
      skills: [
        {
          name: "review",
          scope: "global",
          description: `Reviews code ${"carefully ".repeat(10)}`,
          disableModelInvocation: false,
        },
        {
          name: "deploy",
          scope: "project",
          description: "Deploys",
          disableModelInvocation: false,
          enabled: false,
        },
      ],
    };
    const listSkills = vi.fn(() => Promise.resolve(skills));
    ctx.fake.core.ports.listSkills = listSkills;
    const text = (await run("skills", ctx)).text ?? "";
    expect(listSkills).toHaveBeenCalledWith("p1");
    expect(text).toContain("| 1 | review · Reviews code carefully");
    expect(text).toContain("| 2 | deploy · Deploys | project · off |");
    expect(text).not.toContain("carefully ".repeat(5));
  });

  it("says when there are none", async () => {
    const ctx = await setup();
    ctx.fake.core.ports.listSkills = () =>
      Promise.resolve({ diagnostics: [], skills: [] });
    expect((await run("skills", ctx)).text).toBe(
      render("R-SKILLS", "en", { rows: [] }),
    );
  });
});

describe(".mcp", () => {
  it("shows names, scope, status and tool count, never a definition", async () => {
    const ctx = await setup();
    const catalog: PineMcpCatalog = {
      servers: [
        {
          name: "github",
          scope: "global",
          definition: {
            command: "/usr/local/bin/gh-mcp",
            env: { GITHUB_TOKEN: "ghp_SECRET_TOKEN_123" },
          },
        },
        {
          name: "notes",
          scope: "project",
          definition: { url: "https://notes.example.com/mcp?key=abc" },
        },
        { name: "idle", scope: "project", definition: { command: "idle" } },
      ],
      paths: { global: "/Users/me/.pi/mcp.json", project: "/p/.pi/mcp.json" },
      status: {
        servers: [
          { name: "github", status: "connected", toolCount: 12 },
          { name: "notes", status: "needs-auth", toolCount: 0 },
        ],
        connectedCount: 1,
        totalTools: 12,
      },
    };
    ctx.fake.core.ports.listMcpServers = () => Promise.resolve(catalog);
    const text = (await run("mcp", ctx)).text ?? "";
    expect(text).toContain("| github | global · connected · 12 tools |");
    expect(text).toContain("| notes | project · failed · 0 tools |");
    expect(text).toContain("| idle | project · unknown |");
    for (const secret of [
      "ghp_SECRET_TOKEN_123",
      "GITHUB_TOKEN",
      "gh-mcp",
      "notes.example.com",
      "key=abc",
      "mcp.json",
    ])
      expect(text).not.toContain(secret);
  });

  it("says when there are none", async () => {
    const ctx = await setup();
    expect((await run("mcp", ctx)).text).toBe(
      render("R-MCP", "en", { rows: [] }),
    );
  });
});
