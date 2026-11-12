import { z } from "zod";
import type { PineJsonValue } from "../../../shared/agent";
import {
  LIST_MCP_SERVERS_CHANNEL,
  MCP_SERVER_NAME_PATTERN,
  REMOVE_MCP_SERVER_CHANNEL,
  SAVE_MCP_SERVER_CHANNEL,
  redactMcpDefinition,
  restoreRedactedMcpValues,
  type McpHostOperation,
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

const McpHostOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list") }),
  z.object({
    op: z.literal("save"),
    scope: z.enum(["project", "global"]),
    name: z.string().regex(MCP_SERVER_NAME_PATTERN).max(100),
    previousName: z.string().regex(MCP_SERVER_NAME_PATTERN).max(100).optional(),
    definition: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("set-enabled"),
    scope: z.enum(["project", "global"]),
    name: z.string().regex(MCP_SERVER_NAME_PATTERN).max(100),
    enabled: z.boolean(),
  }),
  z.object({
    op: z.literal("remove"),
    scope: z.enum(["project", "global"]),
    name: z.string().regex(MCP_SERVER_NAME_PATTERN).max(100),
  }),
]);

/**
 * Answers the MCP authoring tools of a session in `projectId`. The tool has
 * already asked the user; this writes the same files as Pine's MCP settings
 * and reloads the project's sessions (a running one reloads when it ends).
 * The model never sees literal credentials, so a save puts back the ones it
 * left as placeholders.
 */
export async function answerMcpOperation(
  core: PineCore,
  requester: { sessionId: string; projectId: string },
  operation: McpHostOperation,
): Promise<PineJsonValue> {
  const parsed = McpHostOperationSchema.parse(operation);
  const cwd = await core.defaultFolderPath(requester.projectId);
  const json = (value: unknown) =>
    JSON.parse(JSON.stringify(value ?? null)) as PineJsonValue;
  const catalog = await listMcpServers(cwd);
  const find = (scope: string, name: string) =>
    catalog.servers.find(
      (server) => server.scope === scope && server.name === name,
    );
  const reload = async () => {
    const owner = core.runtimes.ownerOfProject(requester.projectId);
    if (owner !== undefined)
      await core.runtimes
        .reloadMcp(owner, requester.projectId)
        .catch(() => undefined);
  };
  switch (parsed.op) {
    case "list": {
      const owner = core.runtimes.ownerOfProject(requester.projectId);
      const status =
        owner === undefined
          ? undefined
          : await core.runtimes
              .getMcpStatus(owner, requester.projectId)
              .catch(() => undefined);
      return json({
        paths: catalog.paths,
        servers: catalog.servers.map((server) => ({
          name: server.name,
          scope: server.scope,
          disabled: server.definition.disabled === true,
          definition: redactMcpDefinition(server.definition),
        })),
        ...(status ? { status } : {}),
      });
    }
    case "save": {
      if (
        parsed.previousName !== undefined &&
        !find(parsed.scope, parsed.previousName)
      )
        throw new Error(
          `There is no ${parsed.scope} MCP server named "${parsed.previousName}".`,
        );
      if (
        parsed.previousName !== parsed.name &&
        find(parsed.scope, parsed.name) &&
        parsed.previousName !== undefined
      )
        throw new Error(
          `A ${parsed.scope} MCP server named "${parsed.name}" already exists.`,
        );
      const previous = find(parsed.scope, parsed.previousName ?? parsed.name);
      await saveMcpServer(cwd, {
        projectId: requester.projectId,
        scope: parsed.scope,
        name: parsed.name,
        ...(parsed.previousName ? { previousName: parsed.previousName } : {}),
        definition: restoreRedactedMcpValues(
          parsed.definition,
          previous?.definition,
        ),
      });
      await reload();
      return json({ path: catalog.paths[parsed.scope], created: !previous });
    }
    case "set-enabled": {
      const server = find(parsed.scope, parsed.name);
      if (!server)
        throw new Error(
          `There is no ${parsed.scope} MCP server named "${parsed.name}".`,
        );
      const definition = { ...server.definition };
      delete definition.disabled;
      await saveMcpServer(cwd, {
        projectId: requester.projectId,
        scope: parsed.scope,
        name: parsed.name,
        definition: parsed.enabled
          ? definition
          : { ...definition, disabled: true },
      });
      await reload();
      return json({ path: catalog.paths[parsed.scope] });
    }
    case "remove": {
      if (!find(parsed.scope, parsed.name))
        throw new Error(
          `There is no ${parsed.scope} MCP server named "${parsed.name}".`,
        );
      await removeMcpServer(cwd, {
        projectId: requester.projectId,
        scope: parsed.scope,
        name: parsed.name,
      });
      await reload();
      return json({ path: catalog.paths[parsed.scope] });
    }
  }
}

/**
 * The MCP servers of a project, with their live status when this client holds
 * the project. Definitions are returned as stored, credentials included, so a
 * caller that shows them elsewhere redacts them first.
 */
export async function listMcpCatalog(
  core: PineCore,
  clientId: number,
  projectId: string,
): Promise<PineMcpCatalog> {
  const servers = await listMcpServers(await core.defaultFolderPath(projectId));
  if (core.runtimes.isOpen(clientId, projectId)) {
    const status = await core.runtimes.getMcpStatus(clientId, projectId);
    if (status) servers.status = status;
  }
  return servers;
}

export function registerMcpRequests(core: PineCore): void {
  const { runtimes } = core;
  const catalog = (
    context: PineRequestContext,
    projectId: string,
  ): Promise<PineMcpCatalog> =>
    listMcpCatalog(core, context.clientId, projectId);

  async function reloadIfOpen(
    context: PineRequestContext,
    projectId: string,
  ): Promise<void> {
    if (runtimes.isOpen(context.clientId, projectId))
      await runtimes.reloadMcp(context.clientId, projectId);
  }

  core.handle(
    LIST_MCP_SERVERS_CHANNEL,
    (context, request: unknown): Promise<PineMcpCatalog> => {
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
