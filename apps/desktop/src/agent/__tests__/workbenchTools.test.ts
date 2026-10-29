import { describe, expect, it, vi } from "vitest";
import {
  UI_WORKBENCH_ARRANGE_TOOL_NAME,
  UI_WORKBENCH_CLOSE_TOOL_NAME,
  UI_WORKBENCH_OPEN_TOOL_NAME,
  UI_WORKBENCH_STATE_TOOL_NAME,
} from "../../shared/workbench";
import { createWorkbenchToolDefinitions } from "../workbenchTools";

function setup() {
  const sendCommand = vi.fn();
  const readState = vi.fn().mockResolvedValue({
    open: true,
    visible: true,
    top: "files",
    bottom: "preview",
    split: 65,
  });
  const tools = createWorkbenchToolDefinitions({ sendCommand, readState });
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
  return { run, sendCommand, tools, readState };
}

describe("workbench tools", () => {
  it("defines the ui_workbench tools", () => {
    expect(setup().tools.map((tool) => tool.name)).toEqual([
      UI_WORKBENCH_STATE_TOOL_NAME,
      UI_WORKBENCH_OPEN_TOOL_NAME,
      UI_WORKBENCH_CLOSE_TOOL_NAME,
      UI_WORKBENCH_ARRANGE_TOOL_NAME,
    ]);
  });

  it("reads fresh user layout without changing it", async () => {
    const { run, readState, sendCommand } = setup();
    const first = await run(UI_WORKBENCH_STATE_TOOL_NAME, {});
    expect(first.details).toEqual({
      state: {
        open: true,
        visible: true,
        top: "files",
        bottom: "preview",
        split: 65,
      },
    });
    readState.mockResolvedValue({
      open: false,
      visible: false,
      top: "tasks",
      bottom: null,
      split: 50,
    });
    const second = await run(UI_WORKBENCH_STATE_TOOL_NAME, {});
    expect(second.content[0]).toMatchObject({
      text: JSON.stringify(
        { open: false, visible: false, top: "tasks", bottom: null, split: 50 },
        null,
        2,
      ),
    });
    expect(readState).toHaveBeenCalledTimes(2);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("sends open and close commands for the calling tool", async () => {
    const { run, sendCommand } = setup();
    await run(UI_WORKBENCH_OPEN_TOOL_NAME, {
      panel: "preview",
      position: "top",
    });
    await run(UI_WORKBENCH_CLOSE_TOOL_NAME, {});

    expect(sendCommand.mock.calls).toEqual([
      ["call-1", { kind: "open", panel: "preview", position: "top" }],
      ["call-1", { kind: "close" }],
    ]);
  });

  it("drops a duplicate bottom card and clamps the split", async () => {
    const { run, sendCommand } = setup();
    const result = await run(UI_WORKBENCH_ARRANGE_TOOL_NAME, {
      top: "preview",
      bottom: "preview",
      split: 5,
    });

    expect(sendCommand).toHaveBeenCalledWith("call-1", {
      kind: "arrange",
      top: "preview",
      bottom: null,
      split: 20,
    });
    expect(result.content[0]).toMatchObject({
      text: "Workbench now shows preview.",
    });
  });

  it("highlights the opened panel's card", async () => {
    const { run, sendCommand } = setup();
    const result = await run(UI_WORKBENCH_OPEN_TOOL_NAME, {
      panel: "tasks",
      highlight: true,
    });

    expect(sendCommand).toHaveBeenCalledWith("call-1", {
      kind: "open",
      panel: "tasks",
      highlight: true,
    });
    expect(result.content[0]).toMatchObject({
      text: "Highlighting the tasks panel in the workbench.",
    });
  });

  it("highlights only an arranged card", async () => {
    const { run, sendCommand } = setup();
    await run(UI_WORKBENCH_ARRANGE_TOOL_NAME, {
      top: "artifacts",
      bottom: "tasks",
      highlight: "tasks",
    });
    const missed = await run(UI_WORKBENCH_ARRANGE_TOOL_NAME, {
      top: "preview",
      bottom: null,
      highlight: "tasks",
    });

    expect(sendCommand.mock.calls).toEqual([
      [
        "call-1",
        {
          kind: "arrange",
          top: "artifacts",
          bottom: "tasks",
          highlight: "tasks",
        },
      ],
      ["call-1", { kind: "arrange", top: "preview", bottom: null }],
    ]);
    expect(missed.content[0]).toMatchObject({
      text: "Workbench now shows preview. Did not highlight tasks: it is not one of the arranged cards.",
    });
  });
});
