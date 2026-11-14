import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  createMcpAuthoringExtension,
  mcpAuthoringInstructions,
  mcpDefinitionErrors,
  type McpAuthoringOptions,
} from "../tools";

function setup(decision: "allow" | "deny" = "allow") {
  const tools = new Map<string, ToolDefinition>();
  let active = ["read", "activate_mcp_authoring"];
  const options = {
    activated: vi.fn(),
    call: vi.fn().mockResolvedValue({ path: "/p/.mcp.json", created: true }),
    requestApproval: vi
      .fn()
      .mockResolvedValue(
        decision === "allow"
          ? { kind: "allow" }
          : { kind: "deny", reason: "No thanks" },
      ),
    reloadWhenIdle: vi.fn(),
  } satisfies McpAuthoringOptions;
  const { factory } = createMcpAuthoringExtension(options) as unknown as {
    factory: (pi: unknown) => void;
  };
  factory({
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
  });
  const run = (name: string, params: Record<string, unknown>) =>
    tools.get(name)!.execute("call-1", params, undefined, undefined, {
      cwd: "/",
    } as never);
  return { options, run, active: () => active };
}

describe("MCP authoring tools", () => {
  it("activates the configuration tools and returns the instructions", async () => {
    const { options, run, active } = setup();
    const result = await run("activate_mcp_authoring", {});
    expect(active()).toEqual([
      "read",
      "activate_mcp_authoring",
      "mcp_config_list",
      "mcp_config_save",
      "mcp_config_set_enabled",
      "mcp_config_remove",
    ]);
    expect(options.activated).toHaveBeenCalledOnce();
    expect(result.content[0]).toEqual({
      type: "text",
      text: mcpAuthoringInstructions(),
    });
    expect(mcpAuthoringInstructions()).toContain(".mcp.json");
  });

  it("asks the user before saving and reloads afterwards", async () => {
    const { options, run } = setup();
    const definition = {
      command: "npx",
      args: ["-y", "server@1.0.0"],
      env: { TOKEN: "secret" },
    };
    const result = await run("mcp_config_save", {
      scope: "project",
      name: "github",
      definition,
    });
    expect(options.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "mcp_config_save",
        subject: "project MCP server github",
        evidence: expect.stringContaining("npx -y server@1.0.0"),
      }),
    );
    // The card never shows the literal secret.
    expect(options.requestApproval.mock.calls[0][0].evidence).not.toContain(
      "secret",
    );
    expect(options.requestApproval.mock.calls[0][0].mcpChange).toEqual({
      action: "add",
      scope: "project",
      name: "github",
      command: "npx -y server@1.0.0",
      credentials: ["TOKEN"],
      definition: expect.not.stringContaining("secret"),
    });
    expect(options.call).toHaveBeenCalledWith({
      op: "save",
      scope: "project",
      name: "github",
      definition,
    });
    expect(options.reloadWhenIdle).toHaveBeenCalledOnce();
    expect(result.details).toMatchObject({ saved: true, created: true });
  });

  it("saves nothing when the user declines", async () => {
    const { options, run } = setup("deny");
    await expect(
      run("mcp_config_save", {
        scope: "global",
        name: "remote",
        definition: { url: "https://mcp.example.com" },
      }),
    ).rejects.toThrow("No thanks");
    expect(options.call).not.toHaveBeenCalledWith(
      expect.objectContaining({ op: "save" }),
    );
  });

  it("refuses an invalid definition without asking", async () => {
    const { options, run } = setup();
    const result = await run("mcp_config_save", {
      scope: "project",
      name: "broken",
      definition: { command: "a", url: "https://b" },
    });
    expect(result.details).toMatchObject({ saved: false });
    expect(options.requestApproval).not.toHaveBeenCalled();
  });

  it("asks only to enable, not to disable or remove", async () => {
    const { options, run } = setup();
    await run("mcp_config_set_enabled", {
      scope: "project",
      name: "github",
      enabled: false,
    });
    await run("mcp_config_remove", { scope: "project", name: "github" });
    expect(options.requestApproval).not.toHaveBeenCalled();
    await run("mcp_config_set_enabled", {
      scope: "project",
      name: "github",
      enabled: true,
    });
    expect(options.requestApproval).toHaveBeenCalledOnce();
  });
});

describe("MCP change summaries", () => {
  const remote = {
    url: "https://mcp.example.com",
    headers: { Authorization: "Bearer x" },
  };

  it("tells a change or rename of a configured server from an addition", async () => {
    const { options, run } = setup();
    options.call.mockImplementation((operation: { op: string }) =>
      Promise.resolve(
        operation.op === "list"
          ? {
              servers: [
                { scope: "global", name: "remote", definition: remote },
              ],
            }
          : {},
      ),
    );
    await run("mcp_config_save", {
      scope: "global",
      name: "remote",
      definition: remote,
    });
    await run("mcp_config_save", {
      scope: "global",
      name: "remote-2",
      previousName: "remote",
      definition: remote,
    });
    await run("mcp_config_save", {
      scope: "project",
      name: "remote",
      definition: remote,
    });
    expect(
      options.requestApproval.mock.calls.map(([input]) => [
        input.mcpChange.action,
        input.mcpChange.previousName,
      ]),
    ).toEqual([
      ["update", undefined],
      ["rename", "remote"],
      ["add", undefined],
    ]);
    expect(options.requestApproval.mock.calls[0][0].mcpChange).toMatchObject({
      address: "https://mcp.example.com",
      credentials: ["Authorization"],
    });
  });

  it("describes the configured server it enables", async () => {
    const { options, run } = setup();
    options.call.mockResolvedValue({
      servers: [{ scope: "project", name: "remote", definition: remote }],
    });
    await run("mcp_config_set_enabled", {
      scope: "project",
      name: "remote",
      enabled: true,
    });
    expect(options.requestApproval.mock.calls[0][0].mcpChange).toMatchObject({
      action: "enable",
      scope: "project",
      name: "remote",
      address: "https://mcp.example.com",
    });
  });
});

describe("mcpDefinitionErrors", () => {
  it("requires exactly one transport and well-formed fields", () => {
    expect(mcpDefinitionErrors({ command: "server" })).toEqual([]);
    expect(mcpDefinitionErrors({})).toHaveLength(1);
    expect(
      mcpDefinitionErrors({ url: "https://x", socket: "/s" }),
    ).toHaveLength(1);
    expect(mcpDefinitionErrors({ command: "s", args: [1] })).toEqual([
      '"args" must be an array of strings.',
    ]);
    expect(mcpDefinitionErrors({ command: "s", env: { A: 1 } })).toEqual([
      '"env" must map names to strings.',
    ]);
    expect(mcpDefinitionErrors([])).toEqual([
      "The definition must be a JSON object.",
    ]);
  });
});
