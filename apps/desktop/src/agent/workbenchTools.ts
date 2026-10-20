import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { UI_PRESENT_FILE_TOOL_NAME } from "../shared/agent";
import {
  UI_WORKBENCH_ARRANGE_TOOL_NAME,
  UI_WORKBENCH_CLOSE_TOOL_NAME,
  UI_WORKBENCH_OPEN_TOOL_NAME,
  WORKBENCH_MAX_SPLIT,
  WORKBENCH_MIN_SPLIT,
  clampWorkbenchSplit,
  type WorkbenchCommand,
  type WorkbenchPosition,
} from "../shared/workbench";

export interface PineWorkbenchToolContext {
  /** Applies the command to this session's workbench in the user's window. */
  sendCommand(toolCallId: string, command: WorkbenchCommand): void;
}

const PANEL_DESCRIPTIONS =
  "artifacts: files presented in this session; preview: the file last presented or picked from artifacts";

// Spelled out rather than mapped so the schemas keep their literal types.
function panelSchema(description: string) {
  return Type.Union([Type.Literal("artifacts"), Type.Literal("preview")], {
    description,
  });
}

function positionSchema(description: string) {
  return Type.Union([Type.Literal("top"), Type.Literal("bottom")], {
    description,
  });
}

function slotSchema(position: WorkbenchPosition) {
  return Type.Union(
    [Type.Literal("artifacts"), Type.Literal("preview"), Type.Null()],
    { description: `Panel for the ${position} card, or null for none.` },
  );
}

function done(text: string, command: WorkbenchCommand) {
  return Promise.resolve({
    content: [{ type: "text" as const, text }],
    details: { command },
  });
}

/**
 * Lets the agent arrange the workbench beside its conversation. Commands are
 * fire-and-forget: they only change what the user sees next to this session,
 * so nothing about applying them can fail in a way the agent must handle.
 */
export function createWorkbenchToolDefinitions(
  context: PineWorkbenchToolContext,
): ToolDefinition[] {
  const openParams = Type.Object({
    panel: panelSchema(`The panel to show. ${PANEL_DESCRIPTIONS}.`),
    position: Type.Optional(
      positionSchema(
        "Card to show it in. Without one, an already visible panel stays put and a new one takes the first free card, or replaces the bottom card.",
      ),
    ),
  });
  const openTool = defineTool({
    name: UI_WORKBENCH_OPEN_TOOL_NAME,
    label: "Open Workbench Panel",
    description: `Show a panel in the workbench, the column beside this conversation that stacks up to two cards. Opens the workbench if it is closed. Panels: ${PANEL_DESCRIPTIONS}.`,
    promptSnippet: `Use ${UI_WORKBENCH_OPEN_TOOL_NAME} to show the user presented files beside the conversation when following them helps`,
    promptGuidelines: [
      `${UI_PRESENT_FILE_TOOL_NAME} already shows its file in the workbench preview; do not open the preview panel separately for it.`,
      `Change the workbench only when it helps the user follow the current work; the user arranges it too, so do not undo their layout without a reason.`,
    ],
    parameters: openParams,
    prepareArguments: (args) => args as Static<typeof openParams>,
    execute: (toolCallId, params) => {
      const command: WorkbenchCommand = {
        kind: "open",
        panel: params.panel,
        ...(params.position ? { position: params.position } : {}),
      };
      context.sendCommand(toolCallId, command);
      return done(
        `Showing the ${params.panel} panel in the workbench${params.position ? ` (${params.position} card)` : ""}.`,
        command,
      );
    },
  });

  const closeParams = Type.Object({
    panel: Type.Optional(
      panelSchema(
        "The panel whose card to close. Omit it to close the whole workbench.",
      ),
    ),
  });
  const closeTool = defineTool({
    name: UI_WORKBENCH_CLOSE_TOOL_NAME,
    label: "Close Workbench Panel",
    description:
      "Close one workbench card, or the whole workbench when no panel is given. Closing the last card closes the workbench and gives the window its width back.",
    parameters: closeParams,
    prepareArguments: (args) => args as Static<typeof closeParams>,
    execute: (toolCallId, params) => {
      const command: WorkbenchCommand = params.panel
        ? { kind: "close", panel: params.panel }
        : { kind: "close" };
      context.sendCommand(toolCallId, command);
      return done(
        params.panel
          ? `Closed the ${params.panel} card.`
          : "Closed the workbench.",
        command,
      );
    },
  });

  const arrangeParams = Type.Object({
    top: slotSchema("top"),
    bottom: slotSchema("bottom"),
    split: Type.Optional(
      Type.Number({
        minimum: WORKBENCH_MIN_SPLIT,
        maximum: WORKBENCH_MAX_SPLIT,
        description: `Height of the top card as a percentage of the column, ${WORKBENCH_MIN_SPLIT}-${WORKBENCH_MAX_SPLIT}. Only used with two cards.`,
      }),
    ),
  });
  const arrangeTool = defineTool({
    name: UI_WORKBENCH_ARRANGE_TOOL_NAME,
    label: "Arrange Workbench",
    description: `Set both workbench cards and their split in one step. A single panel fills the column; null for both closes the workbench. Panels: ${PANEL_DESCRIPTIONS}.`,
    parameters: arrangeParams,
    prepareArguments: (args) => args as Static<typeof arrangeParams>,
    execute: (toolCallId, params) => {
      const command: WorkbenchCommand = {
        kind: "arrange",
        top: params.top,
        bottom: params.bottom === params.top ? null : params.bottom,
        ...(params.split === undefined
          ? {}
          : { split: clampWorkbenchSplit(params.split) }),
      };
      context.sendCommand(toolCallId, command);
      const cards = [command.top, command.bottom].filter(Boolean);
      return done(
        cards.length
          ? `Workbench now shows ${cards.join(" above ")}.`
          : "Closed the workbench.",
        command,
      );
    },
  });

  return [openTool, closeTool, arrangeTool];
}
