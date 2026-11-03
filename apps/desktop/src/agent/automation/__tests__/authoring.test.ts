import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PineJsonValue } from "../../../shared/agent";
import type { AgentAutomationRun } from "../../protocol";
import { toolNamesForAutomationRun } from "../../runtime/session-state";
import { automationMcpConfig, isGrantedMcpTool } from "../mcp";
import { withDefaultModel } from "../tools";

const current = {
  providerId: "anthropic",
  modelId: "claude-opus-5-5",
  thinkingLevel: "high" as const,
};

function spec(model?: PineJsonValue): PineJsonValue {
  return {
    version: 1,
    action: { kind: "agent", ...(model ? { model } : {}) },
  };
}

describe("withDefaultModel", () => {
  it("gives a new automation this conversation's model", () => {
    expect(withDefaultModel(spec(), undefined, current)).toMatchObject({
      action: { model: current },
    });
  });

  it("keeps an explicit model", () => {
    const chosen = { providerId: "openai", modelId: "gpt-5" };
    expect(withDefaultModel(spec(chosen), undefined, current)).toMatchObject({
      action: { model: chosen },
    });
  });

  it("keeps the previous model on update instead of the current one", () => {
    const previous = spec({ providerId: "openai", modelId: "gpt-5" });
    expect(withDefaultModel(spec(), previous, current)).toMatchObject({
      action: { model: { providerId: "openai", modelId: "gpt-5" } },
    });
    expect(withDefaultModel(spec(), spec(), current)).toEqual(spec());
  });
});

describe("automation MCP", () => {
  const grants = [{ server: "github", tools: ["list_issues"] }];
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("allows only listed server tools", () => {
    expect(isGrantedMcpTool(grants, "github", "list_issues")).toBe(true);
    expect(isGrantedMcpTool(grants, "github", "create_issue")).toBe(false);
    expect(isGrantedMcpTool(grants, "slack", "list_issues")).toBe(false);
  });

  it("starts runs with only the listed servers and no way to widen them", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pine-automation-mcp-"));
    const configPath = path.join(root, "mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        settings: { allowInstall: true, sampling: true },
        mcpServers: {
          github: { command: "github-mcp" },
          slack: { command: "slack-mcp" },
        },
      }),
    );
    const config = automationMcpConfig(configPath, root, grants);
    expect(Object.keys(config.mcpServers)).toEqual(["github"]);
    expect(config.settings).toMatchObject({
      allowInstall: false,
      sampling: false,
      elicitation: false,
      autoAuth: false,
    });
  });

  it("shows MCP tools to a run only when it lists MCP grants", () => {
    const run = {
      toolNames: ["read"],
    } as unknown as AgentAutomationRun;
    const names = ["read", "bash", "automation_report", "mcp"];
    expect(toolNamesForAutomationRun(names, run, ["mcp"])).toEqual([
      "read",
      "automation_report",
    ]);
    expect(
      toolNamesForAutomationRun(names, { ...run, mcp: { cwd: "/", grants } }, [
        "mcp",
      ]),
    ).toEqual(["read", "automation_report", "mcp"]);
  });
});
