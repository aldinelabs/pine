// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  lookupCommand,
  specOf,
  suggestCommand,
  zhAliasPrefix,
} from "../commandSpec";
import { COMMAND_NAMES, type CommandName } from "../types";

const ASCII_NAME = /^[a-z][a-z0-9]{0,15}$/;
const CJK_NAME = /^[一-鿿]{1,4}$/u;

const GLUED: CommandName[] = [
  "use",
  "approve",
  "reject",
  "show",
  "compact",
  "answer",
  "model",
  "effort",
  "mode",
  "files",
  "file",
  "task",
  "kill",
  "unqueue",
  "auto",
  "runs",
  "projects",
  "help",
];
const PRIORITY: CommandName[] = ["stop", "pause", "reject", "guide", "kill"];

describe("command table", () => {
  it("lists exactly COMMAND_NAMES, in order", () => {
    expect(COMMANDS.map((spec) => spec.name)).toEqual([...COMMAND_NAMES]);
  });

  it("uses every name and alias once", () => {
    const tokens = COMMANDS.flatMap((spec) => [
      spec.name,
      ...spec.aliases,
      ...spec.zhAliases,
    ]);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("writes every name and alias as an ascii-name or a cjk-name", () => {
    for (const spec of COMMANDS) {
      expect(spec.name).toMatch(ASCII_NAME);
      for (const alias of spec.aliases) expect(alias).toMatch(ASCII_NAME);
      for (const alias of spec.zhAliases) expect(alias).toMatch(CJK_NAME);
    }
  });

  it("has both languages, usage and an example for every command", () => {
    for (const spec of COMMANDS) {
      expect(spec.summary.zh.length).toBeGreaterThan(0);
      expect(spec.summary.en.length).toBeGreaterThan(0);
      expect(spec.summary.zh).toMatch(/[一-鿿]/u);
      expect(spec.summary.en).not.toMatch(/[一-鿿]/u);
      expect(spec.example.startsWith(".")).toBe(true);
    }
  });

  it("has no Chinese alias that starts another command's Chinese alias", () => {
    const zh = COMMANDS.flatMap((spec) =>
      spec.zhAliases.map((alias) => ({ name: spec.name, alias })),
    );
    for (const a of zh) {
      for (const b of zh) {
        if (a.name === b.name || a.alias === b.alias) continue;
        // Within one command (停 / 停止) the longest match still resolves to the same command.
        expect(
          b.alias.startsWith(a.alias),
          `${a.alias} starts ${b.alias}`,
        ).toBe(false);
      }
    }
  });

  it("marks glued and priority commands as the plan lists them", () => {
    expect(
      COMMANDS.filter((spec) => spec.glued)
        .map((spec) => spec.name)
        .sort(),
    ).toEqual([...GLUED].sort());
    expect(
      COMMANDS.filter((spec) => spec.priority)
        .map((spec) => spec.name)
        .sort(),
    ).toEqual([...PRIORITY].sort());
  });

  it("glues digits only where the first parameter is a handle or an ask number", () => {
    for (const spec of COMMANDS.filter((entry) => entry.glued)) {
      const takesAskInTail = spec.tail && spec.positional.length === 0;
      expect(takesAskInTail || spec.positional.length > 0, spec.name).toBe(
        true,
      );
    }
  });

  it("keeps the stale classes of CMD §5.5", () => {
    expect(specOf("pause").stale).toBe("run");
    for (const name of [
      "stop",
      "kill",
      "reject",
      "guide",
      "unqueue",
    ] as const) {
      expect(specOf(name).stale).toBe("guard");
    }
    for (const name of ["new", "queue"] as const)
      expect(specOf(name).stale).toBe("hold");
    for (const name of [
      "approve",
      "answer",
      "model",
      "file",
      "delete",
      "status",
    ] as const) {
      expect(specOf(name).stale).toBe("drop");
    }
  });

  it("refuses the always-mutating commands on view-only sessions", () => {
    const refused = COMMANDS.filter((spec) => !spec.viewOnlyOk)
      .map((spec) => spec.name)
      .sort();
    expect(refused).toEqual([
      "answer",
      "approve",
      "compact",
      "delete",
      "rename",
    ]);
  });

  it("accepts @project only on new, sessions and autos", () => {
    expect(
      COMMANDS.filter((spec) => spec.project).map((spec) => spec.name),
    ).toEqual(["new", "sessions", "autos"]);
  });

  it("makes destructive commands D", () => {
    expect(specOf("delete").cls).toBe("D");
    expect(specOf("file").cls).toBe("D");
  });
});

describe("lookupCommand", () => {
  it("finds names, ASCII aliases and Chinese aliases", () => {
    expect(lookupCommand("status")).toBe("status");
    expect(lookupCommand("s")).toBe("status");
    expect(lookupCommand("状态")).toBe("status");
    expect(lookupCommand("project")).toBe("projects");
    expect(lookupCommand("proj")).toBe("projects");
    expect(lookupCommand("cancel")).toBe("reject");
    expect(lookupCommand("取消")).toBe("reject");
    expect(lookupCommand("更多")).toBe("more");
    expect(lookupCommand("gitignore")).toBeUndefined();
  });
});

describe("zhAliasPrefix", () => {
  it("takes the longest alias with more characters behind it", () => {
    expect(zhAliasPrefix("停止这个任务吧")).toEqual({
      name: "stop",
      alias: "停止",
      rest: "这个任务吧",
    });
    expect(zhAliasPrefix("新建一个")).toEqual({
      name: "new",
      alias: "新建",
      rest: "一个",
    });
    expect(zhAliasPrefix("新修一下")).toEqual({
      name: "new",
      alias: "新",
      rest: "修一下",
    });
    expect(zhAliasPrefix("停止")).toBeUndefined();
    expect(zhAliasPrefix("好的")).toBeUndefined();
  });
});

describe("suggestCommand", () => {
  it("suggests a close canonical name", () => {
    expect(suggestCommand("statsu")).toBe("status");
    expect(suggestCommand("sesions")).toBe("sessions");
    expect(suggestCommand("hepl")).toBe("help");
  });

  it("suggests nothing for short or far tokens", () => {
    expect(suggestCommand("net")).toBeUndefined();
    expect(suggestCommand("gitignore")).toBeUndefined();
    expect(suggestCommand("")).toBeUndefined();
  });

  it("suggests the longest Chinese alias a CJK token starts with", () => {
    expect(suggestCommand("停止吧")).toBe("停止");
    expect(suggestCommand("你好")).toBeUndefined();
  });
});
