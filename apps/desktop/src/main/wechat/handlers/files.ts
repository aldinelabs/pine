// Handlers: files file. Only the current session's artifacts (files the
// agent submitted) can be sent, only with the local file switch on, and only
// while the file on disk is still the one that was submitted (invariant 5).

import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { specOf } from "../commandSpec";
import { FILE_MAX_BYTES, PAGE_ROWS } from "../constants";
import { notice } from "../notices";
import { resolveRef } from "../parseCommand";
import { joinReplies, render } from "../replies";
import type { ArtifactFile } from "../sessionDirectory";
import type { HandleRow } from "../types";
import type {
  CommandContext,
  CommandHandler,
  CommandHandlers,
  CommandResult,
} from "./types";

type FileCheck =
  | { kind: "ok"; path: string; size: number }
  | { kind: "gone" }
  | { kind: "changed" }
  | { kind: "size"; size: number };

/**
 * The pattern of `reopenPresentedToolFile`: the recorded path must still
 * resolve to itself (no symlink swapped in), be a regular file and fit the cap.
 */
async function checkFile(recorded: string): Promise<FileCheck> {
  const expected = path.resolve(recorded);
  const canonical = await realpath(expected).catch(() => null);
  if (canonical === null) return { kind: "gone" };
  if (canonical !== expected) return { kind: "changed" };
  const info = await stat(canonical).catch(() => null);
  if (!info?.isFile()) return { kind: "changed" };
  if (info.size > FILE_MAX_BYTES) return { kind: "size", size: info.size };
  return { kind: "ok", path: canonical, size: info.size };
}

function refusal(
  ctx: CommandContext,
  check: Exclude<FileCheck, { kind: "ok" }>,
  name: string,
): string {
  switch (check.kind) {
    case "gone":
      return render("E-GONE", ctx.lang, { variant: "item", kind: "file" });
    case "changed":
      return render("E-GONE", ctx.lang, { variant: "file-changed" });
    case "size":
      return render("E-SIZE", ctx.lang, {
        variant: "file",
        name,
        sizeBytes: check.size,
      });
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    pages.push(items.slice(index, index + size));
  return pages;
}

/** A list reply: page 1 now, the rest behind `.more`; rows numbered 1–8 per page. */
function numberedList<T>(
  ctx: CommandContext,
  items: readonly T[],
  handle: (item: T) => HandleRow,
  renderPage: (page: { n: number; item: T }[]) => string,
  sessionId: string,
): CommandResult {
  const pages = chunk(items, PAGE_ROWS);
  if (pages.length === 0) {
    ctx.pager.clear();
    return { text: renderPage([]) };
  }
  const built = pages.map((page, index) => {
    const body = renderPage(page.map((item, i) => ({ n: i + 1, item })));
    const footer =
      pages.length > 1
        ? render("R-PAGE", ctx.lang, {
            index: index + 1,
            count: pages.length,
            truncated: false,
          })
        : "";
    return {
      text: joinReplies(body, footer),
      rows: page.map(handle),
    };
  });
  const [first, ...rest] = built;
  if (!first) return {};
  ctx.handles.set("file", first.rows, sessionId);
  ctx.pager.set(
    rest.map((page) => ({
      text: page.text,
      list: { kind: "file" as const, rows: page.rows, sessionId },
    })),
  );
  return { text: first.text, numbered: { kind: "file" } };
}

function fileRow(file: ArtifactFile): HandleRow {
  return { id: file.id, label: file.name };
}

async function sizeOf(file: ArtifactFile): Promise<number | undefined> {
  try {
    const info = await stat(file.path);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

const listFiles = async (ctx: CommandContext): Promise<CommandResult> => {
  const current = ctx.store.get().current;
  if (!current) return { text: render("E-NOSESSION", ctx.lang) };
  const { sessionId, projectId } = current;
  const view = await ctx.sessions.view(sessionId, projectId);
  const files = await ctx.sessions.files(sessionId, projectId);
  const sizes = await Promise.all(files.map(sizeOf));
  const items = files.map((file, index) => ({ file, size: sizes[index] }));
  const at = { project: view.project, title: view.title };
  const canSend = ctx.settings.allowFileSending;
  return numberedList(
    ctx,
    items,
    (item) => fileRow(item.file),
    (page) =>
      render("R-FILES", ctx.lang, {
        at,
        canSend,
        rows: page.map(({ n, item }) => ({
          n,
          path: item.file.name,
          ...(item.file.title ? { title: item.file.title } : {}),
          ...(item.size === undefined ? {} : { sizeBytes: item.size }),
        })),
      }),
    sessionId,
  );
};

const sendFile = async (
  ctx: CommandContext,
  ref: string,
): Promise<CommandResult> => {
  // The switch comes first: with it off nothing is resolved, read or uploaded.
  if (!ctx.settings.allowFileSending)
    return { text: render("E-SWITCH", ctx.lang) };
  const current = ctx.store.get().current;
  if (!current) return { text: render("E-NOSESSION", ctx.lang) };
  const { sessionId, projectId } = current;
  const files = await ctx.sessions.files(sessionId, projectId);

  let row: HandleRow | undefined;
  if (/^\d+$/.test(ref)) {
    row = ctx.handles.resolve("file", Number(ref), sessionId);
    if (!row)
      return { text: render("E-REF", ctx.lang, { n: ref, list: ".o" }) };
  } else {
    const match = resolveRef(files.map(fileRow), ref);
    if (match.kind === "none")
      return {
        text: render("E-NOMATCH", ctx.lang, { query: ref, kind: "file" }),
      };
    if (match.kind === "many")
      return numberedList(
        ctx,
        match.rows,
        (item) => item,
        (page) =>
          render("R-MATCHES", ctx.lang, {
            query: ref,
            rows: page.map(({ n, item }) => ({ n, label: item.label })),
          }),
        sessionId,
      );
    row = match.row;
  }

  const picked: HandleRow = row;
  const file = files.find((candidate) => candidate.id === picked.id);
  if (!file)
    return {
      text: render("E-GONE", ctx.lang, { variant: "item", kind: "file" }),
    };
  const check = await checkFile(file.path);
  if (check.kind !== "ok") return { text: refusal(ctx, check, file.name) };
  const view = await ctx.sessions.view(sessionId, projectId);

  return {
    text: render("R-SENDING", ctx.lang, {
      name: file.name,
      sizeBytes: check.size,
    }),
    after: async () => {
      // Checked again right before reading: the announcement took a send.
      const again = await checkFile(file.path);
      if (again.kind !== "ok") {
        await ctx.outbound.reply(refusal(ctx, again, file.name));
        return;
      }
      const data = await readFile(again.path);
      if (data.length !== again.size || data.length > FILE_MAX_BYTES) {
        await ctx.outbound.reply(
          render("E-GONE", ctx.lang, { variant: "file-changed" }),
        );
        return;
      }
      const result = await ctx.outbound.sendFile({ name: file.name, data });
      if (!result.ok) {
        await ctx.outbound.reply(render("E-FAIL", ctx.lang));
        return;
      }
      try {
        ctx.host.notify({
          kind: "file-sent",
          ...notice("file-sent", ctx.lang, {
            name: file.name,
            sizeBytes: data.length,
            title: view.title,
          }),
          projectId,
          sessionId,
        });
      } catch {
        // A failed notification never blocks the bridge.
      }
    },
  };
};

const files: CommandHandler = (ctx, command) => {
  const ref = command.args[0];
  return ref === undefined ? listFiles(ctx) : sendFile(ctx, ref);
};

const file: CommandHandler = (ctx, command) => {
  const ref = command.args[0];
  if (ref === undefined)
    return Promise.resolve({
      text: render("E-ARGS", ctx.lang, { spec: specOf("file") }),
    });
  return sendFile(ctx, ref);
};

export const fileHandlers: CommandHandlers = { files, file };
