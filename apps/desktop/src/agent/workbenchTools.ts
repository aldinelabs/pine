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
  UI_WORKBENCH_STATE_TOOL_NAME,
  WORKBENCH_MAX_SPLIT,
  WORKBENCH_MIN_SPLIT,
  clampWorkbenchSplit,
  type WorkbenchCommand,
  type WorkbenchPosition,
  type WorkbenchState,
} from "../shared/workbench";

export interface PineWorkbenchToolContext {
  /** Reads the live layout from the session's owning window. */
  readState(): Promise<WorkbenchState>;
  /** Applies the command to this session's workbench in the user's window. */
  sendCommand(toolCallId: string, command: WorkbenchCommand): void;
}

const PANEL_DESCRIPTIONS =
  "artifacts: files presented in this session; tasks: background processes started with bg_run, with their output; preview: the file last presented or picked from artifacts; files: the project's file tree";

// Spelled out rather than mapped so the schemas keep their literal types.
function panelSchema(description: string) {
  return Type.Union(
    [
      Type.Literal("artifacts"),
      Type.Literal("tasks"),
      Type.Literal("preview"),
      Type.Literal("files"),
    ],
    {
      description,
    },
  );
}

function positionSchema(description: string) {
  return Type.Union([Type.Literal("top"), Type.Literal("bottom")], {
    description,
  });
}

function slotSchema(position: WorkbenchPosition) {
  return Type.Union(
    [
      Type.Literal("artifacts"),
      Type.Literal("tasks"),
      Type.Literal("preview"),
      Type.Literal("files"),
      Type.Null(),
    ],
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
  const stateTool = defineTool({
    name: UI_WORKBENCH_STATE_TOOL_NAME,
    label: "Read Workbench State",
    description:
      "Read this conversation's current right sidebar layout, including changes the user made: whether it is open, whether it is currently visible, the top and bottom panels, and the top panel's height percentage. This reads UI state, not screenshots or panel contents. A background conversation can have an open layout that is not currently visible.",
    promptSnippet: `Regularly use ${UI_WORKBENCH_STATE_TOOL_NAME} to check the right sidebar and proactively arrange it to make the current work and progress visible to the user`,
    promptGuidelines: [
      `For substantial work, check ${UI_WORKBENCH_STATE_TOOL_NAME} at the start, at meaningful phase changes, and before showing results. Read it again when the user may have changed the layout; do not assume your last command still describes the sidebar.`,
      `Actively manage the right sidebar as a useful view of the work: show tasks while background commands or builds run, files while exploring a project, and artifacts or preview when a result is ready to inspect. Use ${UI_WORKBENCH_ARRANGE_TOOL_NAME} to place complementary panels together, and close irrelevant cards when focus shifts. Make useful changes directly without asking permission for routine layout adjustments.`,
      `Keep the sidebar stable while it is still useful. Avoid polling after every tool call or repeatedly rearranging the same panels; honor an explicit user layout preference. Commands affect only this conversation, and a background conversation must not claim its layout is currently on screen.`,
      `The tasks panel shows background processes from bg_run, not the todo checklist. Manage step-by-step progress with todo and keep its statuses truthful; opening tasks does not create or update todos.`,
    ],
    parameters: Type.Object({}),
    execute: async () => {
      const state = await context.readState();
      return {
        content: [{ type: "text", text: JSON.stringify(state, null, 2) }],
        details: { state },
      };
    },
  });
  const openParams = Type.Object({
    panel: panelSchema(`The panel to show. ${PANEL_DESCRIPTIONS}.`),
    position: Type.Optional(
      positionSchema(
        "Card to show it in. Without one, an already visible panel stays put and a new one takes the first free card, or replaces the bottom card.",
      ),
    ),
    highlight: Type.Optional(
      Type.Boolean({
        description:
          "Pulse the panel's card until the user looks at it. Open an already visible panel with this to point the user at it without moving anything.",
      }),
    ),
  });
  const openTool = defineTool({
    name: UI_WORKBENCH_OPEN_TOOL_NAME,
    label: "Open Workbench Panel",
    description: `Show a panel in the workbench, the column beside this conversation that stacks up to two cards. Opens the workbench if it is closed. Panels: ${PANEL_DESCRIPTIONS}.`,
    promptSnippet: `Use ${UI_WORKBENCH_OPEN_TOOL_NAME} proactively to show useful background progress, project files, and results beside the conversation`,
    promptGuidelines: [
      `${UI_PRESENT_FILE_TOOL_NAME} already shows its file in the workbench preview; do not open the preview panel separately for it.`,
      `Highlight a card only when you refer the user to it, such as output they should check in tasks; pass highlight with the open or arrange call that shows it rather than calling twice.`,
      `After checking ${UI_WORKBENCH_STATE_TOOL_NAME}, open panels that help the user follow the current phase of work. Preserve useful panels and respect explicit user preferences.`,
    ],
    parameters: openParams,
    prepareArguments: (args) => args as Static<typeof openParams>,
    execute: (toolCallId, params) => {
      const command: WorkbenchCommand = {
        kind: "open",
        panel: params.panel,
        ...(params.position ? { position: params.position } : {}),
        ...(params.highlight ? { highlight: true } : {}),
      };
      context.sendCommand(toolCallId, command);
      return done(
        `${params.highlight ? "Highlighting" : "Showing"} the ${params.panel} panel in the workbench${params.position ? ` (${params.position} card)` : ""}.`,
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
    highlight: Type.Optional(
      panelSchema(
        "One of the arranged panels whose card should pulse until the user looks at it.",
      ),
    ),
  });
  const arrangeTool = defineTool({
    name: UI_WORKBENCH_ARRANGE_TOOL_NAME,
    label: "Arrange Workbench",
    description: `Set both workbench cards and their split in one step, optionally highlighting one of them. A single panel fills the column; null for both closes the workbench. Panels: ${PANEL_DESCRIPTIONS}.`,
    promptSnippet: `Use ${UI_WORKBENCH_ARRANGE_TOOL_NAME} to keep the right sidebar aligned with the work's current phase and visible results`,
    promptGuidelines: [
      `Choose panels based on real activity: tasks plus preview while a background process produces inspectable results, or files plus preview while browsing and editing. Do not claim progress merely because the layout changed.`,
      `Read ${UI_WORKBENCH_STATE_TOOL_NAME} before replacing the current layout. Omit split to retain the user's sizing; set it when the content needs a different balance.`,
    ],
    parameters: arrangeParams,
    prepareArguments: (args) => args as Static<typeof arrangeParams>,
    execute: (toolCallId, params) => {
      const bottom = params.bottom === params.top ? null : params.bottom;
      const highlight =
        params.highlight &&
        (params.highlight === params.top || params.highlight === bottom)
          ? params.highlight
          : undefined;
      const command: WorkbenchCommand = {
        kind: "arrange",
        top: params.top,
        bottom,
        ...(params.split === undefined
          ? {}
          : { split: clampWorkbenchSplit(params.split) }),
        ...(highlight ? { highlight } : {}),
      };
      context.sendCommand(toolCallId, command);
      const cards = [command.top, command.bottom].filter(Boolean);
      const shown = cards.length
        ? `Workbench now shows ${cards.join(" above ")}.`
        : "Closed the workbench.";
      return done(
        highlight
          ? `${shown} Highlighting the ${highlight} card.`
          : params.highlight
            ? `${shown} Did not highlight ${params.highlight}: it is not one of the arranged cards.`
            : shown,
        command,
      );
    },
  });

  return [stateTool, openTool, closeTool, arrangeTool];
}
