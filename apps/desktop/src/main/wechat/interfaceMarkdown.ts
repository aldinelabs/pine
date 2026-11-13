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
// Controls are read-only: what the user picks lives only in the Pine window
// that drew the block, so a WeChat reply cannot change it. A block with
// controls ends with a note to answer in words or open Pine on the desktop.

import {
  createParser,
  evaluateElementProps,
  type ElementNode,
  type Library,
  type Parser,
} from "@openuidev/lang-core";
import {
  INTELLIGENT_UI_FENCE_LANGUAGE,
  createIntelligentUiLibrary,
} from "../../shared/intelligentUi";
import { FENCE, OPENUI_PLACEHOLDER, cleanInline, neutralise } from "./text";
import type { ReplyLanguage } from "./types";

/** Rows of a table or chart kept; the rest are counted in one line. */
export const INTERFACE_ROWS_MAX = 30;
/** Options of a picker kept; the rest are counted in one line. */
export const INTERFACE_OPTIONS_MAX = 20;

const CONTROL_NOTE: Record<ReplyLanguage, string> = {
  zh: "（以上控件只能在桌面端 Pine 中操作；也可以直接回复你的选择。）",
  en: "(These controls work only in Pine on the desktop. You can also reply with your choice in words.)",
};

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

class Converter {
  controls = false;

  constructor(
    private readonly lang: ReplyLanguage,
    private readonly state: Record<string, unknown>,
    private readonly plain: boolean,
  ) {}

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
        this.controls = true;
        const label = this.text(node.props, "label");
        if (label) buttons.push(`- ${label}`);
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
        return this.picker(props);
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
  const converter = new Converter(lang, state, options.plain === true);
  const body = converter.children([root]).trim();
  if (!body) return undefined;
  return converter.controls ? `${body}\n\n${CONTROL_NOTE[lang]}` : body;
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
  if (!markdown.toLowerCase().includes(INTELLIGENT_UI_FENCE_LANGUAGE)) {
    return markdown;
  }
  const out: string[] = [];
  let fence: (OpenFence & { openui: boolean; body: string[] }) | undefined;
  const flush = (body: string[]) => {
    out.push(
      "",
      interfaceBlockMarkdown(body.join("\n"), lang, options) ??
        OPENUI_PLACEHOLDER[lang],
      "",
    );
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      const closes = closesFence(line, fence);
      if (fence.openui) {
        if (closes) {
          flush(fence.body);
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
  if (fence?.openui) flush(fence.body);
  return out.join("\n");
}
