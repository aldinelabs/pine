import {
  defineTool,
  type AgentToolResult,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { PineJsonValue } from "../../shared/agent";
import {
  MCP_AUTHORING_DYNAMIC_TOOL_NAMES,
  MCP_CONFIG_LIST_TOOL_NAME,
  MCP_CONFIG_REMOVE_TOOL_NAME,
  MCP_CONFIG_SAVE_TOOL_NAME,
  MCP_CONFIG_SET_ENABLED_TOOL_NAME,
  MCP_SERVER_NAME_PATTERN,
  redactMcpDefinition,
  type McpHostOperation,
  type PineMcpScope,
} from "../../shared/mcp";
import { ACTIVATE_MCP_AUTHORING_TOOL_NAME } from "../../shared/sessionMutators";
import type { GateDecision } from "../protocol";
import AUTHORING_SKILL from "./mcp-authoring/SKILL.md?raw";

export { ACTIVATE_MCP_AUTHORING_TOOL_NAME, MCP_AUTHORING_DYNAMIC_TOOL_NAMES };

export type McpHostCall = (
  operation: McpHostOperation,
) => Promise<PineJsonValue>;

export interface McpAuthoringOptions {
  activated(): void;
  call: McpHostCall;
  /**
   * Ask the user, whatever the approval mode: a server runs a program or
   * reaches a service with the user's credentials outside Pine's sandbox.
   */
  requestApproval(input: {
    toolCallId: string;
    toolName: string;
    subject: string;
    description: string;
    evidence: string;
    signal?: AbortSignal;
  }): Promise<GateDecision>;
  /** Reload this session's MCP connections once its run ends. */
  reloadWhenIdle(): void;
}

/** The instructions activation returns, also given by a session mutator. */
export function mcpAuthoringInstructions(): string {
  return `<mcp_authoring>\n${AUTHORING_SKILL.trim()}\n</mcp_authoring>\n\nMCP authoring is active for this session.`;
}

const emptyParams = Type.Object({}, { additionalProperties: false });
const scopeSchema = Type.Union(
  [Type.Literal("project"), Type.Literal("global")],
  {
    description:
      '"project" for this project only (.mcp.json in its default folder), "global" for every project (~/.config/mcp/mcp.json).',
  },
);
const nameSchema = Type.String({
  description:
    "Server name: letters, digits, dot, underscore or hyphen, starting with a letter or digit.",
  minLength: 1,
  maxLength: 100,
  pattern: MCP_SERVER_NAME_PATTERN.source,
});

function jsonResult(value: unknown): AgentToolResult<Record<string, unknown>> {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    details: (value && typeof value === "object" && !Array.isArray(value)
      ? value
      : { value }) as Record<string, unknown>,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Problems that keep a definition from being saved; empty when it is fine. */
export function mcpDefinitionErrors(definition: unknown): string[] {
  if (!isRecord(definition)) return ["The definition must be a JSON object."];
  const transports = ["command", "url", "socket"].filter(
    (key) => definition[key] !== undefined,
  );
  const errors: string[] = [];
  if (transports.length !== 1)
    errors.push('Set exactly one of "command", "url" or "socket".');
  for (const key of transports)
    if (typeof definition[key] !== "string" || !definition[key])
      errors.push(`"${key}" must be a non-empty string.`);
  if (
    definition.args !== undefined &&
    (!Array.isArray(definition.args) ||
      definition.args.some((arg) => typeof arg !== "string"))
  )
    errors.push('"args" must be an array of strings.');
  for (const key of ["env", "headers"])
    if (
      definition[key] !== undefined &&
      (!isRecord(definition[key]) ||
        Object.values(definition[key]).some(
          (value) => typeof value !== "string",
        ))
    )
      errors.push(`"${key}" must map names to strings.`);
  if (definition.name !== undefined)
    errors.push('Pass the server name in "name", not inside the definition.');
  return errors;
}

function approvalEvidence(
  scope: PineMcpScope,
  name: string,
  definition: Record<string, unknown>,
): string {
  const transport =
    typeof definition.command === "string"
      ? `It launches \`${[definition.command, ...((definition.args as string[] | undefined) ?? [])].join(" ")}\` with your permissions, outside Pine's sandbox.`
      : `It connects to ${String(definition.url ?? definition.socket)}.`;
  const where =
    scope === "global"
      ? "Global scope: every Pine project can use it."
      : "Project scope: only this project uses it.";
  return `${transport} ${where}\n\nDefinition of "${name}" (credentials hidden):\n${JSON.stringify(redactMcpDefinition(definition), null, 2).slice(0, 12_000)}`;
}

async function requireApproval(
  options: McpAuthoringOptions,
  input: Parameters<McpAuthoringOptions["requestApproval"]>[0],
): Promise<void> {
  const decision = await options.requestApproval(input);
  if (decision.kind === "deny")
    throw new Error(decision.reason ?? "The user declined the MCP change.");
}

function createDefinitions(
  options: McpAuthoringOptions,
  activate: () => void,
): ToolDefinition[] {
  const saveParams = Type.Object(
    {
      scope: scopeSchema,
      name: nameSchema,
      previousName: Type.Optional(
        Type.String({
          description:
            "The server's current name when renaming it in the same scope.",
          minLength: 1,
          maxLength: 100,
          pattern: MCP_SERVER_NAME_PATTERN.source,
        }),
      ),
      definition: Type.Record(Type.String(), Type.Unknown(), {
        description:
          "The complete server entry (the value under mcpServers.<name>), as described in the authoring instructions.",
      }),
    },
    { additionalProperties: false },
  );
  const enableParams = Type.Object(
    { scope: scopeSchema, name: nameSchema, enabled: Type.Boolean() },
    { additionalProperties: false },
  );
  const removeParams = Type.Object(
    { scope: scopeSchema, name: nameSchema },
    { additionalProperties: false },
  );

  return [
    defineTool({
      name: ACTIVATE_MCP_AUTHORING_TOOL_NAME,
      label: "Activate MCP Authoring",
      description:
        "Enable Pine's MCP configuration tools and load instructions on how Pine configures MCP servers. Use when the user wants to add, change, enable, disable or remove an MCP server, or connect Pine to a new tool or service through MCP.",
      promptSnippet:
        "Activate MCP configuration tools only when the user wants to add, change or remove MCP servers",
      parameters: emptyParams,
      prepareArguments: () => ({}),
      executionMode: "sequential",
      execute: () => {
        activate();
        return Promise.resolve(jsonResult(mcpAuthoringInstructions()));
      },
    }),
    defineTool({
      name: MCP_CONFIG_LIST_TOOL_NAME,
      label: "List MCP Servers",
      description:
        "List the MCP servers Pine's settings manage in global and project scope, with their definitions (literal credentials redacted), config file paths and connection status.",
      parameters: emptyParams,
      prepareArguments: () => ({}),
      execute: async () => jsonResult(await options.call({ op: "list" })),
    }),
    defineTool({
      name: MCP_CONFIG_SAVE_TOOL_NAME,
      label: "Save MCP Server",
      description:
        "Add an MCP server or replace one with the same name. The user approves it in every approval mode; the call waits for that decision. Pine reloads MCP connections after this response, so the server is usable from the next message.",
      parameters: saveParams,
      prepareArguments: (args) => args as Static<typeof saveParams>,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal) => {
        const errors = mcpDefinitionErrors(params.definition);
        if (errors.length > 0) return jsonResult({ saved: false, errors });
        await requireApproval(options, {
          toolCallId,
          toolName: MCP_CONFIG_SAVE_TOOL_NAME,
          subject: `${params.scope} MCP server ${params.name}`,
          description: params.previousName
            ? `Update MCP server "${params.previousName}" as "${params.name}"`
            : `Save MCP server "${params.name}"`,
          evidence: approvalEvidence(
            params.scope,
            params.name,
            params.definition,
          ),
          signal,
        });
        const result = await options.call({
          op: "save",
          scope: params.scope,
          name: params.name,
          ...(params.previousName ? { previousName: params.previousName } : {}),
          definition: params.definition,
        });
        options.reloadWhenIdle();
        return jsonResult({
          saved: true,
          name: params.name,
          ...asRecord(result),
        });
      },
    }),
    defineTool({
      name: MCP_CONFIG_SET_ENABLED_TOOL_NAME,
      label: "Enable or Disable MCP Server",
      description:
        "Disable an MCP server while keeping its definition, or enable it again. Enabling needs the user's approval.",
      parameters: enableParams,
      prepareArguments: (args) => args as Static<typeof enableParams>,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal) => {
        if (params.enabled)
          await requireApproval(options, {
            toolCallId,
            toolName: MCP_CONFIG_SET_ENABLED_TOOL_NAME,
            subject: `${params.scope} MCP server ${params.name}`,
            description: `Enable MCP server "${params.name}"`,
            evidence: `Pine will connect to the ${params.scope} MCP server "${params.name}" again and its tools become available.`,
            signal,
          });
        const result = await options.call({
          op: "set-enabled",
          scope: params.scope,
          name: params.name,
          enabled: params.enabled,
        });
        options.reloadWhenIdle();
        return jsonResult({
          name: params.name,
          enabled: params.enabled,
          ...asRecord(result),
        });
      },
    }),
    defineTool({
      name: MCP_CONFIG_REMOVE_TOOL_NAME,
      label: "Remove MCP Server",
      description:
        "Remove an MCP server from Pine's configuration. Use only when the user asks.",
      parameters: removeParams,
      prepareArguments: (args) => args as Static<typeof removeParams>,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        const result = await options.call({
          op: "remove",
          scope: params.scope,
          name: params.name,
        });
        options.reloadWhenIdle();
        return jsonResult({
          removed: true,
          name: params.name,
          ...asRecord(result),
        });
      },
    }),
  ];
}

function asRecord(value: PineJsonValue): Record<string, PineJsonValue> {
  return isRecord(value) ? (value as Record<string, PineJsonValue>) : {};
}

export function createMcpAuthoringExtension(
  options: McpAuthoringOptions,
): InlineExtension {
  return {
    name: "pine-mcp-authoring",
    factory: (pi) => {
      const activate = () => {
        const active = pi.getActiveTools();
        const added = MCP_AUTHORING_DYNAMIC_TOOL_NAMES.filter(
          (name) => !active.includes(name),
        );
        if (added.length > 0) pi.setActiveTools([...active, ...added]);
        options.activated();
      };
      for (const tool of createDefinitions(options, activate))
        pi.registerTool(tool);
    },
  };
}
