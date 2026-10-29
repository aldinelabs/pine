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

  it("encourages blocks for users who chose rich interface elements", () => {
    expect(prompt).toContain("The user has enabled rich interface elements");
    expect(prompt).toContain("A block can be purely visual");
    expect(prompt).not.toContain("Use a block only when");
    expect(prompt).not.toContain("At most one block per reply");
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

  it("builds the prompt once", () => {
    expect(intelligentUiSystemPrompt()).toBe(prompt);
  });
});
