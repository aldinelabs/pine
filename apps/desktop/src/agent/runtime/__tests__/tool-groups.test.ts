import { describe, expect, it } from "vitest";
import {
  defaultPineToolGroups,
  PINE_TOOL_GROUP_IDS,
  resolvePineToolGroups,
} from "../../../shared/toolGroups";
import {
  disabledToolsNotice,
  inToolOrder,
  mcpToolsLast,
  TOOL_GROUP_TOOL_NAMES,
  toolNamesForToolGroups,
} from "../tool-groups";

const TOOLS = [
  "read",
  "find",
  "bash",
  "edit",
  "write",
  "privileged_bash",
  "ui_present_file",
  "ui_submit_artifact",
  "ui_workbench_state",
  "todo",
  "bg_run",
  "web_search",
  "activate_computer_use",
  "list_apps",
  "read_live_transcript",
  "memory_read",
  "invoke_skill",
  "activate_mcp_authoring",
];

describe("resolvePineToolGroups", () => {
  it("turns every group on unless the settings file says otherwise", () => {
    expect(resolvePineToolGroups(undefined)).toEqual(defaultPineToolGroups());
    expect(Object.values(defaultPineToolGroups()).every(Boolean)).toBe(true);
    expect(resolvePineToolGroups({ web: false })).toEqual({
      ...defaultPineToolGroups(),
      web: false,
    });
  });
});

describe("toolNamesForToolGroups", () => {
  it("keeps every tool when all groups are on", () => {
    expect(toolNamesForToolGroups(TOOLS, defaultPineToolGroups())).toEqual(
      TOOLS,
    );
  });

  it("drops a switched-off group and keeps the rest in their order", () => {
    expect(
      toolNamesForToolGroups(TOOLS, {
        ...defaultPineToolGroups(),
        shell: false,
        workbench: false,
      }),
    ).toEqual([
      "read",
      "find",
      "edit",
      "write",
      "todo",
      "web_search",
      "activate_computer_use",
      "list_apps",
      "read_live_transcript",
      "memory_read",
      "invoke_skill",
      "activate_mcp_authoring",
    ]);
  });

  it("drops MCP server tools only with the MCP switch", () => {
    const tools = [...TOOLS, "github_search"];
    const mcpOff = { ...defaultPineToolGroups(), mcp: false };
    expect(toolNamesForToolGroups(tools, mcpOff, ["github_search"])).toEqual(
      TOOLS.filter((name) => name !== "activate_mcp_authoring"),
    );
    expect(
      toolNamesForToolGroups(tools, defaultPineToolGroups(), ["github_search"]),
    ).toEqual(tools);
  });

  it("never switches off the tools the core loop needs", () => {
    const allOff = Object.fromEntries(
      PINE_TOOL_GROUP_IDS.map((id) => [id, false]),
    ) as ReturnType<typeof defaultPineToolGroups>;
    expect(toolNamesForToolGroups(TOOLS, allOff)).toEqual([
      "read",
      "find",
      "edit",
      "write",
      "todo",
      "memory_read",
    ]);
  });

  it("assigns each tool to one group at most", () => {
    const names = Object.values(TOOL_GROUP_TOOL_NAMES).flat();
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("disabledToolsNotice", () => {
  it("says nothing while every group is on", () => {
    expect(disabledToolsNotice(defaultPineToolGroups(), TOOLS)).toBeUndefined();
  });

  it("names the switched-off groups and the tools this session had", () => {
    const notice = disabledToolsNotice(
      { ...defaultPineToolGroups(), shell: false, mcp: false },
      TOOLS,
    );
    expect(notice).toContain("- Shell commands: bash, privileged_bash, bg_run");
    expect(notice).not.toContain("powershell");
    expect(notice).toContain(
      "- MCP servers: every MCP server tool, activate_mcp_authoring",
    );
    expect(notice).toContain("Settings › Agent › Tools");
  });
});

describe("inToolOrder", () => {
  it("orders the same names the same way however they were arrived at", () => {
    const order = ["read", "bash", "edit", "web_search"];
    expect(inToolOrder(["edit", "web_search", "read", "bash"], order)).toEqual(
      order,
    );
    expect(inToolOrder(["web_search", "read"], order)).toEqual([
      "read",
      "web_search",
    ]);
  });

  it("puts names outside the order last, keeping their relative order", () => {
    expect(inToolOrder(["mcp_b", "bash", "mcp_a"], ["read", "bash"])).toEqual([
      "bash",
      "mcp_b",
      "mcp_a",
    ]);
  });
});

describe("mcpToolsLast", () => {
  it("moves MCP tools behind the rest, keeping each part's order", () => {
    expect(
      mcpToolsLast(
        ["read", "mcpScript", "mcp", "mcp__docs", "find", "todo"],
        ["mcp", "mcpScript", "mcp__docs"],
      ),
    ).toEqual(["read", "find", "todo", "mcpScript", "mcp", "mcp__docs"]);
  });
});
