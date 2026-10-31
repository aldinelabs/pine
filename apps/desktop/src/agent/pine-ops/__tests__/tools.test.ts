import { describe, expect, it } from "vitest";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import {
  ACTIVATE_PINE_OPS_TOOL_NAME,
  createActivatePineOpsToolDefinition,
} from "../tools";

describe("activate_pine_ops", () => {
  it("returns the Pine UI reference", async () => {
    const tool = createActivatePineOpsToolDefinition();
    expect(tool.name).toBe(ACTIVATE_PINE_OPS_TOOL_NAME);

    const result = await tool.execute(
      "call-1",
      {},
      undefined,
      undefined,
      {} as ExtensionToolContext,
    );
    const [content] = result.content;
    if (content?.type !== "text") throw new Error("Expected text content");
    expect(content.text).toMatch(
      /^<pine_ui_reference>\n# Pine UI Reference\n[\s\S]+\n<\/pine_ui_reference>$/,
    );
    expect(content.text).toContain("## Main window");
  });
});
