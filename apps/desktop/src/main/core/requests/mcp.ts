import { z } from "zod";
import {
  LIST_MCP_SERVERS_CHANNEL,
  REMOVE_MCP_SERVER_CHANNEL,
  SAVE_MCP_SERVER_CHANNEL,
  type PineMcpCatalog,
} from "../../../shared/mcp";
import {
  listMcpServers,
  removeMcpServer,
  saveMcpServer,
} from "../../mcpConfig";
import type { PineRequestContext } from "../../requestRouter";
import type { PineCore } from "../pineCore";
import { McpIdentitySchema } from "../requestSchemas";

export function registerMcpRequests(core: PineCore): void {
  const { runtimes } = core;

  async function catalog(
    context: PineRequestContext,
    projectId: string,
  ): Promise<PineMcpCatalog> {
    const servers = await listMcpServers(
      await core.defaultFolderPath(projectId),
    );
    if (runtimes.isOpen(context.clientId, projectId)) {
      const status = await runtimes.getMcpStatus(context.clientId, projectId);
      if (status) servers.status = status;
    }
    return servers;
  }

  async function reloadIfOpen(
    context: PineRequestContext,
    projectId: string,
  ): Promise<void> {
    if (runtimes.isOpen(context.clientId, projectId))
      await runtimes.reloadMcp(context.clientId, projectId);
  }

  core.handle(
    LIST_MCP_SERVERS_CHANNEL,
    async (context, request: unknown): Promise<PineMcpCatalog> => {
      const { projectId } = z.object({ projectId: z.uuid() }).parse(request);
      return catalog(context, projectId);
    },
  );

  core.handle(
    SAVE_MCP_SERVER_CHANNEL,
    async (context, request: unknown): Promise<PineMcpCatalog> => {
      const parsed = McpIdentitySchema.extend({
        previousName: McpIdentitySchema.shape.name.optional(),
        definition: z.record(z.string(), z.unknown()),
      }).parse(request);
      if (
        typeof parsed.definition.command !== "string" &&
        typeof parsed.definition.url !== "string"
      )
        throw new Error("An MCP server needs a command or URL.");
      await saveMcpServer(
        await core.defaultFolderPath(parsed.projectId),
        parsed,
      );
      await reloadIfOpen(context, parsed.projectId);
      return catalog(context, parsed.projectId);
    },
  );

  core.handle(
    REMOVE_MCP_SERVER_CHANNEL,
    async (context, request: unknown): Promise<PineMcpCatalog> => {
      const parsed = McpIdentitySchema.parse(request);
      await removeMcpServer(
        await core.defaultFolderPath(parsed.projectId),
        parsed,
      );
      await reloadIfOpen(context, parsed.projectId);
      return catalog(context, parsed.projectId);
    },
  );
}
