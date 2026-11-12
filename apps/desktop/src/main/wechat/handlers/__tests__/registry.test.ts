// @vitest-environment node
// Completeness of the handler registry (plan section 3.8). This passes only
// once every wave-5 handler module is filled in.
import { describe, expect, it } from "vitest";
import { lookupCommand } from "../../commandSpec";
import { render } from "../../replies";
import { COMMAND_NAMES, type CommandName } from "../../types";
import { askHandlers } from "../asks";
import { automationHandlers } from "../automations";
import { catalogHandlers } from "../catalog";
import { controlHandlers } from "../controls";
import { fileHandlers } from "../files";
import { HANDLERS } from "../index";
import { handleNumber, handlePlainMessage } from "../message";
import { metaHandlers } from "../meta";
import { projectHandlers } from "../projects";
import { sessionHandlers } from "../sessions";
import { taskHandlers } from "../tasks";

const MODULES: [string, object, CommandName[]][] = [
  [
    "meta",
    metaHandlers,
    ["help", "status", "info", "lang", "pause", "more", "drop"],
  ],
  [
    "sessions",
    sessionHandlers,
    [
      "new",
      "sessions",
      "search",
      "use",
      "last",
      "history",
      "stop",
      "queue",
      "unqueue",
      "rename",
      "delete",
    ],
  ],
  ["projects", projectHandlers, ["projects"]],
  [
    "asks",
    askHandlers,
    ["pending", "show", "approve", "reject", "guide", "answer"],
  ],
  [
    "controls",
    controlHandlers,
    ["model", "effort", "mode", "usage", "compact", "todo"],
  ],
  ["files", fileHandlers, ["files", "file"]],
  ["tasks", taskHandlers, ["tasks", "task", "kill"]],
  ["automations", automationHandlers, ["autos", "auto", "runs"]],
  ["catalog", catalogHandlers, ["skills", "mcp"]],
];

describe("handler registry", () => {
  it("has a handler for every command", () => {
    for (const name of COMMAND_NAMES) {
      expect(typeof HANDLERS.commands[name], name).toBe("function");
    }
    expect(HANDLERS.message).toBe(handlePlainMessage);
    expect(HANDLERS.number).toBe(handleNumber);
  });

  it("splits the commands over the modules exactly as planned", () => {
    const all: string[] = [];
    for (const [module, handlers, names] of MODULES) {
      expect(Object.keys(handlers).sort(), module).toEqual([...names].sort());
      all.push(...names);
    }
    expect(all.sort()).toEqual([...COMMAND_NAMES].sort());
  });

  it("resolves every alias the help replies print", () => {
    for (const lang of ["zh", "en"] as const) {
      const help = [
        render("R-HELP", lang, {
          computer: "Mac",
          ceiling: "auto-approve",
          files: false,
        }),
        render("R-HELP2", lang),
      ].join("\n");
      // ".number" is the placeholder of the bare-number rule, not an alias.
      const aliases = [...help.matchAll(/(?:^|\s)\.([a-z][a-z0-9]*)/g)]
        .map((match) => match[1] ?? "")
        .filter((alias) => alias !== "number");
      expect(aliases.length).toBeGreaterThan(10);
      for (const alias of aliases) {
        expect(lookupCommand(alias), `.${alias} (${lang})`).toBeDefined();
      }
    }
  });
});
