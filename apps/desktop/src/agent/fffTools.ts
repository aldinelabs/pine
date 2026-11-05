import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  FileFinder,
  GrepCursor,
  GrepResult,
  Result,
} from "@ff-labs/fff-node";
import { Type, type Static } from "typebox";
import {
  FFF_FIND_TOOL_NAME,
  FFF_GREP_TOOL_NAME,
  type FffFindDetails,
  type FffGrepDetails,
  type FffGrepMatchDetail,
} from "../shared/fffSearch";
import type { PineToolAccessPolicy } from "./tool-access-policy";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_LINE_CHARS = 300;
/** Matches kept in the details the transcript marker renders. */
const MAX_DETAIL_MATCHES = 100;
const MAX_CONTEXT_LINES = 10;
const SCAN_TIMEOUT_MS = 15_000;
const MAX_LIVE_INDEXES = 4;
const IDLE_INDEX_MS = 10 * 60_000;
const MAX_CURSORS = 32;

type FffModule = typeof import("@ff-labs/fff-node");

export interface FffSearchDeps {
  /** Loads the native library on first use; replaced in tests. */
  load?: () => Promise<Pick<FffModule, "FileFinder">>;
  idleMs?: number;
}

function unwrap<T>(result: Result<T>, action: string): T {
  if (!result.ok) throw new Error(`${action} failed: ${result.error}`);
  return result.value;
}

interface PooledIndex {
  finder: FileFinder;
  timer: NodeJS.Timeout | undefined;
  scanned: boolean;
}

/**
 * Keeps one native index per searched root, because building an index is the
 * expensive part and every later search is served from memory. Indexes are
 * shared by every session in the agent process and released once idle.
 */
export class FffIndexPool {
  private readonly indexes = new Map<string, PooledIndex>();
  private readonly pending = new Map<string, Promise<PooledIndex>>();
  private readonly cursors = new Map<string, GrepCursor>();
  private readonly idleMs: number;

  constructor(private readonly deps: FffSearchDeps = {}) {
    this.idleMs = deps.idleMs ?? IDLE_INDEX_MS;
  }

  async acquire(root: string): Promise<{ finder: FileFinder; warm: boolean }> {
    const existing = this.indexes.get(root);
    if (existing && !existing.finder.isDestroyed) {
      this.touch(root, existing);
      return { finder: existing.finder, warm: existing.scanned };
    }
    let creating = this.pending.get(root);
    if (!creating) {
      creating = this.create(root).finally(() => this.pending.delete(root));
      this.pending.set(root, creating);
    }
    const entry = await creating;
    this.touch(root, entry);
    return { finder: entry.finder, warm: entry.scanned };
  }

  rememberCursor(cursor: GrepCursor): string {
    const token = randomUUID().slice(0, 8);
    this.cursors.set(token, cursor);
    while (this.cursors.size > MAX_CURSORS) {
      const oldest = this.cursors.keys().next().value;
      if (oldest === undefined) break;
      this.cursors.delete(oldest);
    }
    return token;
  }

  recallCursor(token: string): GrepCursor {
    const cursor = this.cursors.get(token);
    if (!cursor) {
      throw new Error(
        `Unknown or expired cursor "${token}". Repeat the search without a cursor.`,
      );
    }
    return cursor;
  }

  dispose(): void {
    for (const [root, entry] of this.indexes) this.release(root, entry);
    this.cursors.clear();
  }

  private async create(root: string): Promise<PooledIndex> {
    const { FileFinder: Finder } = await (this.deps.load ?? loadFff)();
    const created = Finder.create({ basePath: root, aiMode: true });
    if (!created.ok) {
      throw new Error(
        `Cannot index ${root} for search: ${created.error}. Use the shell with grep or find for this folder instead.`,
      );
    }
    const entry: PooledIndex = {
      finder: created.value,
      timer: undefined,
      scanned: false,
    };
    const scan = await entry.finder.waitForScan(SCAN_TIMEOUT_MS);
    entry.scanned = scan.ok && scan.value;
    this.indexes.set(root, entry);
    this.evictOverflow(root);
    return entry;
  }

  private touch(root: string, entry: PooledIndex): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.release(root, entry), this.idleMs);
    entry.timer.unref();
  }

  private evictOverflow(keep: string): void {
    while (this.indexes.size > MAX_LIVE_INDEXES) {
      const oldest = [...this.indexes.keys()].find((root) => root !== keep);
      if (oldest === undefined) break;
      const entry = this.indexes.get(oldest);
      if (entry) this.release(oldest, entry);
    }
  }

  private release(root: string, entry: PooledIndex): void {
    if (entry.timer) clearTimeout(entry.timer);
    if (this.indexes.get(root) === entry) this.indexes.delete(root);
    if (!entry.finder.isDestroyed) entry.finder.destroy();
  }
}

function loadFff(): Promise<Pick<FffModule, "FileFinder">> {
  return import("@ff-labs/fff-node");
}

interface SearchScope {
  /** Directory the index is built on. */
  root: string;
  /** Path below `root` that the search is limited to, in fff query syntax. */
  constraint: string;
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Pick the index a search runs on. The session's working directory is the
 * default; a path inside it only narrows that index, while a shared folder
 * elsewhere gets an index of its own.
 */
async function resolveScope(
  policy: PineToolAccessPolicy,
  target: string | undefined,
): Promise<SearchScope> {
  const cwd = policy.cwd;
  if (!target?.trim()) return { root: cwd, constraint: "" };
  const absolute = await policy.authorize(path.resolve(cwd, target), "read");
  const info = await stat(absolute);
  const directory = info.isDirectory() ? absolute : path.dirname(absolute);
  const root = isInside(cwd, absolute) ? cwd : directory;
  const relative = toPosix(path.relative(root, absolute));
  if (!relative) return { root, constraint: "" };
  return {
    root,
    constraint: info.isDirectory() ? `${relative}/` : relative,
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function clipLine(line: string): string {
  const trimmed = line.replace(/\s+$/u, "");
  return trimmed.length > MAX_LINE_CHARS
    ? `${trimmed.slice(0, MAX_LINE_CHARS)}…`
    : trimmed;
}

const GLOB_CHARACTERS = /[*?[\]{}]/u;

const findParams = Type.Object({
  query: Type.String({
    description:
      'File name or path to look for. Typos and partial names are fine: "wrkspcTools" finds workspaceTools.ts. A glob such as "src/**/*.test.ts" lists every matching file instead of ranking fuzzy matches.',
  }),
  path: Type.Optional(
    Type.String({
      description:
        "Directory to search in, absolute or relative to the working directory. Defaults to the working directory.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Maximum files to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`,
    }),
  ),
});
export type FffFindParams = Static<typeof findParams>;

const grepParams = Type.Object({
  pattern: Type.Optional(
    Type.String({
      description:
        "Text to search for inside files. Literal by default; see mode. Give either pattern or patterns.",
    }),
  ),
  patterns: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Several literal strings; a line matching any of them is returned. One call replaces a run of separate searches, for example every name an identifier was renamed from.",
    }),
  ),
  path: Type.Optional(
    Type.String({
      description:
        "Directory or file to search in, absolute or relative to the working directory. Defaults to the working directory.",
    }),
  ),
  glob: Type.Optional(
    Type.String({
      description:
        'Only search files whose path matches this glob, for example "*.ts" or "src/**/*.vue".',
    }),
  ),
  mode: Type.Optional(
    Type.Union(
      [Type.Literal("plain"), Type.Literal("regex"), Type.Literal("fuzzy")],
      {
        description:
          "plain: exact text (default). regex: a regular expression. fuzzy: tolerates typos and dropped characters; useful when the exact spelling is unknown.",
      },
    ),
  ),
  caseSensitive: Type.Optional(
    Type.Boolean({
      description:
        "Match case exactly. By default a lowercase pattern ignores case and a pattern with capitals does not.",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      description: `Lines of context to show around each match (0-${MAX_CONTEXT_LINES}, default 0).`,
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Maximum matching lines per call (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`,
    }),
  ),
  cursor: Type.Optional(
    Type.String({
      description:
        'Cursor from the previous result\'s "More" line, to continue the same search.',
    }),
  ),
});
export type FffGrepParams = Static<typeof grepParams>;

function scanNote(warm: boolean): string {
  return warm
    ? ""
    : "\nNote: the folder is still being indexed, so this result may be incomplete. Repeat the search shortly for the full set.";
}

function textResult<TDetails>(text: string, details: TDetails) {
  return { content: [{ type: "text" as const, text }], details };
}

function findQuery(scope: SearchScope, query: string): string {
  const trimmed = query.trim();
  if (!scope.constraint) return trimmed;
  return GLOB_CHARACTERS.test(trimmed)
    ? `${scope.constraint}${trimmed.replace(/^\.?\//u, "")}`
    : `${scope.constraint} ${trimmed}`;
}

async function runFind(
  pool: FffIndexPool,
  policy: PineToolAccessPolicy,
  params: FffFindParams,
) {
  const query = params.query?.trim();
  if (!query) throw new Error("query must not be empty.");
  const limit = clampLimit(params.limit);
  const scope = await resolveScope(policy, params.path);
  const { finder, warm } = await pool.acquire(scope.root);
  const glob = GLOB_CHARACTERS.test(query);
  const effective = findQuery(scope, query);
  const result = unwrap(
    glob
      ? finder.glob(effective, { pageSize: limit })
      : finder.fileSearch(effective, { pageSize: limit }),
    "File search",
  );
  const rooted = (relative: string) =>
    scope.root === policy.cwd ? relative : path.join(scope.root, relative);
  const files = result.items.map((item) => rooted(item.relativePath));
  const lines = result.items.map((item, index) => {
    const status =
      item.gitStatus && item.gitStatus !== "clean"
        ? `  [${item.gitStatus}]`
        : "";
    return `${files[index]}${status}`;
  });
  const more = result.totalMatched - files.length;
  const details: FffFindDetails = {
    mode: glob ? "glob" : "fuzzy",
    query,
    total: result.totalMatched,
    files,
    indexing: !warm,
  };
  const header = files.length
    ? `${files.length} of ${result.totalMatched} files:`
    : "No files matched.";
  return textResult(
    `${header}${files.length ? `\n${lines.join("\n")}` : ""}${
      more > 0
        ? `\n… ${more} more. Narrow the query or pass a path to see the rest.`
        : ""
    }${scanNote(warm)}`,
    details,
  );
}

function formatGrep(
  result: GrepResult,
  rooted: (relative: string) => string,
): { text: string; matches: FffGrepMatchDetail[]; files: number } {
  const lines: string[] = [];
  const matches: FffGrepMatchDetail[] = [];
  const files = new Set<string>();
  let currentFile: string | undefined;
  for (const item of result.items) {
    const file = rooted(item.relativePath);
    files.add(file);
    if (file !== currentFile) {
      if (currentFile !== undefined) lines.push("");
      lines.push(file);
      currentFile = file;
    }
    const before = item.contextBefore ?? [];
    before.forEach((line, index) => {
      lines.push(
        `  ${item.lineNumber - before.length + index}- ${clipLine(line)}`,
      );
    });
    lines.push(`  ${item.lineNumber}: ${clipLine(item.lineContent)}`);
    (item.contextAfter ?? []).forEach((line, index) => {
      lines.push(`  ${item.lineNumber + 1 + index}- ${clipLine(line)}`);
    });
    if (matches.length < MAX_DETAIL_MATCHES) {
      matches.push({
        path: file,
        line: item.lineNumber,
        text: clipLine(item.lineContent).trim(),
      });
    }
  }
  return { text: lines.join("\n"), matches, files: files.size };
}

async function runGrep(
  pool: FffIndexPool,
  policy: PineToolAccessPolicy,
  params: FffGrepParams,
) {
  const patterns = (params.patterns ?? [])
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  const single = params.pattern?.trim();
  if (single && patterns.length) {
    throw new Error("Give either pattern or patterns, not both.");
  }
  if (!single && !patterns.length) {
    throw new Error("pattern or patterns is required.");
  }
  const mode = params.mode ?? "plain";
  if (patterns.length && mode !== "plain") {
    throw new Error(
      "patterns are literal strings; use one pattern for regex or fuzzy mode.",
    );
  }

  const limit = clampLimit(params.limit);
  const context = Math.min(
    MAX_CONTEXT_LINES,
    Math.max(0, Math.trunc(params.context ?? 0)),
  );
  const scope = await resolveScope(policy, params.path);
  const constraints = [scope.constraint, params.glob?.trim()]
    .filter(Boolean)
    .join(" ");
  const { finder, warm } = await pool.acquire(scope.root);
  const cursor = params.cursor ? pool.recallCursor(params.cursor) : null;
  const options = {
    pageSize: limit,
    beforeContext: context,
    afterContext: context,
    cursor,
    smartCase: params.caseSensitive !== true,
    // Never let one huge repository hold the agent for long.
    timeBudgetMs: 8_000,
  };

  let result: GrepResult;
  if (patterns.length || (single && constraints && mode === "plain")) {
    result = unwrap(
      finder.multiGrep({
        ...options,
        patterns: patterns.length ? patterns : [single as string],
        ...(constraints ? { constraints } : {}),
        ...(params.caseSensitive ? { smartCase: false } : {}),
      }),
      "Content search",
    );
  } else {
    const query = constraints ? `${constraints} ${single}` : (single as string);
    result = unwrap(finder.grep(query, { ...options, mode }), "Content search");
  }

  const rooted = (relative: string) =>
    scope.root === policy.cwd ? relative : path.join(scope.root, relative);
  const formatted = formatGrep(result, rooted);
  const next = result.nextCursor
    ? pool.rememberCursor(result.nextCursor)
    : null;
  const label = patterns.length ? patterns.join(" | ") : (single as string);
  const details: FffGrepDetails = {
    mode: patterns.length ? "multi" : mode,
    pattern: label,
    ...(scope.constraint || params.glob
      ? {
          scope: [scope.constraint, params.glob?.trim()]
            .filter(Boolean)
            .join(" "),
        }
      : {}),
    total: result.items.length,
    files: formatted.files,
    matches: formatted.matches,
    hasMore: next !== null,
    indexing: !warm,
  };
  const summary = result.items.length
    ? `${result.items.length} matching lines in ${formatted.files} files:\n${formatted.text}`
    : `No lines matched ${JSON.stringify(label)}${
        mode === "plain" && !patterns.length
          ? '. Try mode "fuzzy" if the spelling may differ.'
          : "."
      }`;
  const fallback = result.regexFallbackError
    ? `\nNote: the pattern is not a valid regular expression (${result.regexFallbackError}), so it was searched as plain text.`
    : "";
  return textResult(
    `${summary}${fallback}${
      next
        ? `\nMore: call grep again with the same arguments and cursor "${next}".`
        : ""
    }${scanNote(warm)}`,
    details,
  );
}

/**
 * fff-backed `find` and `grep`. Both keep a warm, git-aware index of the
 * searched folder, rank by how recently files were touched, and tolerate
 * typos, which is why they replace shelling out to find and grep.
 */
export function createFffToolDefinitions(
  policy: PineToolAccessPolicy,
  pool: FffIndexPool,
): ToolDefinition[] {
  const findTool = defineTool({
    name: FFF_FIND_TOOL_NAME,
    label: "Find Files",
    description:
      "Find files by name or path. Tolerates typos and partial names, ranks recently used and changed files first, respects .gitignore, and understands globs. Searches the working directory by default.",
    promptSnippet:
      "Find files by name, partial name or glob (typo-tolerant, respects .gitignore)",
    promptGuidelines: [
      `Use ${FFF_FIND_TOOL_NAME} instead of ls or find in the shell to locate a file whose exact path is unknown.`,
    ],
    parameters: findParams,
    prepareArguments: (args) => args as FffFindParams,
    execute: (_toolCallId, params) => runFind(pool, policy, params),
  });
  const grepTool = defineTool({
    name: FFF_GREP_TOOL_NAME,
    label: "Search Content",
    description:
      "Search file contents. Literal text by default, with regular expression and typo-tolerant modes, several alternative strings in one call, optional context lines. Respects .gitignore and ranks recently used files first. Results are paginated: continue with the returned cursor.",
    promptSnippet:
      "Search file contents (literal, regex or typo-tolerant; several strings at once)",
    promptGuidelines: [
      `Use ${FFF_GREP_TOOL_NAME} instead of grep or rg in the shell. Search for a bare identifier, not a sentence; pass patterns to look for several names in one call.`,
      `Narrow ${FFF_GREP_TOOL_NAME} with path or glob rather than reading whole files to find something.`,
    ],
    parameters: grepParams,
    prepareArguments: (args) => args as FffGrepParams,
    execute: (_toolCallId, params) => runGrep(pool, policy, params),
  });
  return [findTool, grepTool] as ToolDefinition[];
}
