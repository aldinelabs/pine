import { describe, expect, it, vi } from "vitest";
import {
  UI_WORKBENCH_ARRANGE_TOOL_NAME,
  UI_WORKBENCH_CLOSE_TOOL_NAME,
  UI_WORKBENCH_OPEN_TOOL_NAME,
} from "../../shared/workbench";
import { createWorkbenchToolDefinitions } from "../workbenchTools";

function setup() {
  const sendCommand = vi.fn();
  const tools = createWorkbenchToolDefinitions({ sendCommand });
  const run = (name: string, params: unknown) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Missing ${name}`);
    return tool.execute(
      "call-1",
      params,
      undefined,
      undefined,
      undefined as never,
    );
  };
  return { run, sendCommand, tools };
}

describe("workbench tools", () => {
  it("defines the ui_workbench tools", () => {
    expect(setup().tools.map((tool) => tool.name)).toEqual([
      UI_WORKBENCH_OPEN_TOOL_NAME,
      UI_WORKBENCH_CLOSE_TOOL_NAME,
      UI_WORKBENCH_ARRANGE_TOOL_NAME,
    ]);
  });

  it("sends open and close commands for the calling tool", async () => {
    const { run, sendCommand } = setup();
    await run(UI_WORKBENCH_OPEN_TOOL_NAME, { panel: "tasks", position: "top" });
    await run(UI_WORKBENCH_CLOSE_TOOL_NAME, {});

    expect(sendCommand.mock.calls).toEqual([
      ["call-1", { kind: "open", panel: "tasks", position: "top" }],
      ["call-1", { kind: "close" }],
    ]);
  });

  it("drops a duplicate bottom card and clamps the split", async () => {
    const { run, sendCommand } = setup();
    const result = await run(UI_WORKBENCH_ARRANGE_TOOL_NAME, {
      top: "todos",
      bottom: "todos",
      split: 5,
    });

    expect(sendCommand).toHaveBeenCalledWith("call-1", {
      kind: "arrange",
      top: "todos",
      bottom: null,
      split: 20,
    });
    expect(result.content[0]).toMatchObject({
      text: "Workbench now shows todos.",
    });
  });
});
