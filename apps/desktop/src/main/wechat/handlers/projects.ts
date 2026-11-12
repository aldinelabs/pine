// Handler: projects (CMD §7.6). Lists projects or sets the project for new
// sessions. It never calls the `OPEN_PROJECT` handler (the bridge only holds
// the project as its own client) and never shows an absolute path: folders
// are named by their base name.

import {
  isTemporaryWorkspace,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "../../../shared/projects";
import { listProjectSessions } from "../../recentSessions";
import { PAGE_ROWS } from "../constants";
import { resolveRef } from "../parseCommand";
import { render } from "../replies";
import { projectLabel } from "../sessionDirectory";
import { baseName } from "../text";
import type { HandleRow } from "../types";
import type { CommandContext, CommandHandlers, CommandResult } from "./types";

/** Projects in list order, the temporary workspace last (CMD §7.6). */
async function projectsInOrder(ctx: CommandContext): Promise<PineProject[]> {
  const projects = await ctx.core.repository.list();
  return [
    ...projects.filter((project) => !isTemporaryWorkspace(project.id)),
    ...projects.filter((project) => isTemporaryWorkspace(project.id)),
  ];
}

function listProjects(
  ctx: CommandContext,
  projects: readonly PineProject[],
): CommandResult {
  const currentId =
    ctx.store.get().currentProjectId ?? TEMPORARY_WORKSPACE_PROJECT_ID;
  const pages: { text: string; rows: HandleRow[] }[] = [];
  for (let index = 0; index < projects.length; index += PAGE_ROWS) {
    const chunk = projects.slice(index, index + PAGE_ROWS);
    pages.push({
      text: render("R-PROJECTS", ctx.lang, {
        rows: chunk.map((project, row) => ({
          n: row + 1,
          name: project.name,
          current: project.id === currentId,
          ...(isTemporaryWorkspace(project.id) ? { temporary: true } : {}),
        })),
      }),
      rows: chunk.map((project) => ({
        id: project.id,
        label: projectLabel(project, ctx.lang),
      })),
    });
  }
  const [first, ...rest] = pages;
  ctx.pager.set(
    rest.map((page) => ({
      text: page.text,
      list: { kind: "project" as const, rows: page.rows },
    })),
  );
  if (!first) return { text: render("R-PROJECTS", ctx.lang, { rows: [] }) };
  ctx.handles.set("project", first.rows);
  return { text: first.text, numbered: { kind: "project" } };
}

async function selectProject(
  ctx: CommandContext,
  project: PineProject,
): Promise<CommandResult> {
  const temporary = isTemporaryWorkspace(project.id);
  const folders = project.folders.map((folder) => ({
    path: baseName(folder.path),
    access: folder.access,
  }));
  if (
    !temporary &&
    project.folders.length > 0 &&
    project.folders.every((folder) => !folder.isAvailable)
  )
    return {
      text: render("E-GONE", ctx.lang, {
        variant: "folders",
        name: project.name,
      }),
    };
  const held = await ctx.sessions.hold(project.id);
  let count = 0;
  try {
    count = (await listProjectSessions(held, ctx.core.sessionLibrary())).length;
  } catch {
    // An unreadable session index shows as no sessions.
  }
  await ctx.store.update((draft) => {
    draft.currentProjectId = project.id;
    delete draft.current;
  });
  return {
    text: render("R-PROJECT", ctx.lang, {
      name: held.name,
      ...(temporary ? { temporary: true } : {}),
      folders,
      count,
    }),
  };
}

export const projectHandlers: CommandHandlers = {
  projects: async (ctx, command) => {
    const arg = command.args[0];
    const query = command.tail?.trim();
    if (arg === undefined && !query)
      return listProjects(ctx, await projectsInOrder(ctx));
    if (arg !== undefined) {
      const row = ctx.handles.resolve("project", Number(arg));
      if (!row)
        return { text: render("E-REF", ctx.lang, { n: arg, list: ".p" }) };
      let project: PineProject;
      try {
        project = await ctx.core.repository.get(row.id);
      } catch {
        return {
          text: render("E-GONE", ctx.lang, {
            variant: "item",
            kind: "project",
          }),
        };
      }
      return selectProject(ctx, project);
    }
    const projects = await projectsInOrder(ctx);
    const rows = projects.map((project) => ({
      project,
      label: projectLabel(project, ctx.lang),
    }));
    const match = resolveRef(rows, query ?? "");
    if (match.kind === "one") return selectProject(ctx, match.row.project);
    if (match.kind === "none")
      return {
        text: render("E-NOMATCH", ctx.lang, {
          query: query ?? "",
          kind: "project",
        }),
      };
    const matches = match.rows.slice(0, PAGE_ROWS);
    ctx.handles.set(
      "project",
      matches.map((entry) => ({ id: entry.project.id, label: entry.label })),
    );
    return {
      text: render("R-MATCHES", ctx.lang, {
        query: query ?? "",
        rows: matches.map((entry, index) => ({
          n: index + 1,
          label: entry.label,
        })),
      }),
      numbered: { kind: "project" },
    };
  },
};
