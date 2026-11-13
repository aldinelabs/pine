// Handlers: skills mcp. Names, scope, state and counts only: a
// skill's body and an MCP server's definition never reach WeChat.

import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../shared/projects";
import { PAGE_ROWS } from "../constants";
import { render } from "../replies";
import type { CommandContext, CommandHandler, CommandHandlers } from "./types";

/** The current session's project, else the project for new sessions. */
function currentProjectId(ctx: CommandContext): string {
  const state = ctx.store.get();
  return (
    state.current?.projectId ??
    state.currentProjectId ??
    ctx.settings.defaultProjectId ??
    TEMPORARY_WORKSPACE_PROJECT_ID
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    pages.push(items.slice(index, index + size));
  return pages;
}

/** Page 1 of a read-only list now, the rest behind `.more` (no handle table). */
function pagedList<T>(
  ctx: CommandContext,
  items: readonly T[],
  renderPage: (page: { n: number; item: T }[]) => string,
): { text: string } {
  const pages = chunk(items, PAGE_ROWS);
  if (pages.length === 0) {
    ctx.pager.clear();
    return { text: renderPage([]) };
  }
  const texts = pages.map((page, index) => {
    const body = renderPage(page.map((item, i) => ({ n: i + 1, item })));
    if (pages.length === 1) return body;
    const footer = render("R-PAGE", ctx.lang, {
      index: index + 1,
      count: pages.length,
      truncated: false,
    });
    return footer ? `${body}\n${footer}` : body;
  });
  const [first = "", ...rest] = texts;
  ctx.pager.set(rest);
  return { text: first };
}

const skills: CommandHandler = async (ctx) => {
  const projectId = currentProjectId(ctx);
  await ctx.sessions.hold(projectId);
  const { skills: list } = await ctx.core.listSkills(projectId);
  return pagedList(ctx, list, (page) =>
    render("R-SKILLS", ctx.lang, {
      rows: page.map(({ n, item }) => ({
        n,
        name: item.name,
        scope: item.scope,
        enabled: item.enabled ?? true,
        ...(item.description ? { description: item.description } : {}),
      })),
    }),
  );
};

type McpState = "connected" | "failed" | "unknown";

function mcpState(status: string | undefined): McpState {
  if (status === "connected") return "connected";
  if (status === "failed" || status === "needs-auth") return "failed";
  return "unknown";
}

const mcp: CommandHandler = async (ctx) => {
  const projectId = currentProjectId(ctx);
  await ctx.sessions.hold(projectId);
  const catalog = await ctx.core.listMcpServers(projectId);
  const status = new Map(
    (catalog.status?.servers ?? []).map((server) => [server.name, server]),
  );
  // The catalog carries unredacted definitions; only name and scope are kept,
  // so no part of a definition can reach a reply.
  const servers = catalog.servers.map((server) => ({
    name: server.name,
    scope: server.scope,
  }));
  return pagedList(ctx, servers, (page) =>
    render("R-MCP", ctx.lang, {
      rows: page.map(({ item }) => {
        const live = status.get(item.name);
        return {
          name: item.name,
          scope: item.scope,
          status: mcpState(live?.status),
          ...(live ? { tools: live.toolCount } : {}),
        };
      }),
    }),
  );
};

export const catalogHandlers: CommandHandlers = { skills, mcp };
