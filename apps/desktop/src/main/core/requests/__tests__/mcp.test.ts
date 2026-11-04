import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PineCore } from "../../pineCore";
import { answerMcpOperation } from "../mcp";

const roots: string[] = [];
const requester = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pine-mcp-host-"));
  roots.push(root);
  const filePath = path.join(root, ".mcp.json");
  await writeFile(
    filePath,
    JSON.stringify({
      mcpServers: {
        github: {
          command: "github-mcp",
          env: { GITHUB_TOKEN: "ghp_secret", LOG: "${LOG_LEVEL}" },
        },
      },
    }),
  );
  const reloadMcp = vi.fn().mockResolvedValue(undefined);
  const core = {
    defaultFolderPath: vi.fn().mockResolvedValue(root),
    runtimes: {
      ownerOfProject: vi.fn().mockReturnValue(7),
      reloadMcp,
      getMcpStatus: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as PineCore;
  const read = async () =>
    JSON.parse(await readFile(filePath, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
  return { core, read, reloadMcp };
}

describe("answerMcpOperation", () => {
  it("lists project servers without their literal credentials", async () => {
    const { core } = await fixture();
    const result = (await answerMcpOperation(core, requester, {
      op: "list",
    })) as { servers: { name: string; definition: unknown }[] };
    const github = result.servers.find((server) => server.name === "github");
    expect(github?.definition).toEqual({
      command: "github-mcp",
      env: { GITHUB_TOKEN: "<redacted>", LOG: "${LOG_LEVEL}" },
    });
    expect(JSON.stringify(result)).not.toContain("ghp_secret");
  });

  it("keeps a redacted secret when the agent edits other fields", async () => {
    const { core, read, reloadMcp } = await fixture();
    await expect(
      answerMcpOperation(core, requester, {
        op: "save",
        scope: "project",
        name: "github",
        definition: {
          command: "github-mcp",
          args: ["--read-only"],
          env: { GITHUB_TOKEN: "<redacted>", LOG: "${LOG_LEVEL}" },
        },
      }),
    ).resolves.toMatchObject({ created: false });
    expect((await read()).mcpServers.github).toEqual({
      command: "github-mcp",
      args: ["--read-only"],
      env: { GITHUB_TOKEN: "ghp_secret", LOG: "${LOG_LEVEL}" },
    });
    expect(reloadMcp).toHaveBeenCalledWith(7, requester.projectId);
  });

  it("disables, re-enables and removes a server", async () => {
    const { core, read } = await fixture();
    await answerMcpOperation(core, requester, {
      op: "set-enabled",
      scope: "project",
      name: "github",
      enabled: false,
    });
    expect((await read()).mcpServers.github.disabled).toBe(true);
    await answerMcpOperation(core, requester, {
      op: "set-enabled",
      scope: "project",
      name: "github",
      enabled: true,
    });
    expect((await read()).mcpServers.github).not.toHaveProperty("disabled");
    await answerMcpOperation(core, requester, {
      op: "remove",
      scope: "project",
      name: "github",
    });
    expect((await read()).mcpServers).toEqual({});
    await expect(
      answerMcpOperation(core, requester, {
        op: "remove",
        scope: "project",
        name: "github",
      }),
    ).rejects.toThrow('no project MCP server named "github"');
  });

  it("refuses to rename onto another server", async () => {
    const { core } = await fixture();
    await answerMcpOperation(core, requester, {
      op: "save",
      scope: "project",
      name: "other",
      definition: { url: "https://mcp.example.com" },
    });
    await expect(
      answerMcpOperation(core, requester, {
        op: "save",
        scope: "project",
        name: "github",
        previousName: "other",
        definition: { url: "https://mcp.example.com" },
      }),
    ).rejects.toThrow("already exists");
  });
});
