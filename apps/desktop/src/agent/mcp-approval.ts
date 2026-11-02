import type { McpToolApprovalRequest } from "pi-mcp-adapter";
import type { ToolGate } from "./gate";

type ApprovalDecision = "allow_once" | "deny";

/** A JSON value with object keys sorted, so key order never matters. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** One exact call: the server tool and every argument value. */
export function mcpCallKey(
  request: Pick<
    McpToolApprovalRequest,
    "serverName" | "originalToolName" | "args"
  >,
): string {
  return JSON.stringify([
    request.serverName,
    request.originalToolName,
    canonical(request.args),
  ]);
}

/**
 * Spares the decision model a repeat of a call it has already allowed.
 *
 * An MCP script may make the very same call more than once in a turn; the
 * reviewer's allow for it is reused for the rest of the turn. Every call
 * that differs in any argument value is reviewed on its own, as are direct
 * (non-script) calls, and any deny clears what was allowed. Calls a script
 * starts together reach the reviewer as one batch through the gate. Only the
 * reviewer's allows are reused: a person's approval covers one call.
 */
export class McpScriptApprovalCache {
  private readonly allowed = new Set<string>();

  clear(): void {
    this.allowed.clear();
  }

  async decide(
    request: McpToolApprovalRequest,
    gate: ToolGate,
  ): Promise<ApprovalDecision> {
    const key = request.origin === "script" ? mcpCallKey(request) : undefined;
    if (key && this.allowed.has(key)) return "allow_once";

    const decision = await gate.reviewPrivilegedCall({
      toolCallId: request.requestId,
      toolName: request.prefixedToolName,
      subject: `${request.serverName}.${request.originalToolName} ${JSON.stringify(request.args)}`,
      evidence:
        "MCP tools execute in an external server outside Pine's project sandbox." +
        (request.origin === "script"
          ? " This call comes from an MCP script; an allow also covers repeats of exactly this call in this turn."
          : ""),
      signal: request.signal,
    });
    if (decision.kind !== "allow") {
      this.allowed.clear();
      return "deny";
    }
    if (key && decision.reviewer === "judge") this.allowed.add(key);
    return "allow_once";
  }
}
