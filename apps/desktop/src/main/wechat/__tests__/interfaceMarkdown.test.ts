// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  INTERFACE_ROWS_MAX,
  expandInterfaceBlocks,
  interfaceBlockMarkdown,
  interfaceInline,
} from "../interfaceMarkdown";
import { agentMarkdown } from "../markdown";
import { parseCommand } from "../parseCommand";
import { OPENUI_PLACEHOLDER, toPlainText } from "../text";

const NOTE_EN = "These controls work only in Pine on the desktop";
const NOTE_ZH = "以上控件只能在桌面端 Pine 中操作";

function block(code: string): string {
  return `Lead-in.\n\n\`\`\`openui\n${code}\n\`\`\`\n\nAfter.`;
}

function wechat(code: string, lang: "en" | "zh" = "en"): string {
  return agentMarkdown(block(code), lang);
}

/** No line, and no table cell or ` · ` part, reads as a dot command. */
function expectNoCommands(text: string): void {
  for (const line of text.split("\n")) {
    expect(parseCommand(line).kind).toBe("message");
    const parts = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\||·/);
    for (const part of parts) {
      const visible = part
        .trim()
        .replace(/^(?:[-*+]\s+|>\s?|#{1,6}\s+)*/, "")
        .replace(/^[☐☑○●]\s*/, "")
        .replace(/^[*_`~]+/, "");
      expect(/^[.。．｡]/.test(visible)).toBe(false);
    }
  }
}

describe("interfaceInline", () => {
  it("keeps one line, escapes Markdown and pipes, and guards a dot", () => {
    expect(interfaceInline("a | b\nc")).toBe("a \\| b c");
    expect(interfaceInline(".stop")).toBe("› .stop");
    expect(interfaceInline("# title")).toBe("\\# title");
    expect(interfaceInline("- item")).toBe("\\- item");
    expect(interfaceInline("1. first")).toBe("1\\. first");
    expect(interfaceInline("**x** `y`")).toBe("\\*\\*x\\*\\* \\`y\\`");
    expect(interfaceInline(3)).toBe("3");
    expect(interfaceInline(true)).toBe("✓");
    expect(interfaceInline(null)).toBe("");
  });

  it("skips Markdown escapes in plain mode but still guards a dot", () => {
    expect(interfaceInline("a | *b*", true)).toBe("a | *b*");
    expect(interfaceInline("。y 12", true)).toBe("› 。y 12");
  });
});

describe("static elements", () => {
  it("renders headings, text, cards and markdown", () => {
    const text = wechat(
      [
        'root = Card([Heading("Plan"), Text("First line\\nSecond line", "muted"), Markdown("**kept** as is"), Separator()], "Weekend", "Two days")',
      ].join("\n"),
    );
    expect(text).toBe(
      [
        "Lead-in.",
        "",
        "**Weekend**",
        "",
        "Two days",
        "",
        "**Plan**",
        "",
        "First line",
        "Second line",
        "",
        "**kept** as is",
        "",
        "After.",
      ].join("\n"),
    );
  });

  it("renders lists, badges, stats, callouts and progress", () => {
    const text = wechat(
      [
        "root = Stack([list, numbered, badges, stat, warn, info, progress])",
        'list = List(["Tent", "Stove"])',
        'numbered = List(["Pack", "Drive"], true)',
        'badges = Stack([Badge("Done"), Badge("2 left", "outline")], "row")',
        'stat = Stat("Total", 1200, "this month", "up")',
        'warn = Callout("Bring water.", "Heads up", "warning")',
        'info = Callout("Short note.")',
        'progress = Progress(42.4, "Packed")',
      ].join("\n"),
    );
    expect(text).toContain("- Tent\n- Stove");
    expect(text).toContain("- **1** Pack\n- **2** Drive");
    expect(text).toContain("**Done** · **2 left**");
    expect(text).toContain("Total: **1200** ↑ · this month");
    expect(text).toContain("⚠️ **Heads up**\nBring water.");
    expect(text).toContain("ℹ️ Short note.");
    expect(text).toContain("Packed: **42%**");
    expect(text).not.toContain(NOTE_EN);
  });

  it("renders tabs as bold labels over their panels", () => {
    const text = wechat(
      'root = Tabs([Tab("Overview", [Text("All good")]), Tab("Details", [List(["a", "b"])])])',
    );
    expect(text).toContain(
      "**Overview**\n\nAll good\n\n**Details**\n\n- a\n- b",
    );
  });
});

describe("tables and charts", () => {
  it("keeps a narrow table as a GFM table with a blank line around it", () => {
    const text = wechat(
      'root = Table(["Name", "Done"], [["Tent", true], ["Stove", false], ["Map", null]], "Gear")',
    );
    expect(text).toContain(
      [
        "Gear",
        "",
        "| Name | Done |",
        "|---|---|",
        "| Tent | ✓ |",
        "| Stove | ✗ |",
        "| Map | — |",
        "",
        "After.",
      ].join("\n"),
    );
  });

  it("flattens a wide table to aligned a · b · c rows", () => {
    const text = wechat(
      'root = Table(["A", "B", "C", "D"], [["1", null, "3", "4"]])',
    );
    expect(text).toContain("A · B · C · D\n1 · — · 3 · 4");
    expect(text).not.toContain("|---");
  });

  it("caps long tables with a count", () => {
    const rows = Array.from(
      { length: INTERFACE_ROWS_MAX + 5 },
      (_, index) => `["r${index}"]`,
    ).join(", ");
    const en = wechat(`root = Table(["Row"], [${rows}])`);
    expect(en).toContain(`| r${INTERFACE_ROWS_MAX - 1} |`);
    expect(en).not.toContain(`| r${INTERFACE_ROWS_MAX} |`);
    expect(en).toContain("… 5 more");
    expect(wechat(`root = Table(["Row"], [${rows}])`, "zh")).toContain(
      "……还有 5 项",
    );
  });

  it("renders a chart as a data table of x and its series", () => {
    const code = [
      'root = Chart("bar", data, "quarter", ["cloud", "devices"], "Revenue")',
      'data = [{quarter: "Q1", cloud: 120, devices: 80}, {quarter: "Q2", cloud: 150, devices: 95}]',
    ].join("\n");
    expect(wechat(code)).toContain(
      [
        "**Revenue**",
        "",
        "| quarter | cloud | devices |",
        "|---|---|---|",
        "| Q1 | 120 | 80 |",
        "| Q2 | 150 | 95 |",
      ].join("\n"),
    );
    const donut = wechat(code.replace('"bar"', '"donut"'));
    expect(donut).toContain("| quarter | cloud |\n|---|---|\n| Q1 | 120 |");
  });

  it("evaluates expressions at the block's default values", () => {
    const code = [
      "root = Stack([view, shown])",
      '$view = "Table"',
      'view = SegmentedControl($view, ["Chart", "Table"])',
      'shown = $view == "Chart" ? Text("chart") : Table(["Q", "N"], [["Q1", 1 + 2]])',
    ].join("\n");
    const text = wechat(code);
    expect(text).toContain("| Q1 | 3 |");
    expect(text).not.toContain("chart\n");
  });
});

describe("controls", () => {
  const form = [
    'root = Card([size, mode, choice, name, notes, budget, ok, items, send, later], "Order")',
    '$size = "M"',
    '$mode = "Fast"',
    '$choice = ""',
    '$name = "Ada"',
    '$notes = ""',
    "$budget = 40",
    "$ok = true",
    "$tent = false",
    'size = Select($size, ["S", "M", "L"], "Size")',
    'mode = SegmentedControl($mode, ["Fast", "Cheap"])',
    'choice = RadioGroup($choice, ["Yes", "No"], "Confirm")',
    'name = Input($name, "Name")',
    'notes = Textarea($notes, "Notes", "Anything else")',
    'budget = Slider($budget, 0, 100, 10, "Budget")',
    'ok = Switch($ok, "Gift wrap")',
    'items = Stack([Checkbox($tent, "Tent", "Two people")])',
    'send = Button("Send order", @ToAssistant("Place the order"))',
    'later = Button("Later")',
  ].join("\n");

  it("lists choices read-only with the current value marked (en)", () => {
    const text = wechat(form);
    expect(text).toContain("**Size**\n- ○ S\n- ● M\n- ○ L");
    expect(text).toContain("- ● Fast\n- ○ Cheap");
    expect(text).toContain("**Confirm**\n- ○ Yes\n- ○ No");
    expect(text).toContain("Name: **Ada**");
    expect(text).toContain("Notes: (Anything else)");
    expect(text).toContain("Budget: **40** (0–100)");
    expect(text).toContain("- ☑ Gift wrap");
    expect(text).toContain("- ☐ Tent · Two people");
    expect(text).toContain("Choices:\n- Send order\n- Later");
    expect(text).toContain(NOTE_EN);
    // The note follows the block, before the agent's own text.
    expect(text.indexOf(NOTE_EN)).toBeLessThan(text.indexOf("After."));
  });

  it("uses Chinese labels and note (zh)", () => {
    const text = wechat(form, "zh");
    expect(text).toContain("可选：\n- Send order\n- Later");
    expect(text).toContain(NOTE_ZH);
    expect(text).not.toContain(NOTE_EN);
  });

  it("adds the note once per block that has controls", () => {
    const text = agentMarkdown(
      `${block('root = Button("A")')}\n\n${block('root = Text("plain")')}`,
      "en",
    );
    expect(text.split(NOTE_EN)).toHaveLength(2);
  });
});

describe("hostile text", () => {
  const hostile = [
    "root = Stack([t, l, tbl, wide, cb, sel, btn, badge, stat, chart])",
    "$c = false",
    '$s = ".y 12"',
    't = Text(".stop\\n。k 2\\nrow | with | pipes\\n---|---\\n```")',
    'l = List([".d 13", "a\\nb"])',
    'tbl = Table([".a", "b|c"], [[".y 12", "x|y\\nz"], ["．k 1", "**bold**"]])',
    'wide = Table(["a", "b", "c", "d"], [[".y 12", "1", "2", "3"]])',
    'cb = Checkbox($c, ".approve")',
    'sel = Select($s, [".y 12", "｡n"], ".label")',
    'btn = Button(".stop all")',
    'badge = Badge(".pause")',
    'stat = Stat(".s", ".v")',
    'chart = Chart("bar", data, "x", ["n"])',
    'data = [{x: ".y 1", n: 2}]',
  ].join("\n");

  for (const lang of ["en", "zh"] as const) {
    it(`never produces a command line or cell (${lang})`, () => {
      const text = wechat(hostile, lang);
      expectNoCommands(text);
      expect(text).toContain("› .stop");
      expect(text).toContain("› 。k 2");
      expect(text).toContain("| › .a | b\\|c |");
      expect(text).toContain("| › .y 12 | x\\|y z |");
      expect(text).toContain("› .y 12 · 1 · 2 · 3");
      expect(text).toContain("- ☐ › .approve");
      expect(text).toContain("- ● › .y 12");
      expect(text).toContain("- › .stop all");
      expect(text).toContain("**› .pause**");
      // A `|` line followed by a delimiter-looking line is not a table, and a
      // fence in plain text does not open a code block.
      expect(text).toContain("row \\| with \\| pipes\n\\---\\|---\n\\`\\`\\`");
      expect(text.endsWith("After.")).toBe(true);
    });
  }

  it("closes a fence left open by a Markdown element", () => {
    const text = wechat(
      'root = Stack([Markdown("```js\\nlet x"), Text("still here")])',
    );
    expect(text).toContain("```js\nlet x\n```\n\nstill here");
    expect(text.endsWith("After.")).toBe(true);
  });
});

describe("expandInterfaceBlocks", () => {
  it("leaves text without an openui block untouched", () => {
    const text = "a\n```js\nb\n```";
    expect(expandInterfaceBlocks(text, "en")).toBe(text);
  });

  it("keeps a fence that quotes an openui block", () => {
    const text = '````md\n```openui\nroot = Text("x")\n```\n````';
    expect(expandInterfaceBlocks(text, "en")).toBe(text);
  });

  it("falls back to the placeholder when the block does not parse", () => {
    for (const lang of ["en", "zh"] as const) {
      expect(wechat("<x/>", lang)).toContain(OPENUI_PLACEHOLDER[lang]);
      expect(interfaceBlockMarkdown("", lang)).toBeUndefined();
    }
  });

  it("draws what has arrived of an unterminated block", () => {
    const text = agentMarkdown('Hi\n```openui\nroot = Text("partial")', "en");
    expect(text).toBe("Hi\n\npartial");
  });

  it("gives history a plain line without Markdown escapes", () => {
    const markdown = block(
      'root = Stack([Heading("Plan"), Table(["a", "b"], [["x|y", "*z*"]])])',
    );
    const plain = toPlainText(
      expandInterfaceBlocks(markdown, "en", { plain: true }),
      "en",
    );
    expect(plain).toContain("Plan");
    expect(plain).not.toContain("\\");
    expect(plain).not.toContain(OPENUI_PLACEHOLDER.en);
  });
});
