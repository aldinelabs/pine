import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { compileStyle, parse } from "vue/compiler-sfc";
import { expect, it } from "vitest";

const SRC = join(__dirname, "../..");

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : vueFiles(path);
    return entry.name.endsWith(".vue") ? [path] : [];
  });
}

/** Selectors of the top-level rules, with comments and at-rules dropped. */
function selectors(css: string): string[] {
  return [
    ...css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/(?:^|})\s*([^{}@]+?)\s*\{/g),
  ].map((match) => match[1].replace(/\s+/g, " "));
}

// Vue compiles `:global(.dark) .a` in a scoped block to `.dark` alone, so the
// rule styles every dark-mode element, the root included.
it("keeps no scoped rule from compiling to a bare theme class", () => {
  const offenders: string[] = [];
  for (const file of vueFiles(SRC)) {
    const { descriptor } = parse(readFileSync(file, "utf8"), {
      filename: file,
    });
    for (const style of descriptor.styles) {
      if (!style.scoped) continue;
      const { code } = compileStyle({
        source: style.content,
        filename: file,
        id: "data-v-test",
        scoped: true,
      });
      for (const selector of selectors(code))
        for (const part of selector.split(","))
          if (/^(?:\.dark|\.light|html|:root)$/.test(part.trim()))
            offenders.push(`${relative(SRC, file)}: ${part.trim()}`);
    }
  }
  expect(offenders).toEqual([]);
});
