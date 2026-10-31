import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import PINE_UI_REFERENCE from "./PINE_UI.md?raw";

export const ACTIVATE_PINE_OPS_TOOL_NAME = "activate_pine_ops";

const emptyParams = Type.Object({}, { additionalProperties: false });

/**
 * Loads the reference of Pine's own interface on demand, so it stays out of
 * the system prompt until a task concerns Pine's UI. Later this is where the
 * tools that operate Pine's UI get enabled for the session.
 */
export function createActivatePineOpsToolDefinition() {
  return defineTool({
    name: ACTIVATE_PINE_OPS_TOOL_NAME,
    label: "Activate Pine Operations",
    description:
      "Load the reference of Pine's own desktop interface: its regions, controls, dialogs, hierarchy and shortcuts. Use when the user asks how to do something in Pine, where a control is, or what part of Pine's UI does what.",
    promptSnippet:
      "Load the reference of Pine's own UI on demand when a task concerns Pine's interface",
    parameters: emptyParams,
    prepareArguments: () => ({}),
    execute: () =>
      Promise.resolve({
        content: [
          {
            type: "text" as const,
            text: `<pine_ui_reference>\n${PINE_UI_REFERENCE.trim()}\n</pine_ui_reference>`,
          },
        ],
        details: {},
      }),
  });
}
