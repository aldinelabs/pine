import { describe, expect, it, vi } from "vitest";
import { UI_OPEN_GUIDE_TOOL_NAME } from "../../shared/agent";
import { HELP_TOPIC_IDS } from "../../shared/helpTopics";
import { createGuideToolDefinitions } from "../guideTools";

function setup() {
  const openGuide = vi.fn();
  const [tool] = createGuideToolDefinitions({ openGuide });
  if (!tool) throw new Error("Missing guide tool");
  const run = (params: unknown) =>
    tool.execute("call-1", params, undefined, undefined, undefined as never);
  return { tool, run, openGuide };
}

describe("guide tool", () => {
  it("offers every guide by id", () => {
    const { tool } = setup();
    expect(tool.name).toBe(UI_OPEN_GUIDE_TOOL_NAME);
    const schema = JSON.stringify(tool.parameters);
    for (const id of HELP_TOPIC_IDS) {
      expect(schema).toContain(`"${id}"`);
      expect(tool.description).toContain(`${id}:`);
    }
  });

  it("opens the guide at the requested 1-based step", async () => {
    const { run, openGuide } = setup();
    const result = await run({ topic: "context-window", step: 3 });
    expect(openGuide).toHaveBeenCalledWith("call-1", "context-window", 2);
    expect(result.details).toEqual({ topic: "context-window", step: 2 });
  });

  it("opens at the first step without one", async () => {
    const { run, openGuide } = setup();
    await run({ topic: "models" });
    expect(openGuide).toHaveBeenCalledWith("call-1", "models", undefined);
  });
});
