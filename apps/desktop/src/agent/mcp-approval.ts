import type { McpToolApprovalRequest } from "pi-mcp-adapter";
import type { ToolGate } from "./gate";

type ApprovalDecision = "allow_once" | "deny";

/**
 * Shape of a JSON value: object keys and primitive types, never the values.
 * Arrays collapse to the shape of their first element so a loop that varies
 * only list length keeps one key.
 */
function shapeOf(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value))
    return [value.length > 0 ? shapeOf(value[0]) : "empty"];
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, item]) => [key, shapeOf(item)]),
    );
  }
  return typeof value;
}

export function mcpShapeKey(
  request: Pick<
    McpToolApprovalRequest,
    "serverName" | "originalToolName" | "args"
  >,
): string {
  return JSON.stringify([
    request.serverName,
    request.originalToolName,
    shapeOf(request.args),
  ]);
}

/**
 * Cuts auto-approval cost for MCP scripts that call one tool in a loop.
 *
 * Each script call used to be reviewed by the decision model on its own. A
 * judge `allow` for a script call is now reused, for the rest of the turn, for
 * later script calls to the same server tool whose arguments have the same
 * shape (same keys and value types). Anything else, including a different tool,
 * a different argument shape, a direct (non-script) call, or any earlier deny,
 * still goes through the gate, so denials and user prompts are unchanged. Only
 * the reviewer's allows are reused: a person's approval covers one call.
 *
 * Trade-off: argument values may differ between reused calls, so the first
 * reviewed call stands in for the loop. Values the judge must see (a new tool,
 * a new argument key) always trigger a fresh review.
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
    const key = request.origin === "script" ? mcpShapeKey(request) : undefined;
    if (key && this.allowed.has(key)) return "allow_once";

    const decision = await gate.reviewPrivilegedCall({
      toolCallId: request.requestId,
      toolName: request.prefixedToolName,
      subject: `${request.serverName}.${request.originalToolName} ${JSON.stringify(request.args)}`,
      evidence:
        "MCP tools execute in an external server outside Pine's project sandbox." +
        (request.origin === "script"
          ? " This call comes from an MCP script; an allow covers later calls of this tool with the same argument shape in this turn."
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
