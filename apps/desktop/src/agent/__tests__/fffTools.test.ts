import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { FffFindDetails, FffGrepDetails } from "../../shared/fffSearch";
import { createFffToolDefinitions, FffIndexPool } from "../fffTools";
import { PineToolAccessPolicy } from "../tool-access-policy";

let root: string;
let outside: string;
let pool: FffIndexPool;
let find: ToolDefinition;
let grep: ToolDefinition;

async function call<TDetails>(tool: ToolDefinition, params: object) {
  const result = await tool.execute(
    "call",
    params,
    undefined,
    undefined,
    {} as never,
  );
  const first = result.content[0];
  return {
    text: first?.type === "text" ? first.text : "",
    details: result.details as TDetails,
  };
}

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "pine-fff-")));
  outside = await realpath(await mkdtemp(path.join(os.tmpdir(), "pine-out-")));
  await mkdir(path.join(root, "src", "agent"), { recursive: true });
  await writeFile(
    path.join(root, "src", "agent", "workspaceTools.ts"),
    "export function listProjects() {}\nconst TODO = 1;\n",
  );
  await writeFile(
    path.join(root, "src", "main.ts"),
    'import { listProjects } from "./agent/workspaceTools";\nlistProjects();\n',
  );
  await writeFile(path.join(root, "README.md"), "# demo\nlistProjects docs\n");
  await writeFile(path.join(outside, "secret.txt"), "listProjects secret\n");
  const policy = await PineToolAccessPolicy.create(root, [
    { access: "read-write", path: root },
  ]);
  pool = new FffIndexPool();
  [find, grep] = createFffToolDefinitions(policy, pool) as [
    ToolDefinition,
    ToolDefinition,
  ];
});

afterAll(async () => {
  pool.dispose();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("find", () => {
  it("finds a file despite typos", async () => {
    const { text, details } = await call<FffFindDetails>(find, {
      query: "wrkspcTools",
    });
    expect(details.mode).toBe("fuzzy");
    expect(details.files).toContain("src/agent/workspaceTools.ts");
    expect(text).toContain("src/agent/workspaceTools.ts");
  });

  it("lists files for a glob", async () => {
    const { details } = await call<FffFindDetails>(find, {
      query: "src/**/*.ts",
    });
    expect(details.mode).toBe("glob");
    expect([...details.files].sort()).toEqual([
      "src/agent/workspaceTools.ts",
      "src/main.ts",
    ]);
  });

  it("limits the search to a folder", async () => {
    const { details } = await call<FffFindDetails>(find, {
      query: "ts",
      path: "src/agent",
    });
    expect(details.files.length).toBeGreaterThan(0);
    expect(details.files.every((file) => file.startsWith("src/agent/"))).toBe(
      true,
    );
  });

  it("refuses folders that are not shared", async () => {
    await expect(
      call(find, { query: "secret", path: outside }),
    ).rejects.toThrow(/outside the folders shared/u);
  });
});

describe("grep", () => {
  it("returns matching lines grouped by file", async () => {
    const { text, details } = await call<FffGrepDetails>(grep, {
      pattern: "listProjects",
    });
    expect(details.total).toBeGreaterThanOrEqual(4);
    expect(details.files).toBe(3);
    expect(details.matches[0]).toMatchObject({ text: expect.any(String) });
    expect(text).toMatch(/src\/main\.ts\n\s+1:/u);
  });

  it("narrows by glob and path", async () => {
    const { details } = await call<FffGrepDetails>(grep, {
      pattern: "listProjects",
      glob: "*.md",
    });
    expect(details.matches.map((match) => match.path)).toEqual(["README.md"]);
    const scoped = await call<FffGrepDetails>(grep, {
      pattern: "listProjects",
      path: "src/agent",
    });
    expect(scoped.details.matches.map((match) => match.path)).toEqual([
      "src/agent/workspaceTools.ts",
    ]);
  });

  it("searches several strings at once", async () => {
    const { details } = await call<FffGrepDetails>(grep, {
      patterns: ["TODO", "docs"],
    });
    expect(details.mode).toBe("multi");
    expect(details.matches.map((match) => match.path).sort()).toEqual([
      "README.md",
      "src/agent/workspaceTools.ts",
    ]);
  });

  it("supports regular expressions and shows context", async () => {
    const { text } = await call<FffGrepDetails>(grep, {
      pattern: "^export function \\w+",
      mode: "regex",
      context: 1,
    });
    expect(text).toContain("src/agent/workspaceTools.ts");
    expect(text).toMatch(/2- const TODO = 1;/u);
  });

  it("pages with a cursor", async () => {
    const first = await call<FffGrepDetails>(grep, {
      pattern: "listProjects",
      limit: 2,
    });
    expect(first.details.hasMore).toBe(true);
    const cursor = /cursor "([^"]+)"/u.exec(first.text)?.[1];
    expect(cursor).toBeTruthy();
    const second = await call<FffGrepDetails>(grep, {
      pattern: "listProjects",
      limit: 2,
      cursor,
    });
    expect(second.details.total).toBeGreaterThan(0);
    expect(second.details.matches[0]).not.toEqual(first.details.matches[0]);
  });

  it("rejects bad arguments and unknown cursors", async () => {
    await expect(call(grep, {})).rejects.toThrow(/pattern or patterns/u);
    await expect(call(grep, { pattern: "a", patterns: ["b"] })).rejects.toThrow(
      /not both/u,
    );
    await expect(call(grep, { pattern: "a", cursor: "nope" })).rejects.toThrow(
      /expired cursor/u,
    );
  });

  it("reports a miss with a hint", async () => {
    const { text, details } = await call<FffGrepDetails>(grep, {
      pattern: "zzzNothingHereZzz",
    });
    expect(details.total).toBe(0);
    expect(text).toContain("fuzzy");
  });
});

describe("FffIndexPool", () => {
  it("releases an index after it has been idle", async () => {
    const idle = new FffIndexPool({ idleMs: 20 });
    const { finder } = await idle.acquire(root);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(finder.isDestroyed).toBe(true);
    idle.dispose();
  });

  it("explains an index it cannot build", async () => {
    const broken = new FffIndexPool({
      load: () =>
        Promise.resolve({
          FileFinder: {
            create: () => ({ ok: false, error: "nope" }),
          },
        } as never),
    });
    await expect(broken.acquire(root)).rejects.toThrow(/Cannot index/u);
  });
});
