// @vitest-environment node
import {
  mkdtemp,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_MAX_BYTES } from "../../constants";
import { render } from "../../replies";
import type { ParsedCommand } from "../../types";
import {
  createTestContext,
  summary,
  type TestContext,
} from "../../__tests__/fakes";
import { fileHandlers } from "../files";

function command(
  name: ParsedCommand["name"],
  ...args: string[]
): ParsedCommand {
  return { kind: "command", name, args };
}

function run(name: "files" | "file", ctx: TestContext, args: string[]) {
  const handler = fileHandlers[name];
  if (!handler) throw new Error(`no handler for ${name}`);
  return handler(ctx, command(name, ...args));
}
const files = (ctx: TestContext, ...args: string[]) => run("files", ctx, args);
const file = (ctx: TestContext, ...args: string[]) => run("file", ctx, args);

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "wechat-files-")));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup(options: { allowFileSending?: boolean } = {}): Promise<{
  ctx: TestContext;
  report: string;
  sendFile: ReturnType<typeof vi.fn>;
}> {
  const ctx = createTestContext({
    settings: { allowFileSending: options.allowFileSending ?? true },
  });
  const channel = ctx.fake.channel;
  const upload = channel.sendFile.bind(channel);
  const sendFile = vi.fn(upload);
  channel.sendFile = sendFile;
  ctx.fake.core.addProject("p1", { name: "pine" });
  ctx.fake.core.storeSession("p1", summary("s1", { name: "Fix login" }));
  await ctx.store.update((draft) => {
    draft.current = { projectId: "p1", sessionId: "s1", usedAtMs: ctx.now };
  });
  const report = path.join(dir, "report.txt");
  await writeFile(report, "hello");
  ctx.fake.core.runtimes.artifacts.set("s1", [
    { toolCallId: "t1", path: report, submitted: false },
  ]);
  return { ctx, report, sendFile };
}

describe(".files", () => {
  it("lists artifacts by base name and size and fills the file table", async () => {
    const { ctx } = await setup();
    const result = await files(ctx);
    expect(result.numbered).toEqual({ kind: "file" });
    expect(result.text).toContain("| `.1` | report.txt | 5 B |");
    expect(result.text).not.toContain(dir);
    ctx.handles.noteDelivered("file", ctx.now);
    expect(ctx.handles.resolve("file", 1, "s1")).toMatchObject({ id: "t1" });
  });

  it("says names only when the file switch is off", async () => {
    const { ctx } = await setup({ allowFileSending: false });
    const result = await files(ctx);
    expect(result.text).toContain("Sending files is turned off");
  });

  it("needs a current session", async () => {
    const ctx = createTestContext();
    expect((await files(ctx)).text).toBe(render("E-NOSESSION", "en"));
  });
});

describe(".file", () => {
  it("announces once, then sends the file after the reply and notifies locally", async () => {
    const { ctx, sendFile } = await setup();
    await files(ctx);
    ctx.handles.noteDelivered("file", ctx.now);
    const result = await file(ctx, "1");
    expect(result.text).toBe(
      render("R-SENDING", "en", { name: "report.txt", sizeBytes: 5 }),
    );
    expect(sendFile).not.toHaveBeenCalled();
    await result.after?.();
    expect(ctx.fake.channel.files).toHaveLength(1);
    expect(ctx.fake.channel.files[0]?.name).toBe("report.txt");
    expect(ctx.fake.channel.files[0]?.data.toString()).toBe("hello");
    expect(ctx.fake.host.notifications.map((n) => n.kind)).toEqual([
      "file-sent",
    ]);
  });

  it("`.files N` is the same as `.file N`", async () => {
    const { ctx } = await setup();
    await files(ctx);
    ctx.handles.noteDelivered("file", ctx.now);
    const result = await files(ctx, "1");
    await result.after?.();
    expect(ctx.fake.channel.files).toHaveLength(1);
  });

  it("with the file switch off never reaches the channel's sendFile", async () => {
    const { ctx, sendFile } = await setup({ allowFileSending: false });
    await files(ctx);
    ctx.handles.noteDelivered("file", ctx.now);
    const result = await file(ctx, "1");
    expect(result.text).toBe(render("E-SWITCH", "en"));
    expect(result.after).toBeUndefined();
    expect(sendFile).not.toHaveBeenCalled();
    expect(ctx.fake.host.notifications).toEqual([]);
  });

  it("refuses a file replaced by a symlink since it was listed", async () => {
    const { ctx, report, sendFile } = await setup();
    await files(ctx);
    ctx.handles.noteDelivered("file", ctx.now);
    const other = path.join(dir, "secret.txt");
    await writeFile(other, "secret");
    await rm(report);
    await symlink(other, report);
    const result = await file(ctx, "1");
    expect(result.text).toBe(
      render("E-GONE", "en", { variant: "file-changed" }),
    );
    expect(result.after).toBeUndefined();
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("re-checks the file before sending it", async () => {
    const { ctx, report, sendFile } = await setup();
    await files(ctx);
    ctx.handles.noteDelivered("file", ctx.now);
    const result = await file(ctx, "1");
    const other = path.join(dir, "secret.txt");
    await writeFile(other, "secret");
    await rm(report);
    await symlink(other, report);
    await result.after?.();
    expect(sendFile).not.toHaveBeenCalled();
    expect(ctx.fake.channel.texts.at(-1)).toBe(
      render("E-GONE", "en", { variant: "file-changed" }),
    );
  });

  it("refuses a file that is gone", async () => {
    const { ctx, report } = await setup();
    await files(ctx);
    ctx.handles.noteDelivered("file", ctx.now);
    await rm(report);
    expect((await file(ctx, "1")).text).toBe(
      render("E-GONE", "en", { variant: "item", kind: "file" }),
    );
  });

  it("refuses a file over the size cap", async () => {
    const { ctx, report, sendFile } = await setup();
    await truncate(report, FILE_MAX_BYTES + 1);
    await files(ctx);
    ctx.handles.noteDelivered("file", ctx.now);
    expect((await file(ctx, "1")).text).toBe(
      render("E-SIZE", "en", {
        variant: "file",
        name: "report.txt",
        sizeBytes: FILE_MAX_BYTES + 1,
      }),
    );
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("answers E-REF for a number of no delivered list, and matches by name", async () => {
    const { ctx } = await setup();
    expect((await file(ctx, "1")).text).toBe(
      render("E-REF", "en", { n: "1", list: ".o" }),
    );
    const byName = await file(ctx, "report");
    expect(byName.text).toContain("Sending report.txt");
  });

  it("needs a number", async () => {
    const { ctx } = await setup();
    expect((await file(ctx)).text).toContain("Usage: `.file");
  });
});
