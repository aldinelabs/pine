// Interactive answers (`openui` blocks) as WeChat Markdown. Pure: no I/O, no
// Electron.
//
// Only Pine can draw an interface block, so before a reply reaches WeChat each
// top-level `openui` fence is replaced with the same content as ordinary
// Markdown: headings and titles as bold lines, lists, checklists and pickers as
// `- ` bullets (☐/☑, ○/●), badges as bold words joined with ` · `, tables and
// charts as GFM tables. The result is agent Markdown like any other, so
// `agentMarkdown` then narrows wide tables, closes fences and guards dot-led
// lines. Values from the block are display data: each one is a single line,
// escaped, and dot-guarded here as well, so a table cell or bullet never reads
// as a command even where `agentMarkdown` only sees the start of a line.
//
// Choices can be answered from WeChat. With `choices` on, every button that
// sends a message gets a number (`- **1** Continue`); in a block with exactly
// one picker and one such button, the picker's options get the numbers
// instead and the button is folded into them. `interfaceChoices` returns the
// message each number sends: the button's @ToAssistant text with the block's
// values, as a click in Pine would send it, at the block's defaults plus the
// picked option. Other controls (inputs, sliders, checkboxes, switches, other
// pickers and buttons that only change the block) stay read-only: their values
// live only in the window that drew the block. A block with controls ends with
// a note saying which is which. A block cut short (an unclosed fence) is never
// numbered, since a cut can change which mode the block is read in.

import {
  createParser,
  evaluate,
  evaluateElementProps,
  type ElementNode,
  type Library,
  type Parser,
} from "@openuidev/lang-core";
import {
  INTELLIGENT_UI_FENCE_LANGUAGE,
  createIntelligentUiLibrary,
} from "../../shared/intelligentUi";
import { interactionMessage } from "../../shared/intelligentUiMessage";
import { FENCE, OPENUI_PLACEHOLDER, cleanInline, neutralise } from "./text";
import type { ReplyLanguage } from "./types";

/** Rows of a table or chart kept; the rest are counted in one line. */
export const INTERFACE_ROWS_MAX = 30;
/** Options of a picker kept; the rest are counted in one line. */
export const INTERFACE_OPTIONS_MAX = 20;

/** Choices numbered across one reply; a reply never has more. */
export const INTERFACE_CHOICES_MAX = 20;

const CONTROL_NOTE: Record<ReplyLanguage, string> = {
  zh: "（以上控件只能在桌面端 Pine 中操作；也可以直接回复你的选择。）",
  en: "(These controls work only in Pine on the desktop. You can also reply with your choice in words.)",
};
const CHOICE_NOTE: Record<ReplyLanguage, string> = {
  zh: "（回复编号即可选择。）",
  en: "(Reply with a number to choose.)",
};
const CHOICE_CONTROL_NOTE: Record<ReplyLanguage, string> = {
  zh: "（回复编号即可选择；其余控件只能在桌面端 Pine 中操作。）",
  en: "(Reply with a number to choose. The other controls work only in Pine on the desktop.)",
};

/** What a numbered reply sends to the agent. */
export interface InterfaceChoice {
  /** 1-based, as shown in WeChat. */
  number: number;
  /** The button or option text, one line. */
  label: string;
  /** The message a click in Pine would send. */
  message: string;
}

const CHOICES: Record<ReplyLanguage, string> = {
  zh: "可选：",
  en: "Choices:",
};

const TREND = { up: "↑", down: "↓", flat: "→" } as const;
const CALLOUT_MARK = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  danger: "⛔",
} as const;

function more(lang: ReplyLanguage, count: number): string {
  return lang === "zh" ? `……还有 ${count} 项` : `… ${count} more`;
}

export interface ExpandOptions {
  /**
   * Plain text for `toPlainText` (history lines): values are not
   * Markdown-escaped, since the caller strips Markdown and escapes the line.
   */
  plain?: boolean;
  /** Number the choices a WeChat reply can answer. */
  choices?: boolean;
}

interface OpenFence {
  marker: string;
  info: string;
}

function openingFence(line: string): OpenFence | undefined {
  const match = FENCE.exec(line);
  return match
    ? { marker: match[1] ?? "```", info: match[2] ?? "" }
    : undefined;
}

function closesFence(line: string, fence: OpenFence): boolean {
  const trimmed = line.trim();
  return (
    /^ {0,3}\S/.test(line) &&
    trimmed.length >= fence.marker.length &&
    [...trimmed].every((point) => point === fence.marker[0])
  );
}

/** Closes a fence the agent's Markdown leaves open, so it cannot swallow the rest of the reply. */
function closeFences(markdown: string): string {
  let fence: OpenFence | undefined;
  for (const line of markdown.split("\n")) {
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
    } else {
      fence = openingFence(line);
    }
  }
  return fence ? `${markdown}\n${fence.marker}` : markdown;
}

let cached: { library: Library; parser: Parser } | undefined;

function interfaceParser(): { library: Library; parser: Parser } {
  if (!cached) {
    const library = createIntelligentUiLibrary();
    cached = { library, parser: createParser(library.toJSONSchema(), "Stack") };
  }
  return cached;
}

/**
 * One value of display data as inline Markdown: a single line, dot-guarded,
 * inline markers and `|` escaped so it cannot add a table column, and a
 * leading block marker escaped so it cannot start a heading, list or quote.
 */
export function interfaceInline(value: unknown, plain = false): string {
  const text = neutralise(scalarText(value));
  if (plain) return text;
  return text
    .replace(/[\\`*_~[\]<&|]/g, "\\$&")
    .replace(/^([#>+=-]|\d{1,9}(?=[.)]))/, (marker) =>
      /^\d/.test(marker) ? `${marker}\\` : `\\${marker}`,
    );
}

/** Multi-line display data: each non-empty line through `interfaceInline`. */
function interfaceLines(value: unknown, plain: boolean): string {
  return scalarText(value, true)
    .split(/\r\n?|\n/)
    .map((line) => interfaceInline(line, plain))
    .filter((line) => line !== "")
    .join("\n");
}

function scalarText(value: unknown, multiline = false): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return multiline ? value : cleanInline(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  return "";
}

function isElement(value: unknown): value is ElementNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "element" &&
    typeof (value as { typeName?: unknown }).typeName === "string"
  );
}

/** Child elements, flattening the nested lists `@Each` produces. */
function elements(value: unknown): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  return isElement(value) ? [value] : [];
}

/** A `$binding` prop's state name, if the prop is one. */
function bindingTarget(raw: unknown): string | undefined {
  if (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { __reactive?: unknown }).__reactive === "assign"
  ) {
    const target = (raw as { target?: unknown }).target;
    return typeof target === "string" ? target : undefined;
  }
  return undefined;
}

/** Every element of a tree, depth first. */
function walk(node: ElementNode, visit: (node: ElementNode) => void): void {
  visit(node);
  for (const key of ["children", "tabs"]) {
    for (const child of elements(node.props[key])) walk(child, visit);
  }
}

const PICKERS = new Set(["Select", "RadioGroup", "SegmentedControl"]);

class Converter {
  /** Read-only controls drawn. */
  controls = false;
  /** Choices this block numbered. */
  numbered = 0;
  /** In option mode, the picker whose options are the choices. */
  private optionPicker: ElementNode | undefined;
  /** In option mode, the button the options submit through. */
  private optionButton: ElementNode | undefined;

  constructor(
    private readonly lang: ReplyLanguage,
    private readonly state: Record<string, unknown>,
    private readonly plain: boolean,
    /** Shared across the reply's blocks; `undefined` when not numbering. */
    private readonly choices: InterfaceChoice[] | undefined,
  ) {}

  /** Picks the mode: one picker and one sending button → option mode. */
  plan(root: ElementNode): void {
    if (!this.choices) return;
    const pickers: ElementNode[] = [];
    const senders: ElementNode[] = [];
    walk(root, (node) => {
      if (PICKERS.has(node.typeName)) pickers.push(node);
      if (this.sends(node)) senders.push(node);
    });
    const [picker] = pickers;
    if (
      pickers.length === 1 &&
      senders.length === 1 &&
      picker &&
      bindingTarget(picker.props.value) !== undefined
    ) {
      this.optionPicker = picker;
      this.optionButton = senders[0];
    }
  }

  private sends(node: ElementNode): boolean {
    return (
      node.typeName === "Button" &&
      node.props.disabled !== true &&
      this.message(node, {}) !== undefined
    );
  }

  /**
   * The message a click on `button` sends with `picked` set first, following
   * Pine's renderer: the steps run in order, @Set and @Reset change the
   * values, and the first @ToAssistant sends its text with every value; a
   * button without an action sends its label. `undefined` when it sends
   * nothing.
   */
  private message(
    button: ElementNode,
    picked: Record<string, unknown>,
  ): string | undefined {
    const values: Record<string, unknown> = { ...this.state, ...picked };
    const action = button.props.action;
    const label =
      typeof button.props.label === "string" ? button.props.label : "";
    let steps: unknown[] | undefined;
    if (typeof action === "object" && action !== null) {
      const plan = action as { steps?: unknown; type?: unknown };
      if (Array.isArray(plan.steps)) steps = plan.steps;
      else if (typeof plan.type === "string") steps = [action];
    }
    if (!steps) return interactionMessage(label, values) || undefined;
    for (const raw of steps) {
      const step = raw as {
        type?: unknown;
        target?: unknown;
        targets?: unknown;
        valueAST?: unknown;
        message?: unknown;
      };
      if (step.type === "set" && typeof step.target === "string") {
        try {
          values[step.target] = evaluate(
            step.valueAST as Parameters<typeof evaluate>[0],
            { getState: (name) => values[name], resolveRef: () => null },
          );
        } catch {
          return undefined;
        }
      } else if (step.type === "reset" && Array.isArray(step.targets)) {
        for (const target of step.targets)
          if (typeof target === "string")
            values[target] = this.state[target] ?? null;
      } else if (step.type === "continue_conversation") {
        const text = typeof step.message === "string" ? step.message : "";
        return interactionMessage(text, values) || undefined;
      }
    }
    return undefined;
  }

  /** Numbers a choice; `undefined` once the reply has as many as it may. */
  private choose(
    label: unknown,
    message: string | undefined,
  ): number | undefined {
    if (!this.choices || message === undefined) return undefined;
    if (this.choices.length >= INTERFACE_CHOICES_MAX) return undefined;
    const number = this.choices.length + 1;
    this.choices.push({
      number,
      label: cleanInline(scalarText(label)),
      message,
    });
    this.numbered += 1;
    return number;
  }

  private inline(value: unknown): string {
    return interfaceInline(value, this.plain);
  }

  private lines(value: unknown): string {
    return interfaceLines(value, this.plain);
  }

  /** A prop with a `$binding` read at its default value. */
  private value(props: Record<string, unknown>, key: string): unknown {
    const raw = props[key];
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as { __reactive?: unknown }).__reactive === "assign"
    ) {
      return this.state[(raw as { target: string }).target];
    }
    return raw;
  }

  private text(props: Record<string, unknown>, key: string): string {
    return this.inline(this.value(props, key));
  }

  /** Markdown for a list of sibling elements. */
  children(nodes: unknown): string {
    const out: string[] = [];
    let row: string[] = [];
    let bullets: string[] = [];
    const flushRow = () => {
      if (row.length > 0) out.push(row.join(" · "));
      row = [];
    };
    const flushBullets = () => {
      if (bullets.length > 0) out.push(bullets.join("\n"));
      bullets = [];
    };
    let buttons: string[] = [];
    const flushButtons = () => {
      if (buttons.length > 0) {
        out.push(`${CHOICES[this.lang]}\n${buttons.join("\n")}`);
      }
      buttons = [];
    };
    for (const node of elements(nodes)) {
      const kind = node.typeName;
      if (kind !== "Badge") flushRow();
      if (kind !== "Checkbox" && kind !== "Switch") flushBullets();
      if (kind !== "Button") flushButtons();
      if (kind === "Badge") {
        const text = this.text(node.props, "text");
        if (text) row.push(`**${text}**`);
      } else if (kind === "Checkbox" || kind === "Switch") {
        this.controls = true;
        const label = this.text(node.props, "label");
        const description = this.text(node.props, "description");
        const box = this.value(node.props, "value") === true ? "☑" : "☐";
        bullets.push(
          `- ${box} ${[label, description].filter(Boolean).join(" · ")}`.trimEnd(),
        );
      } else if (kind === "Button") {
        // In option mode the button is folded into the numbered options.
        if (node === this.optionButton) continue;
        const label = this.text(node.props, "label");
        if (!label) continue;
        const number =
          this.choices && this.sends(node)
            ? this.choose(node.props.label, this.message(node, {}))
            : undefined;
        if (number === undefined) {
          this.controls = true;
          buttons.push(`- ${label}`);
        } else {
          buttons.push(`- **${number}** ${label}`);
        }
      } else {
        const text = this.element(node);
        if (text) out.push(text);
      }
    }
    flushRow();
    flushBullets();
    flushButtons();
    return out.join("\n\n");
  }

  private element(node: ElementNode): string {
    const props = node.props;
    switch (node.typeName) {
      case "Stack":
      case "Grid":
      case "Tab":
        return this.children(props.children);
      case "Card":
        return [
          this.bold(this.text(props, "title")),
          this.lines(this.value(props, "description")),
          this.children(props.children),
        ]
          .filter(Boolean)
          .join("\n\n");
      case "Tabs":
        return elements(props.tabs)
          .map((tab) =>
            [
              this.bold(this.text(tab.props, "label")),
              this.children(tab.props.children),
            ]
              .filter(Boolean)
              .join("\n\n"),
          )
          .filter(Boolean)
          .join("\n\n");
      case "Heading":
        return this.bold(this.text(props, "text"));
      case "Text":
        return this.lines(this.value(props, "text"));
      case "Markdown": {
        const source = this.value(props, "source");
        return typeof source === "string" ? closeFences(source.trim()) : "";
      }
      case "List":
        return this.list(props);
      case "Stat":
        return this.stat(props);
      case "Callout":
        return this.callout(props);
      case "Progress": {
        const value = Number(this.value(props, "value"));
        if (!Number.isFinite(value)) return "";
        const percent = `${Math.round(Math.min(100, Math.max(0, value)))}%`;
        const label = this.text(props, "label");
        return label ? `${label}: **${percent}**` : `**${percent}**`;
      }
      case "Table":
        return this.table(props);
      case "Chart":
        return this.chart(props);
      case "Input":
      case "Textarea":
        return this.field(props);
      case "Slider":
        return this.slider(props);
      case "Select":
      case "RadioGroup":
      case "SegmentedControl":
        return node === this.optionPicker
          ? this.options(node)
          : this.picker(props);
      case "Badge":
      case "Checkbox":
      case "Switch":
      case "Button":
        return this.children([node]);
      default:
        // Separator and anything unknown draw nothing in WeChat.
        return "";
    }
  }

  private bold(text: string): string {
    return text ? `**${text}**` : "";
  }

  private list(props: Record<string, unknown>): string {
    const items = this.value(props, "items");
    if (!Array.isArray(items)) return "";
    const ordered = this.value(props, "ordered") === true;
    return items
      .map((item) => this.inline(item))
      .filter(Boolean)
      .map((item, index) =>
        ordered ? `- **${index + 1}** ${item}` : `- ${item}`,
      )
      .join("\n");
  }

  private stat(props: Record<string, unknown>): string {
    const label = this.text(props, "label");
    const value = this.text(props, "value");
    const caption = this.text(props, "caption");
    const trend = this.value(props, "trend");
    const arrow =
      trend === "up" || trend === "down" || trend === "flat"
        ? ` ${TREND[trend]}`
        : "";
    const head = [label, value && `**${value}**${arrow}`]
      .filter(Boolean)
      .join(": ");
    return [head, caption].filter(Boolean).join(" · ");
  }

  private callout(props: Record<string, unknown>): string {
    const tone = this.value(props, "tone");
    const mark =
      tone === "success" || tone === "warning" || tone === "danger"
        ? CALLOUT_MARK[tone]
        : CALLOUT_MARK.info;
    const title = this.text(props, "title");
    const text = this.lines(this.value(props, "text"));
    return [title ? `${mark} **${title}**` : mark, text]
      .filter(Boolean)
      .join(title ? "\n" : " ");
  }

  private gfm(head: string[], rows: unknown[][]): string {
    if (head.length === 0) return "";
    const kept = rows.slice(0, INTERFACE_ROWS_MAX);
    const line = (cells: string[]) =>
      `| ${cells.map((cell) => cell || " ").join(" | ")} |`;
    return [
      line(head),
      `|${head.map(() => "---").join("|")}|`,
      ...kept.map((cells) =>
        // `—` keeps an empty cell, so a table flattened to `a · b · c`
        // rows stays aligned with its header.
        line(head.map((_, index) => this.inline(cells[index]) || "—")),
      ),
      ...(rows.length > kept.length
        ? ["", more(this.lang, rows.length - kept.length)]
        : []),
    ].join("\n");
  }

  private table(props: Record<string, unknown>): string {
    const columns = this.value(props, "columns");
    const rows = this.value(props, "rows");
    if (!Array.isArray(columns)) return "";
    const head = columns.map((column) => this.inline(column));
    const body = Array.isArray(rows)
      ? rows.filter((row): row is unknown[] => Array.isArray(row))
      : [];
    return [this.lines(this.value(props, "caption")), this.gfm(head, body)]
      .filter(Boolean)
      .join("\n\n");
  }

  private chart(props: Record<string, unknown>): string {
    const data = this.value(props, "data");
    const x = this.value(props, "x");
    const seriesProp = this.value(props, "series");
    if (!Array.isArray(data) || typeof x !== "string") return "";
    const allSeries = Array.isArray(seriesProp)
      ? seriesProp.filter((name): name is string => typeof name === "string")
      : [];
    const series =
      this.value(props, "type") === "donut" ? allSeries.slice(0, 1) : allSeries;
    const keys = [x, ...series];
    const rows = data
      .filter(
        (datum): datum is Record<string, unknown> =>
          typeof datum === "object" && datum !== null,
      )
      .map((datum) => keys.map((key) => datum[key]));
    return [
      this.bold(this.text(props, "title")),
      this.gfm(
        keys.map((key) => this.inline(key)),
        rows,
      ),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private field(props: Record<string, unknown>): string {
    this.controls = true;
    const label = this.text(props, "label");
    const value = this.text(props, "value");
    const placeholder = this.text(props, "placeholder");
    const shown = value
      ? `**${value}**`
      : placeholder
        ? `(${placeholder})`
        : "";
    return [label, shown].filter(Boolean).join(": ") || "( )";
  }

  private slider(props: Record<string, unknown>): string {
    this.controls = true;
    const label = this.text(props, "label");
    const value = this.text(props, "value");
    const range = `${this.text(props, "min")}–${this.text(props, "max")}`;
    return [label, `**${value}** (${range})`].filter(Boolean).join(": ");
  }

  /** The option-mode picker: each option a numbered choice. */
  private options(node: ElementNode): string {
    const options = this.value(node.props, "options");
    const target = bindingTarget(node.props.value);
    const button = this.optionButton;
    if (!Array.isArray(options) || target === undefined || !button)
      return this.picker(node.props);
    const lines: string[] = [];
    for (const option of options) {
      const text = this.inline(option);
      if (!text) continue;
      const number = this.choose(
        option,
        this.message(button, { [target]: option }),
      );
      if (number === undefined) {
        // Past the cap the rest are shown, without numbers.
        this.controls = true;
        lines.push(`- ${text}`);
      } else {
        lines.push(`- **${number}** ${text}`);
      }
    }
    const label = this.bold(this.text(node.props, "label"));
    return [label, lines.join("\n")].filter(Boolean).join("\n");
  }

  private picker(props: Record<string, unknown>): string {
    this.controls = true;
    const options = this.value(props, "options");
    const current = this.value(props, "value");
    if (!Array.isArray(options)) return "";
    const kept = options.slice(0, INTERFACE_OPTIONS_MAX);
    const lines = kept
      .map((option) => {
        const text = this.inline(option);
        if (!text) return "";
        return `- ${option === current ? "●" : "○"} ${text}`;
      })
      .filter(Boolean);
    if (options.length > kept.length)
      lines.push(`- ${more(this.lang, options.length - kept.length)}`);
    const label = this.bold(this.text(props, "label"));
    return [label, lines.join("\n")].filter(Boolean).join("\n");
  }
}

/**
 * One `openui` block as WeChat Markdown, or `undefined` when it does not parse
 * to anything drawable (the caller then shows the placeholder).
 */
export function interfaceBlockMarkdown(
  code: string,
  lang: ReplyLanguage,
  options: ExpandOptions = {},
  choices?: InterfaceChoice[],
): string | undefined {
  let root: ElementNode | null;
  let state: Record<string, unknown>;
  try {
    const { library, parser } = interfaceParser();
    const parsed = parser.parse(code);
    state = parsed.stateDeclarations;
    root = parsed.root
      ? evaluateElementProps(parsed.root, {
          ctx: {
            getState: (name) => state[name],
            resolveRef: () => null,
          },
          library,
          store: null,
        })
      : null;
  } catch {
    return undefined;
  }
  if (!root) return undefined;
  const taken = choices?.length ?? 0;
  const converter = new Converter(lang, state, options.plain === true, choices);
  converter.plan(root);
  const body = converter.children([root]).trim();
  if (!body) {
    choices?.splice(taken);
    return undefined;
  }
  const note =
    converter.numbered > 0
      ? converter.controls
        ? CHOICE_CONTROL_NOTE[lang]
        : CHOICE_NOTE[lang]
      : converter.controls
        ? CONTROL_NOTE[lang]
        : undefined;
  return note ? `${body}\n\n${note}` : body;
}

/**
 * The reply with every top-level `openui` fence replaced by its Markdown (or
 * the placeholder). Fences of other languages, including ones that quote an
 * `openui` fence, are kept as written.
 */
export function expandInterfaceBlocks(
  markdown: string,
  lang: ReplyLanguage,
  options: ExpandOptions = {},
): string {
  return convert(markdown, lang, options).text;
}

/**
 * The choices a WeChat reply of `markdown` numbers (with `choices` on), in
 * order: what each number sends.
 */
export function interfaceChoices(markdown: string): InterfaceChoice[] {
  return convert(markdown, "en", { choices: true }).choices;
}

function convert(
  markdown: string,
  lang: ReplyLanguage,
  options: ExpandOptions,
): { text: string; choices: InterfaceChoice[] } {
  const choices: InterfaceChoice[] = [];
  if (!markdown.toLowerCase().includes(INTELLIGENT_UI_FENCE_LANGUAGE)) {
    return { text: markdown, choices };
  }
  const out: string[] = [];
  let fence: (OpenFence & { openui: boolean; body: string[] }) | undefined;
  const flush = (body: string[], closed: boolean) => {
    out.push(
      "",
      interfaceBlockMarkdown(
        body.join("\n"),
        lang,
        options,
        options.choices === true && closed ? choices : undefined,
      ) ?? OPENUI_PLACEHOLDER[lang],
      "",
    );
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      const closes = closesFence(line, fence);
      if (fence.openui) {
        if (closes) {
          flush(fence.body, true);
          fence = undefined;
        } else {
          fence.body.push(line);
        }
        continue;
      }
      out.push(line);
      if (closes) fence = undefined;
      continue;
    }
    const open = openingFence(line);
    if (open) {
      const openui =
        open.marker.startsWith("`") &&
        open.info.toLowerCase() === INTELLIGENT_UI_FENCE_LANGUAGE;
      fence = { ...open, openui, body: [] };
      if (!openui) out.push(line);
      continue;
    }
    out.push(line);
  }
  // An unterminated block still draws what has arrived, as in Pine.
  if (fence?.openui) flush(fence.body, false);
  return { text: out.join("\n"), choices };
}
