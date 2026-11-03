import { loadMcpConfig } from "pi-mcp-adapter/config";
import type { AutomationMcpGrant } from "../../shared/automation";

type McpConfig = ReturnType<typeof loadMcpConfig>;

/**
 * The MCP configuration a run starts with: only the servers its definition
 * names, with every way of changing or widening them switched off.
 */
export function automationMcpConfig(
  configPath: string,
  cwd: string,
  grants: readonly AutomationMcpGrant[],
): McpConfig {
  const config = loadMcpConfig(configPath, cwd);
  const servers = new Set(grants.map((grant) => grant.server));
  return {
    mcpServers: Object.fromEntries(
      Object.entries(config.mcpServers).filter(([name]) => servers.has(name)),
    ),
    settings: {
      ...config.settings,
      allowInstall: false,
      autoAuth: false,
      sampling: false,
      samplingAutoApprove: false,
      elicitation: false,
      jev: false,
    },
  };
}

/** Whether a run's definition lists this server tool. */
export function isGrantedMcpTool(
  grants: readonly AutomationMcpGrant[],
  serverName: string,
  toolName: string,
): boolean {
  return grants.some(
    (grant) => grant.server === serverName && grant.tools.includes(toolName),
  );
}
