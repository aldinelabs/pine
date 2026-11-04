export const LIST_MCP_SERVERS_CHANNEL = "mcp:list" as const;
export const SAVE_MCP_SERVER_CHANNEL = "mcp:save" as const;
export const REMOVE_MCP_SERVER_CHANNEL = "mcp:remove" as const;

export type PineMcpScope = "project" | "global";

export interface PineMcpServer {
  name: string;
  scope: PineMcpScope;
  definition: Record<string, unknown>;
}

export interface PineMcpCatalog {
  servers: PineMcpServer[];
  paths: Record<PineMcpScope, string>;
  status?: {
    servers: ReadonlyArray<{
      name: string;
      status: string;
      toolCount: number;
      resourceCount?: number;
    }>;
    connectedCount: number;
    totalTools: number;
  };
}

export interface PineMcpRequest {
  projectId: string;
}

export interface PineMcpMutation extends PineMcpRequest {
  scope: PineMcpScope;
  name: string;
}

export interface PineMcpSaveRequest extends PineMcpMutation {
  previousName?: string;
  definition: Record<string, unknown>;
}

/** MCP config tools the authoring activation enables. */
export const MCP_CONFIG_LIST_TOOL_NAME = "mcp_config_list" as const;
export const MCP_CONFIG_SAVE_TOOL_NAME = "mcp_config_save" as const;
export const MCP_CONFIG_SET_ENABLED_TOOL_NAME =
  "mcp_config_set_enabled" as const;
export const MCP_CONFIG_REMOVE_TOOL_NAME = "mcp_config_remove" as const;
export const MCP_AUTHORING_DYNAMIC_TOOL_NAMES = [
  MCP_CONFIG_LIST_TOOL_NAME,
  MCP_CONFIG_SAVE_TOOL_NAME,
  MCP_CONFIG_SET_ENABLED_TOOL_NAME,
  MCP_CONFIG_REMOVE_TOOL_NAME,
] as const;

export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Host operations the MCP authoring tools ask main for. */
export type McpHostOperation =
  | { op: "list" }
  | {
      op: "save";
      scope: PineMcpScope;
      name: string;
      previousName?: string;
      definition: Record<string, unknown>;
    }
  | { op: "set-enabled"; scope: PineMcpScope; name: string; enabled: boolean }
  | { op: "remove"; scope: PineMcpScope; name: string };

/** Stands in for a credential the model is not shown. */
export const MCP_REDACTED_VALUE = "<redacted>" as const;

/** References like `${VAR}`, `$env:VAR` or `{env:VAR}` name a secret without
 * holding it, so they stay readable. */
function isSecretReference(value: string): boolean {
  return /^\s*(\$\{[^}]+\}|\$env:[A-Za-z_][A-Za-z0-9_]*|\{env:[^}]+\})\s*$/.test(
    value,
  );
}

function redactRecord(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === "string" && !isSecretReference(entry)
        ? MCP_REDACTED_VALUE
        : entry,
    ]),
  );
}

/**
 * A server definition with literal credentials replaced: `env` and `headers`
 * values, `bearerToken` and `oauth.clientSecret`. Variable references stay.
 */
export function redactMcpDefinition(
  definition: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...definition };
  if ("env" in redacted) redacted.env = redactRecord(redacted.env);
  if ("headers" in redacted) redacted.headers = redactRecord(redacted.headers);
  if (
    typeof redacted.bearerToken === "string" &&
    !isSecretReference(redacted.bearerToken)
  )
    redacted.bearerToken = MCP_REDACTED_VALUE;
  const oauth = redacted.oauth;
  if (
    oauth &&
    typeof oauth === "object" &&
    !Array.isArray(oauth) &&
    typeof (oauth as Record<string, unknown>).clientSecret === "string" &&
    !isSecretReference((oauth as Record<string, string>).clientSecret)
  )
    redacted.oauth = { ...oauth, clientSecret: MCP_REDACTED_VALUE };
  return redacted;
}

function restoreRecord(next: unknown, previous: unknown): unknown {
  if (!next || typeof next !== "object" || Array.isArray(next)) return next;
  const before =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(next).flatMap(([key, entry]) => {
      if (entry !== MCP_REDACTED_VALUE) return [[key, entry]];
      return typeof before[key] === "string" ? [[key, before[key]]] : [];
    }),
  );
}

/**
 * Put back the credentials a redacted definition left as placeholders, from
 * the saved definition it replaces. A placeholder with nothing to restore is
 * dropped rather than saved literally.
 */
export function restoreRedactedMcpValues(
  next: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const restored: Record<string, unknown> = { ...next };
  if ("env" in restored)
    restored.env = restoreRecord(restored.env, previous?.env);
  if ("headers" in restored)
    restored.headers = restoreRecord(restored.headers, previous?.headers);
  if (restored.bearerToken === MCP_REDACTED_VALUE) {
    if (typeof previous?.bearerToken === "string")
      restored.bearerToken = previous.bearerToken;
    else delete restored.bearerToken;
  }
  const oauth = restored.oauth;
  if (
    oauth &&
    typeof oauth === "object" &&
    !Array.isArray(oauth) &&
    (oauth as Record<string, unknown>).clientSecret === MCP_REDACTED_VALUE
  ) {
    const previousSecret = (
      previous?.oauth as Record<string, unknown> | undefined
    )?.clientSecret;
    const rest = { ...(oauth as Record<string, unknown>) };
    delete rest.clientSecret;
    restored.oauth =
      typeof previousSecret === "string"
        ? { ...rest, clientSecret: previousSecret }
        : rest;
  }
  return restored;
}
