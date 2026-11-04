import {
  defineTool,
  type AgentToolResult,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { PineApprovalMode, PineJsonValue } from "../../shared/agent";
import {
  ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME,
  AUTOMATION_REPORT_TOOL_NAME,
  type AutomationHostOperation,
  type AutomationModelSelection,
} from "../../shared/automation";
import type { ToolGate } from "../gate";
import AUTHORING_SKILL from "./automation-authoring/SKILL.md?raw";

export const AUTOMATION_LIST_TOOL_NAME = "automation_list";
export const AUTOMATION_GET_TOOL_NAME = "automation_get";
export const AUTOMATION_CHECK_TOOL_NAME = "automation_check";
export const AUTOMATION_SAVE_TOOL_NAME = "automation_save";
export const AUTOMATION_SET_ENABLED_TOOL_NAME = "automation_set_enabled";
export const AUTOMATION_RUN_NOW_TOOL_NAME = "automation_run_now";
export const AUTOMATION_DELETE_TOOL_NAME = "automation_delete";
export const AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES = [
  AUTOMATION_LIST_TOOL_NAME,
  AUTOMATION_GET_TOOL_NAME,
  AUTOMATION_CHECK_TOOL_NAME,
  AUTOMATION_SAVE_TOOL_NAME,
  AUTOMATION_SET_ENABLED_TOOL_NAME,
  AUTOMATION_RUN_NOW_TOOL_NAME,
  AUTOMATION_DELETE_TOOL_NAME,
] as const;

export type AutomationHostCall = (
  operation: AutomationHostOperation,
) => Promise<PineJsonValue>;

export interface AutomationAuthoringOptions {
  activated(): void;
  call: AutomationHostCall;
  getApprovalMode(): PineApprovalMode;
  getGate(): ToolGate | null;
  /** Plain-language account of a definition, from the approval model. */
  explain(
    spec: PineJsonValue,
    previous?: PineJsonValue,
  ): Promise<string | undefined>;
  /** Whether this turn has already read web or MCP content. */
  afterExternalContent(): boolean;
  /** This conversation's model, the default for new automations. */
  currentModel(): AutomationModelSelection | undefined;
}

const emptyParams = Type.Object({}, { additionalProperties: false });
const idSchema = Type.String({
  description: "Automation id from automation_list.",
  minLength: 1,
  maxLength: 100,
});
const specSchema = Type.Unknown({
  description:
    "The complete automation definition (version 1), as described in the authoring instructions.",
});

/** The instructions activation returns, also given by a session mutator. */
export function automationAuthoringInstructions(): string {
  return `<automation_authoring>\n${AUTHORING_SKILL.trim()}\n</automation_authoring>\n\nAutomation authoring is active for this session.`;
}

function jsonResult(value: unknown): AgentToolResult<Record<string, unknown>> {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    details: (value && typeof value === "object" ? value : { value }) as Record<
      string,
      unknown
    >,
  };
}

function hasScriptTrigger(spec: unknown): boolean {
  if (!spec || typeof spec !== "object") return false;
  const triggers = (spec as { triggers?: unknown }).triggers;
  return (
    Array.isArray(triggers) &&
    triggers.some(
      (trigger) =>
        trigger !== null &&
        typeof trigger === "object" &&
        (trigger as { kind?: unknown }).kind === "script",
    )
  );
}

function isRecord(value: unknown): value is Record<string, PineJsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Fills in `action.model` when the definition leaves it out: an update keeps
 * the model it had, and a new automation uses this conversation's model.
 */
export function withDefaultModel(
  spec: PineJsonValue,
  previous: PineJsonValue | undefined,
  current: AutomationModelSelection | undefined,
): PineJsonValue {
  if (!isRecord(spec) || !isRecord(spec.action) || spec.action.model)
    return spec;
  const previousModel =
    isRecord(previous) && isRecord(previous.action)
      ? previous.action.model
      : undefined;
  const model = previous === undefined ? current : previousModel;
  if (!model) return spec;
  return {
    ...spec,
    action: { ...spec.action, model: model as PineJsonValue },
  };
}

function validationErrors(result: PineJsonValue): string[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const errors = (result as { errors?: unknown }).errors;
  return Array.isArray(errors)
    ? errors.filter((error) => typeof error === "string")
    : [];
}

function createAuthoringDefinitions(
  options: AutomationAuthoringOptions,
  activate: () => void,
): ToolDefinition[] {
  const getParams = Type.Object(
    {
      id: idSchema,
      runId: Type.Optional(
        Type.String({
          description: "One run to read in full.",
          maxLength: 100,
        }),
      ),
    },
    { additionalProperties: false },
  );
  const checkParams = Type.Object(
    {
      spec: Type.Optional(specSchema),
      id: Type.Optional(idSchema),
      dryRun: Type.Optional(
        Type.Boolean({
          description:
            "Also run the detectors once against current data without starting the agent: lists matching files, runs the detection script, and evaluates when/payload. Nothing is recorded.",
        }),
      ),
      sampleEvents: Type.Optional(
        Type.Array(Type.Unknown(), {
          description:
            "Events to evaluate when/payload against instead of detecting.",
          maxItems: 100,
        }),
      ),
    },
    { additionalProperties: false },
  );
  const saveParams = Type.Object(
    {
      id: Type.Optional(idSchema),
      baseRevision: Type.Optional(
        Type.Integer({
          description:
            "Required with id: the revision automation_get returned.",
          minimum: 1,
        }),
      ),
      spec: specSchema,
      includeExisting: Type.Optional(
        Type.Boolean({
          description:
            "New automations only: also process files and items that already exist. Ask the user; the default only reacts to later changes.",
        }),
      ),
    },
    { additionalProperties: false },
  );
  const enableParams = Type.Object(
    {
      id: idSchema,
      enabled: Type.Boolean(),
      includeExisting: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  );
  const idParams = Type.Object(
    { id: idSchema },
    { additionalProperties: false },
  );

  return [
    defineTool({
      name: ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME,
      label: "Activate Automation Authoring",
      description:
        "Enable Pine's automation tools and load their instructions. Use when the user wants something to happen on a schedule, when files change, when the computer wakes, or when a website or feed has something new; or to inspect, change, pause or delete existing automations.",
      promptSnippet:
        "Activate automation tools only when the user wants recurring or event-driven work, or asks about existing automations",
      parameters: emptyParams,
      prepareArguments: () => ({}),
      executionMode: "sequential",
      execute: () => {
        activate();
        return Promise.resolve(jsonResult(automationAuthoringInstructions()));
      },
    }),
    defineTool({
      name: AUTOMATION_LIST_TOOL_NAME,
      label: "List Automations",
      description:
        "List this project's automations and the secret names the user has saved (never values).",
      parameters: emptyParams,
      prepareArguments: () => ({}),
      execute: async () => {
        const [automations, secrets] = await Promise.all([
          options.call({ op: "list" }),
          options.call({ op: "secrets" }),
        ]);
        return jsonResult({ automations, secrets });
      },
    }),
    defineTool({
      name: AUTOMATION_GET_TOOL_NAME,
      label: "Get Automation",
      description:
        "Read one automation's full definition, revision and recent runs, or one run's events, report and transcript.",
      parameters: getParams,
      prepareArguments: (args) => args as Static<typeof getParams>,
      execute: async (_toolCallId, params) => {
        if (params.runId)
          return jsonResult(
            await options.call({
              op: "runs",
              id: params.id,
              runId: params.runId,
            }),
          );
        const [automation, runs] = await Promise.all([
          options.call({ op: "get", id: params.id }),
          options.call({ op: "runs", id: params.id, limit: 10 }),
        ]);
        return jsonResult({ automation, runs });
      },
    }),
    defineTool({
      name: AUTOMATION_CHECK_TOOL_NAME,
      label: "Check Automation",
      description:
        "Validate a definition and optionally dry-run its detectors. Always check before automation_save, and fix every error it reports.",
      parameters: checkParams,
      prepareArguments: (args) => args as Static<typeof checkParams>,
      execute: async (toolCallId, params, signal) => {
        if (params.spec === undefined && !params.id)
          throw new Error("Pass spec or id.");
        const result: Record<string, PineJsonValue> = {};
        if (params.spec !== undefined) {
          const validation = await options.call({
            op: "validate",
            spec: params.spec as PineJsonValue,
          });
          result.validation = validation;
          if (validationErrors(validation).length > 0 || !params.dryRun)
            return jsonResult(result);
        }
        if (params.dryRun || params.sampleEvents) {
          // A detection script reaches the network with the user's secrets.
          if (
            options.getApprovalMode() !== "YOLO" &&
            params.spec !== undefined &&
            hasScriptTrigger(params.spec) &&
            !params.sampleEvents
          ) {
            const gate = options.getGate();
            if (!gate) throw new Error("Dry runs need an approval gate.");
            const decision = await gate.reviewPrivilegedCall({
              toolCallId,
              toolName: AUTOMATION_CHECK_TOOL_NAME,
              subject: "automation detection script",
              description: "Run an automation's detection script once",
              evidence: `The script may contact only the hosts it declares and read only the folders it declares, with the secrets it names. Definition:\n${JSON.stringify(params.spec, null, 2).slice(0, 12_000)}`,
              signal,
            });
            if (decision.kind === "deny")
              throw new Error(decision.reason ?? "The dry run was denied.");
          }
          result.dryRun = await options.call({
            op: "dry-run",
            ...(params.spec !== undefined
              ? { spec: params.spec as PineJsonValue }
              : {}),
            ...(params.id ? { id: params.id } : {}),
            ...(params.sampleEvents
              ? { sampleEvents: params.sampleEvents as PineJsonValue }
              : {}),
          });
        }
        return jsonResult(result);
      },
    }),
    defineTool({
      name: AUTOMATION_SAVE_TOOL_NAME,
      label: "Save Automation",
      description:
        "Create an automation, or replace one (with id and baseRevision). The user approves it on this computer before it is saved; the call waits for that decision. Without action.model a new automation runs on this conversation's current model and thinking level, and an update keeps its model; set action.model only when the user asks for a specific model, using ids from ui_list_models.",
      parameters: saveParams,
      prepareArguments: (args) => args as Static<typeof saveParams>,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        if (params.id && params.baseRevision === undefined)
          throw new Error(
            "Pass baseRevision from automation_get when updating.",
          );
        const previous = params.id
          ? (
              (await options.call({ op: "get", id: params.id })) as {
                spec?: PineJsonValue;
              }
            ).spec
          : undefined;
        const spec = withDefaultModel(
          params.spec as PineJsonValue,
          previous,
          options.currentModel(),
        );
        const validation = await options.call({ op: "validate", spec });
        const errors = validationErrors(validation);
        if (errors.length > 0) return jsonResult({ saved: false, errors });
        const explanation = await options
          .explain(spec, previous)
          .catch(() => undefined);
        const afterExternalContent = options.afterExternalContent();
        const result = params.id
          ? await options.call({
              op: "update",
              id: params.id,
              baseRevision: params.baseRevision!,
              spec,
              afterExternalContent,
              ...(explanation ? { explanation } : {}),
            })
          : await options.call({
              op: "create",
              spec,
              afterExternalContent,
              ...(explanation ? { explanation } : {}),
              ...(params.includeExisting ? { includeExisting: true } : {}),
            });
        return jsonResult(result);
      },
    }),
    defineTool({
      name: AUTOMATION_SET_ENABLED_TOOL_NAME,
      label: "Enable or Pause Automation",
      description:
        "Pause or resume an automation. Resuming needs the user's approval on this computer.",
      parameters: enableParams,
      prepareArguments: (args) => args as Static<typeof enableParams>,
      executionMode: "sequential",
      execute: async (_toolCallId, params) =>
        jsonResult(
          await options.call({
            op: "set-enabled",
            id: params.id,
            enabled: params.enabled,
            ...(params.includeExisting ? { includeExisting: true } : {}),
          }),
        ),
    }),
    defineTool({
      name: AUTOMATION_RUN_NOW_TOOL_NAME,
      label: "Run Automation Now",
      description:
        "Start one run of an enabled automation now, with no detected events. Returns immediately; read the result later with automation_get.",
      parameters: idParams,
      prepareArguments: (args) => args as Static<typeof idParams>,
      execute: async (_toolCallId, params) =>
        jsonResult(await options.call({ op: "run-now", id: params.id })),
    }),
    defineTool({
      name: AUTOMATION_DELETE_TOOL_NAME,
      label: "Delete Automation",
      description:
        "Delete an automation and its run history. The user confirms on this computer.",
      parameters: idParams,
      prepareArguments: (args) => args as Static<typeof idParams>,
      executionMode: "sequential",
      execute: async (_toolCallId, params) =>
        jsonResult(await options.call({ op: "delete", id: params.id })),
    }),
  ];
}

export function createAutomationAuthoringExtension(
  options: AutomationAuthoringOptions,
): InlineExtension {
  return {
    name: "pine-automation-authoring",
    factory: (pi) => {
      const activate = () => {
        const active = pi.getActiveTools();
        const added = AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES.filter(
          (name) => !active.includes(name),
        );
        if (added.length > 0) pi.setActiveTools([...active, ...added]);
        options.activated();
      };
      for (const tool of createAuthoringDefinitions(options, activate))
        pi.registerTool(tool);
    },
  };
}

/** The tool a run ends with; main records what it means. */
export function createAutomationReportTool(
  runId: string,
  call: AutomationHostCall,
): ToolDefinition {
  const params = Type.Object(
    {
      status: Type.Union([Type.Literal("findings"), Type.Literal("nothing")], {
        description:
          '"findings" when there is something for the user; "nothing" when this run found nothing new.',
      }),
      summary: Type.String({
        description:
          "One to three short sentences for the user's notification and activity list. No secrets.",
        minLength: 1,
        maxLength: 4_000,
      }),
      outputs: Type.Optional(
        Type.Array(Type.String({ maxLength: 4_096 }), {
          description: "Paths of files this run created or updated.",
          maxItems: 50,
        }),
      ),
      cursor: Type.Optional(
        Type.Unknown({
          description:
            "Small JSON the next run receives as state.cursor, such as the newest item you handled. Omit to keep the previous one.",
        }),
      ),
    },
    { additionalProperties: false },
  );
  return defineTool({
    name: AUTOMATION_REPORT_TOOL_NAME,
    label: "Report Automation Result",
    description:
      "Finish this automation run: record whether it found something and a short summary. Call exactly once, as the last step.",
    parameters: params,
    prepareArguments: (args) => args as Static<typeof params>,
    executionMode: "sequential",
    execute: async (_toolCallId, input) =>
      jsonResult(
        await call({
          op: "report",
          runId,
          status: input.status,
          summary: input.summary,
          ...(input.outputs ? { outputs: input.outputs } : {}),
          ...(input.cursor !== undefined
            ? { cursor: input.cursor as PineJsonValue }
            : {}),
        }),
      ),
  }) as ToolDefinition;
}
