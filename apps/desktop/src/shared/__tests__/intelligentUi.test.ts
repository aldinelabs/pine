import { createParser } from "@openuidev/lang-core";
import { describe, expect, it } from "vitest";
import {
  INTELLIGENT_UI_FENCE_LANGUAGE,
  createIntelligentUiLibrary,
  intelligentUiSchemas,
  intelligentUiSystemPrompt,
} from "../intelligentUi";

function examplesFrom(prompt: string): string[] {
  const section = prompt.split("### Examples")[1] ?? "";
  return section
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block.startsWith("root = "));
}

describe("intelligentUiSystemPrompt", () => {
  const prompt = intelligentUiSystemPrompt();

  it("asks for fenced blocks instead of whole-reply OpenUI Lang", () => {
    expect(prompt.startsWith("## Interactive blocks")).toBe(true);
    expect(prompt).toContain(`\`\`\`${INTELLIGENT_UI_FENCE_LANGUAGE}\n`);
    expect(prompt).not.toContain("Your ENTIRE response must be");
    expect(prompt).not.toMatch(/^## (?!Interactive blocks)/mu);
  });

  it("documents every component's signature", () => {
    for (const name of Object.keys(intelligentUiSchemas)) {
      expect(prompt).toMatch(new RegExp(`^${name}\\(`, "mu"));
    }
    expect(prompt).toContain("Slider(value: $binding<number>");
    expect(prompt).toContain("action?: ActionExpression");
    expect(prompt).not.toContain('Col("Actions"');
  });

  it("only teaches examples the parser accepts", () => {
    const library = createIntelligentUiLibrary();
    const parser = createParser(library.toJSONSchema(), library.root);
    const examples = examplesFrom(prompt);

    expect(examples).toHaveLength(3);
    for (const example of examples) {
      const result = parser.parse(example);
      expect(result.root, example).toBeTruthy();
      expect(result.meta.errors, example).toEqual([]);
      expect(result.meta.unresolved, example).toEqual([]);
    }
  });

  it("teaches chart rows whose keys are the series, quoted when not ASCII", () => {
    const library = createIntelligentUiLibrary();
    const parser = createParser(library.toJSONSchema(), library.root);
    const rows = /\{species: "人", "全脑": 86, "皮层": 16\}/u.exec(prompt)?.[0];
    expect(rows).toBeDefined();

    const parsed = parser.parse(
      `root = Chart("bar", [${rows}], "species", ["全脑", "皮层"])`,
    );
    expect(parsed.root?.props.data).toEqual([
      { species: "人", 全脑: 86, 皮层: 16 },
    ]);
    // Unquoted, the same keys are lost, which the prompt warns about.
    expect(
      parser.parse(
        'root = Chart("bar", [{species: "人", 全脑: 86}], "species", ["全脑"])',
      ).root?.props.data,
    ).not.toEqual([{ species: "人", 全脑: 86 }]);
  });
});
