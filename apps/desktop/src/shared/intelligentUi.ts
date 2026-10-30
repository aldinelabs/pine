import {
  createLibrary,
  defineComponent,
  markReactive,
  tagSchemaId,
  type DefinedComponent,
  type Library,
} from "@openuidev/lang-core";
import { z } from "zod";

/**
 * Intelligent UI: the agent answers with interactive blocks written in
 * OpenUI Lang inside a fenced code block, and the renderer draws them with
 * Pine's own shadcn-vue components. This module holds only the framework-free
 * part (schemas and the prompt), so the main process can build the system
 * prompt without loading Vue.
 */

/** Fence info string that marks an OpenUI Lang block in assistant markdown. */
export const INTELLIGENT_UI_FENCE_LANGUAGE = "openui" as const;

/** Prop that a `$variable` binds two-way. Printed as `$binding<type>`. */
function binding<T extends z.ZodType>(schema: T): T {
  markReactive(schema);
  return schema;
}

/** Children slot: any component, or a list of them (from @Each). */
const node = z.any();
tagSchemaId(node, "Node");
const children = z.array(node);

/** An Action([...]) expression or a single @step. */
const action = z.any();
tagSchemaId(action, "ActionExpression");

const options = z.array(z.string());
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const datum = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export const intelligentUiSchemas = {
  Stack: z.object({
    children,
    direction: z.enum(["column", "row"]).optional(),
    gap: z.enum(["none", "sm", "md", "lg"]).optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    justify: z.enum(["start", "center", "end", "between"]).optional(),
    wrap: z.boolean().optional(),
  }),
  Grid: z.object({
    children,
    columns: z.number().int().min(1).max(4).optional(),
  }),
  Card: z.object({
    children,
    title: z.string().optional(),
    description: z.string().optional(),
  }),
  Tabs: z.object({ tabs: z.array(node) }),
  Tab: z.object({ label: z.string(), children }),
  Separator: z.object({}),
  Heading: z.object({
    text: z.string(),
    level: z.number().int().min(1).max(3).optional(),
  }),
  Text: z.object({
    text: z.string(),
    tone: z
      .enum(["default", "muted", "success", "warning", "danger"])
      .optional(),
    size: z.enum(["sm", "md"]).optional(),
    weight: z.enum(["normal", "medium", "semibold"]).optional(),
  }),
  Markdown: z.object({ source: z.string() }),
  List: z.object({
    items: z.array(z.string()),
    ordered: z.boolean().optional(),
  }),
  Badge: z.object({
    text: z.string(),
    variant: z
      .enum(["default", "secondary", "outline", "destructive"])
      .optional(),
  }),
  Stat: z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    caption: z.string().optional(),
    trend: z.enum(["up", "down", "flat"]).optional(),
  }),
  Callout: z.object({
    text: z.string(),
    title: z.string().optional(),
    tone: z.enum(["info", "success", "warning", "danger"]).optional(),
  }),
  Button: z.object({
    label: z.string(),
    action: action.optional(),
    variant: z.enum(["default", "secondary", "outline", "ghost"]).optional(),
    disabled: z.boolean().optional(),
  }),
  Input: z.object({
    value: binding(z.string()),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    type: z.enum(["text", "number"]).optional(),
  }),
  Textarea: z.object({
    value: binding(z.string()),
    label: z.string().optional(),
    placeholder: z.string().optional(),
  }),
  Select: z.object({
    value: binding(z.string()),
    options,
    label: z.string().optional(),
    placeholder: z.string().optional(),
  }),
  Slider: z.object({
    value: binding(z.number()),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    label: z.string().optional(),
  }),
  Switch: z.object({
    value: binding(z.boolean()),
    label: z.string(),
  }),
  Checkbox: z.object({
    value: binding(z.boolean()),
    label: z.string(),
    description: z.string().optional(),
  }),
  RadioGroup: z.object({
    value: binding(z.string()),
    options,
    label: z.string().optional(),
  }),
  SegmentedControl: z.object({
    value: binding(z.string()),
    options,
  }),
  Table: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(cell)),
    caption: z.string().optional(),
  }),
  Progress: z.object({
    value: z.number(),
    label: z.string().optional(),
  }),
  Chart: z.object({
    type: z.enum(["bar", "line", "area", "donut"]),
    data: z.array(datum),
    x: z.string(),
    series: z.array(z.string()),
    title: z.string().optional(),
  }),
} as const;

export type IntelligentUiComponentName = keyof typeof intelligentUiSchemas;

export type IntelligentUiProps<N extends IntelligentUiComponentName> = z.infer<
  (typeof intelligentUiSchemas)[N]
>;

const descriptions: Record<IntelligentUiComponentName, string> = {
  Stack:
    "Flex layout, a column by default. Use as the root. Leave gap unset on the root; set it on rows.",
  Grid: "Equal columns that collapse to fewer on narrow widths.",
  Card: "Bordered group with an optional title and description.",
  Tabs: "Switches between Tab panels.",
  Tab: "One panel of Tabs.",
  Separator: "Thin divider line.",
  Heading: "Heading; level 1 is the largest. Use level 2 or 3 inside a Card.",
  Text: "Paragraph of plain text.",
  Markdown:
    "Rich text with **bold**, lists, links and `code`. Prefer Text for short lines.",
  List: "Bulleted or numbered list of short strings.",
  Badge: "Short label for a quick fact or status.",
  Stat: "Key number with a label, for KPIs and totals.",
  Callout: "Highlighted note, tip or warning.",
  Button:
    "Runs its action on click. Without an action it sends its label to the assistant.",
  Input: "Single-line text field.",
  Textarea: "Multi-line text field.",
  Select: "Dropdown that picks one option.",
  Slider: "Picks a number in a range.",
  Switch: "On/off toggle for a setting.",
  Checkbox: "Tickable item; use for checklists.",
  RadioGroup: "Picks one option from a short visible list.",
  SegmentedControl:
    "Compact one-of-few picker that filters or switches a view.",
  Table: "Rows and columns of plain values.",
  Progress: "Bar from 0 to 100.",
  Chart:
    "Chart over a list of objects: x names the category key, series the numeric keys. Donut uses the first series.",
};

const componentGroups = [
  {
    name: "Layout",
    components: ["Stack", "Grid", "Card", "Tabs", "Tab", "Separator"],
  },
  {
    name: "Content",
    components: [
      "Heading",
      "Text",
      "Markdown",
      "List",
      "Badge",
      "Stat",
      "Callout",
    ],
  },
  {
    name: "Inputs",
    components: [
      "Button",
      "Input",
      "Textarea",
      "Select",
      "Slider",
      "Switch",
      "Checkbox",
      "RadioGroup",
      "SegmentedControl",
    ],
    notes: [
      "- An input's first argument is its value, a $variable that other statements read.",
      "- Every input changes something shown in the block, or feeds a Button whose @ToAssistant message continues the conversation. No dead inputs.",
    ],
  },
  { name: "Data", components: ["Table", "Progress", "Chart"] },
];

/** Stand-in renderer for prompt generation, where nothing renders. */
const NO_RENDERER = { name: "IntelligentUiPromptOnly" };

/**
 * Build the library. The renderer passes its Vue components; the main process
 * omits them and only uses the result for prompts and schemas.
 */
export function createIntelligentUiLibrary<C>(
  renderers?: Record<IntelligentUiComponentName, C>,
): Library<C> {
  const components = (
    Object.keys(intelligentUiSchemas) as IntelligentUiComponentName[]
  ).map((name): DefinedComponent<z.ZodObject, C> =>
    defineComponent({
      name,
      props: intelligentUiSchemas[name] as z.ZodObject,
      description: descriptions[name],
      component: renderers?.[name] ?? (NO_RENDERER as C),
    }),
  );
  return createLibrary<C>({ root: "Stack", components, componentGroups });
}

const exampleChecklist = `root = Card([progress, items, ask], "Weekend packing", "Tick items as you pack.")
$tent = false
$stove = false
$water = false
progress = Progress(((($tent ? 1 : 0) + ($stove ? 1 : 0) + ($water ? 1 : 0)) / 3) * 100, "Packed")
items = Stack([Checkbox($tent, "Tent"), Checkbox($stove, "Camp stove"), Checkbox($water, "Water filter", "Lighter than carrying water")], "column", "sm")
ask = Button("Suggest what I'm missing", @ToAssistant("What else should I pack for a weekend camping trip?"), "outline")`;

const exampleCalculator = `root = Card([inputs, result], "Monthly savings")
$monthly = 300
$months = 24
inputs = Stack([Slider($monthly, 50, 2000, 50, "Saved per month"), Slider($months, 6, 60, 6, "Months")], "column", "md")
result = Grid([Stat("Total saved", "$" + $monthly * $months), Stat("Per year", "$" + $monthly * 12)], 2)`;

const exampleCompare = `root = Stack([intro, view, shown])
$view = "Chart"
intro = Text("Quarterly revenue by product line.", "muted")
view = SegmentedControl($view, ["Chart", "Table"])
chart = Chart("bar", data, "quarter", ["cloud", "devices"])
shown = $view == "Chart" ? chart : Table(["Quarter", "Cloud", "Devices"], [["Q1", 120, 80], ["Q2", 150, 95], ["Q3", 170, 90]])
data = [{quarter: "Q1", cloud: 120, devices: 80}, {quarter: "Q2", cloud: 150, devices: 95}, {quarter: "Q3", cloud: 170, devices: 90}]`;

const rules = [
  "Use @ToAssistant only for what the block cannot compute itself, such as a follow-up request. Its message is short and first person, written as the user would type it.",
  "Keep inputs and lists in $variables, compute what is shown from them with expressions, and change them with @Set and @Reset, so the block works without another message.",
  "$variable defaults are literals (numbers, strings, booleans, lists, objects), never expressions.",
  "Keep blocks focused: one Heading or Card title, short Text, then the interactive or visual part. Include everything the task needs (all options, rows or steps) rather than trimming it to a token example. Do not repeat the block's content in the surrounding prose.",
  "Write the text in the user's language.",
];

const PREAMBLE = `## Interactive blocks

Pine renders interactive blocks inside your replies. Write one in a fenced code block tagged \`${INTELLIGENT_UI_FENCE_LANGUAGE}\`, containing OpenUI Lang as described below. Ordinary Markdown text before and after the block is shown as usual.

The user has enabled rich interface elements. Use a block when it makes the answer easier to read, scan, explore or act on than Markdown alone. A block can be purely visual; interaction is not required.

- Presentation: key figures as Stats, statuses as Badges, warnings and takeaways as Callouts, parallel items as Cards in a Grid, structured data as a Table or Chart, long answers split into Tabs or titled Cards.
- Interaction: options the user picks from, numbers that depend on inputs, checklists, filters or view switches, and next steps the user can take with one click. When the user needs to choose between options, Buttons or a picker can replace a numbered list.

Typical fits are comparisons and trade-offs, summaries of results or status, plans, step-by-step walkthroughs, and data you would otherwise list, tabulate or chart. Do not use a block just to reproduce a Markdown table: when the block would be nothing but a static Table of plain text cells, a Markdown table shows the same thing, so write that instead. Use a Table inside a block when it is part of something more, such as next to Stats or a Chart, behind a filter or view switch, or driven by inputs. When a block holds the structured content, keep the surrounding prose to a short lead-in or conclusion. Plain Markdown suits casual chat, short answers and replies that are a single flowing explanation; after coding work, a block can summarize what changed or offer next steps. Never put code the user should read or copy in a block; use a normal code fence for that. Usually one block per reply; use a second only when the reply has two separate parts that each benefit from one.

Example reply:
Here is a quick savings calculator.
\`\`\`${INTELLIGENT_UI_FENCE_LANGUAGE}
root = Card([amount], "Savings")
$monthly = 300
amount = Slider($monthly, 50, 2000, 50, "Saved per month")
\`\`\`
Move the slider to compare plans.

The rest of this section describes the OpenUI Lang syntax inside the fence.`;

let cachedSystemPrompt: string | undefined;

/**
 * The system prompt section that teaches the agent to write blocks. The
 * library's own prompt assumes the whole reply is OpenUI Lang, so Pine's
 * preamble replaces its opening line and its headings nest under ours.
 */
export function intelligentUiSystemPrompt(): string {
  if (cachedSystemPrompt !== undefined) return cachedSystemPrompt;
  const generated = createIntelligentUiLibrary().prompt({
    preamble: "",
    additionalRules: rules,
    examples: [exampleChecklist, exampleCalculator, exampleCompare],
    bindings: true,
  });
  const nested = generated
    .trim()
    .replace(/^## /gm, "### ")
    // The built-in function examples assume a Col component; ours is Stack.
    .replaceAll('Col("Actions", ', "Stack(");
  cachedSystemPrompt = `${PREAMBLE}\n\n${nested}`;
  return cachedSystemPrompt;
}
