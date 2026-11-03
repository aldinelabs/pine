import { describe, expect, it, vi } from "vitest";
import { checkScriptSyntax, runScript, type ScriptRunInput } from "../script";

function input(
  source: string,
  overrides: Partial<ScriptRunInput> = {},
): ScriptRunInput {
  return {
    source,
    cursor: null,
    now: new Date("2026-11-03T00:00:00Z"),
    secrets: { "erp-token": "s3cret-value" },
    network: ["erp.example.com"],
    read: [{ folderId: "docs" }],
    fetch: vi.fn(() => Promise.resolve(new Response("[]"))),
    fs: {
      list: vi.fn(() =>
        Promise.resolve([
          {
            path: "a.txt",
            name: "a.txt",
            size: 1,
            mtime: "2026-11-01T00:00:00Z",
            kind: "file" as const,
          },
        ]),
      ),
      stat: vi.fn(() => Promise.resolve(null)),
      readText: vi.fn(() => Promise.resolve("hello")),
    },
    ...overrides,
  };
}

describe("automation script triggers", () => {
  it("runs a poll with fetch, secrets and cursor", async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer s3cret-value",
      );
      return Promise.resolve(Response.json([{ id: 3 }, { id: 5 }]));
    });
    const result = await runScript(
      input(
        `export default async function poll(ctx) {
          const res = await ctx.fetch("https://erp.example.com/orders", {
            headers: { Authorization: "Bearer " + ctx.secrets["erp-token"] },
          });
          const orders = await res.json();
          const last = ctx.cursor?.lastId ?? 0;
          ctx.log("got", orders.length);
          return {
            events: orders.filter((o) => o.id > last).map((o) => ({ id: String(o.id), data: o })),
            cursor: { lastId: Math.max(last, ...orders.map((o) => o.id)) },
          };
        }`,
        { fetch, cursor: { lastId: 3 } },
      ),
    );
    expect(result.events).toEqual([{ id: "5", data: { id: 5 } }]);
    expect(result.cursor).toEqual({ lastId: 5 });
    expect(result.logs).toEqual(["got 2"]);
    expect(result.requests).toEqual([
      { url: "https://erp.example.com/orders", status: 200 },
    ]);
  });

  it("refuses hosts outside the allowlist, including after a redirect", async () => {
    await expect(
      runScript(
        input(
          `export default async function poll(ctx) { await ctx.fetch("https://evil.example.com/"); return { events: [] }; }`,
        ),
      ),
    ).rejects.toThrow(/may not access evil.example.com/);
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.com/steal" },
        }),
      ),
    );
    await expect(
      runScript(
        input(
          `export default async function poll(ctx) { await ctx.fetch("https://erp.example.com/"); return { events: [] }; }`,
          { fetch },
        ),
      ),
    ).rejects.toThrow(/may not access evil.example.com/);
  });

  it("confines file access to granted folders", async () => {
    const ok = await runScript(
      input(
        `export default async function poll(ctx) {
          const files = await ctx.fs.list({ folderId: "docs" });
          return { events: files.map((f) => ({ id: f.path, data: f.name })) };
        }`,
      ),
    );
    expect(ok.events).toEqual([{ id: "a.txt", data: "a.txt" }]);
    await expect(
      runScript(
        input(
          `export default async function poll(ctx) { await ctx.fs.readText({ folderId: "secret" }, "x"); return { events: [] }; }`,
        ),
      ),
    ).rejects.toThrow(/may not read folder secret/);
  });

  it("exposes no host capabilities beyond ctx", async () => {
    const result = await runScript(
      input(
        `export default async function poll(ctx) {
          return { events: [{ id: "globals", data: {
            fetch: typeof fetch, process: typeof process, require: typeof require,
            setTimeout: typeof setTimeout, pine: typeof __pine, frozen: Object.isFrozen(ctx.secrets),
          } }] };
        }`,
      ),
    );
    expect(result.events[0].data).toEqual({
      fetch: "undefined",
      process: "undefined",
      require: "undefined",
      setTimeout: "undefined",
      pine: "undefined",
      frozen: true,
    });
    await expect(
      runScript(
        input(
          `import fs from "fs"; export default async function poll() { return { events: [] }; }`,
        ),
      ),
    ).rejects.toThrow(/could not load module/);
  });

  it("enforces time, memory and result limits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const looping = runScript(
      input(`export default async function poll() { for (;;) {} }`),
    );
    vi.advanceTimersByTime(30_001);
    vi.useRealTimers();
    await expect(looping).rejects.toThrow();
    await expect(
      runScript(
        input(
          `export default async function poll() { const a = []; for (;;) a.push("x".repeat(1e6)); }`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      runScript(
        input(
          `export default async function poll() { return { events: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })) }; }`,
        ),
      ),
    ).rejects.toThrow(/more than 100 events/);
    await expect(
      runScript(input(`export default async function poll() { return 1; }`)),
    ).rejects.toThrow(/must return/);
  });

  it("checks syntax without running", async () => {
    expect(
      await checkScriptSyntax(
        `export default async function poll(ctx) { return { events: [] }; }`,
      ),
    ).toBeUndefined();
    expect(
      await checkScriptSyntax(`export default async function (ctx) {`),
    ).toBeDefined();
    expect(await checkScriptSyntax(`const x = 1;`)).toMatch(/export default/);
  });
});
