// @vitest-environment node
// Completeness of the handler registry (plan section 3.8). This passes only
// once every wave-5 handler module is filled in.
import { describe, expect, it } from "vitest";
import { lookupCommand } from "../../commandSpec";
import { render } from "../../replies";
import { COMMAND_NAMES } from "../../types";
import { HANDLERS } from "../index";
import { handleNumber, handlePlainMessage } from "../message";

describe("handler registry", () => {
  it("has a handler for every command", () => {
    for (const name of COMMAND_NAMES) {
      expect(typeof HANDLERS.commands[name], name).toBe("function");
    }
    expect(HANDLERS.message).toBe(handlePlainMessage);
    expect(HANDLERS.number).toBe(handleNumber);
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
      const aliases = [...help.matchAll(/(?:^|\s|`)\.([a-z][a-z0-9]*)/g)]
        .map((match) => match[1] ?? "")
        .filter((alias) => alias !== "number");
      expect(aliases.length).toBeGreaterThan(10);
      for (const alias of aliases) {
        expect(lookupCommand(alias), `.${alias} (${lang})`).toBeDefined();
      }
    }
  });
});
