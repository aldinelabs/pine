import { describe, expect, it } from "vitest";
import {
  MCP_REDACTED_VALUE,
  redactMcpDefinition,
  restoreRedactedMcpValues,
} from "../mcp";

const saved = {
  url: "https://mcp.example.com/mcp",
  headers: { Authorization: "Bearer secret", "X-Team": "${TEAM_ID}" },
  env: { TOKEN: "literal", HOME_DIR: "$env:HOME" },
  bearerToken: "abc",
  oauth: { clientId: "pine", clientSecret: "shh" },
};

describe("MCP credential redaction", () => {
  it("hides literal credentials and keeps variable references", () => {
    expect(redactMcpDefinition(saved)).toEqual({
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: MCP_REDACTED_VALUE, "X-Team": "${TEAM_ID}" },
      env: { TOKEN: MCP_REDACTED_VALUE, HOME_DIR: "$env:HOME" },
      bearerToken: MCP_REDACTED_VALUE,
      oauth: { clientId: "pine", clientSecret: MCP_REDACTED_VALUE },
    });
  });

  it("puts saved values back where a redacted definition kept placeholders", () => {
    const edited = {
      ...redactMcpDefinition(saved),
      url: "https://mcp.example.com/v2",
      env: { TOKEN: MCP_REDACTED_VALUE, NEW: "value" },
    };
    expect(restoreRedactedMcpValues(edited, saved)).toEqual({
      ...saved,
      url: "https://mcp.example.com/v2",
      env: { TOKEN: "literal", NEW: "value" },
    });
  });

  it("drops placeholders that have nothing to restore", () => {
    expect(
      restoreRedactedMcpValues(
        {
          command: "server",
          env: { TOKEN: MCP_REDACTED_VALUE },
          bearerToken: MCP_REDACTED_VALUE,
          oauth: { clientSecret: MCP_REDACTED_VALUE },
        },
        undefined,
      ),
    ).toEqual({ command: "server", env: {}, oauth: {} });
  });
});
