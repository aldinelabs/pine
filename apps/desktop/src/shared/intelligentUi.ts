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

/** A string, or `{value, label, description?}` when the shown text differs. */
const option = z.union([
  z.string(),
  z.object({
    value: z.string(),
    label: z.string(),
    description: z.string().optional(),
  }),
]);
const options = z.array(option);
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const datum = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
/** Text, or a list mixing strings and inline components such as Icon or Badge. */
const richText = z.union([z.string(), children]);
/** Plain text, or components. */
const slot = z.union([z.string(), children]);

/** A field's checks inside a Form: `{required: true, min: 1, email: true}`. */
const rules = z.object({
  required: z.boolean().optional(),
  email: z.boolean().optional(),
  url: z.boolean().optional(),
  numeric: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
});
tagSchemaId(rules, "Rules");

const gap = z.enum(["none", "sm", "md", "lg"]);
const align = z.enum(["start", "center", "end", "stretch"]);
const justify = z.enum(["start", "center", "end", "between"]);
const tone = z.enum(["default", "muted", "success", "warning", "danger"]);
/** Semantic colours shared by Badge and Icon. */
const color = z.enum([
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
  "purple",
  "pink",
]);

const ListItem = z.object({
  title: z.string(),
  description: z.string().optional(),
  marker: z.string().optional(),
  children: children.optional(),
});
const AccordionItem = z.object({ title: z.string(), children });
const Step = z.object({
  title: z.string(),
  description: z.string().optional(),
});

export const intelligentUiSchemas = {
  Stack: z.object({
    children,
    direction: z.enum(["column", "row"]).optional(),
    gap: gap.optional(),
    align: align.optional(),
    justify: justify.optional(),
    wrap: z.boolean().optional(),
  }),
  Row: z.object({
    children,
    gap: gap.optional(),
    align: align.optional(),
    justify: justify.optional(),
    wrap: z.boolean().optional(),
  }),
  Box: z.object({
    children,
    padding: gap.optional(),
    background: z
      .enum(["none", "muted", "info", "success", "warning", "danger"])
      .optional(),
    border: z.boolean().optional(),
    radius: z.enum(["none", "sm", "md", "lg", "full"]).optional(),
    direction: z.enum(["column", "row"]).optional(),
    gap: gap.optional(),
    align: align.optional(),
  }),
  Spacer: z.object({}),
  Grid: z.object({
    children,
    columns: z.number().int().min(1).max(12).optional(),
    minChildWidth: z.number().optional(),
  }),
  Card: z.object({
    children,
    title: z.string().optional(),
    description: z.string().optional(),
    variant: z.enum(["outline", "soft"]).optional(),
  }),
  Tabs: z.object({ tabs: z.array(node) }),
  Tab: z.object({ label: z.string(), children }),
  Accordion: z.object({
    items: z.array(AccordionItem),
    multiple: z.boolean().optional(),
  }),
  AccordionItem,
  Carousel: z.object({
    children,
    itemWidth: z.number().optional(),
  }),
  Popover: z.object({ trigger: slot, content: slot }),
  Separator: z.object({}),
  Heading: z.object({
    text: z.string(),
    level: z.number().int().min(1).max(3).optional(),
    size: z.enum(["sm", "md", "lg", "xl", "2xl", "3xl"]).optional(),
  }),
  Text: z.object({
    text: richText,
    tone: tone.optional(),
    size: z.enum(["xs", "sm", "md", "lg"]).optional(),
    weight: z.enum(["normal", "medium", "semibold"]).optional(),
    italic: z.boolean().optional(),
    lineThrough: z.boolean().optional(),
    maxLines: z.number().int().min(1).optional(),
  }),
  Caption: z.object({ text: z.string(), tone: tone.optional() }),
  Label: z.object({ text: z.string() }),
  Markdown: z.object({ source: z.string() }),
  List: z.object({
    items: z.array(z.union([z.string(), ListItem])),
    ordered: z.boolean().optional(),
    timeline: z.boolean().optional(),
  }),
  ListItem,
  Link: z.object({ text: z.string(), url: z.string() }),
  Quote: z.object({ text: z.string(), cite: z.string().optional() }),
  Code: z.object({ code: z.string(), language: z.string().optional() }),
  Math: z.object({ tex: z.string(), inline: z.boolean().optional() }),
  Badge: z.object({
    text: z.string(),
    variant: z
      .enum(["default", "secondary", "outline", "destructive"])
      .optional(),
    color: color.optional(),
    icon: z.string().optional(),
  }),
  Icon: z.object({
    name: z.string(),
    size: z.enum(["sm", "md", "lg", "xl"]).optional(),
    color: color.optional(),
  }),
  Image: z.object({
    src: z.string(),
    alt: z.string(),
    aspectRatio: z.number().optional(),
    fit: z.enum(["cover", "contain"]).optional(),
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
    variant: z
      .enum(["default", "secondary", "outline", "ghost", "soft"])
      .optional(),
    disabled: z.boolean().optional(),
    color: z.enum(["primary", "danger", "success"]).optional(),
    size: z.enum(["sm", "md", "lg"]).optional(),
    icon: z.string().optional(),
    block: z.boolean().optional(),
  }),
  IconButton: z.object({
    icon: z.string(),
    action: action.optional(),
    label: z.string().optional(),
    variant: z.enum(["outline", "ghost", "default"]).optional(),
  }),
  Pressable: z.object({
    children,
    action: action.optional(),
    selected: z.boolean().optional(),
  }),
  Form: z.object({ children }),
  Input: z.object({
    value: binding(z.union([z.string(), z.number()])),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    type: z.enum(["text", "number"]).optional(),
    rules: rules.optional(),
  }),
  Textarea: z.object({
    value: binding(z.string()),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    rules: rules.optional(),
  }),
  Select: z.object({
    value: binding(z.string()),
    options,
    label: z.string().optional(),
    placeholder: z.string().optional(),
    rules: rules.optional(),
  }),
  DatePicker: z.object({
    value: binding(z.string()),
    label: z.string().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
    rules: rules.optional(),
  }),
  Slider: z.object({
    value: binding(z.number()),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    label: z.string().optional(),
    unit: z.string().optional(),
    marks: z
      .array(z.object({ value: z.number(), label: z.string() }))
      .optional(),
  }),
  Switch: z.object({
    value: binding(z.boolean()),
    label: z.string(),
  }),
  Checkbox: z.object({
    value: binding(z.boolean()),
    label: z.string(),
    description: z.string().optional(),
    rules: rules.optional(),
  }),
  RadioGroup: z.object({
    value: binding(z.string()),
    options,
    label: z.string().optional(),
    variant: z.enum(["list", "pills", "cards"]).optional(),
    rules: rules.optional(),
  }),
  SegmentedControl: z.object({
    value: binding(z.string()),
    options: z.array(z.string()),
  }),
  Timer: z.object({
    seconds: binding(z.number()),
    label: z.string().optional(),
  }),
  Table: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([cell, node]))),
    caption: z.string().optional(),
  }),
  Progress: z.object({
    value: z.number(),
    label: z.string().optional(),
  }),
  Chart: z.object({
    type: z.enum(["bar", "line", "area", "donut", "pie", "scatter"]),
    data: z.array(datum),
    x: z.string().optional(),
    series: z.array(z.string()).optional(),
    title: z.string().optional(),
    stacked: z.boolean().optional(),
    format: z.enum(["number", "percent"]).optional(),
    height: z.number().optional(),
  }),
  Steps: z.object({
    items: z.array(Step),
    current: z.number().int().min(1).optional(),
  }),
  Step,
  Flashcard: z.object({
    front: slot,
    back: slot,
    hint: z.string().optional(),
  }),
  Celebration: z.object({ when: z.boolean() }),
} as const;

export type IntelligentUiComponentName = keyof typeof intelligentUiSchemas;

export type IntelligentUiProps<N extends IntelligentUiComponentName> = z.infer<
  (typeof intelligentUiSchemas)[N]
>;

export type IntelligentUiRules = z.infer<typeof rules>;

/** An option as the pickers use it: a string value and the text shown. */
export interface IntelligentUiOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Options as written are loose: a string, a number, or an object with only a
 * label. Each becomes a string value and label; one with neither is dropped.
 */
export function intelligentUiOptions(raw: unknown): IntelligentUiOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown): IntelligentUiOption[] => {
    if (item === null || item === undefined) return [];
    if (typeof item === "string" || typeof item === "number")
      return item === "" ? [] : [{ value: String(item), label: String(item) }];
    if (typeof item !== "object") return [];
    const { value, label, description } = item as Record<string, unknown>;
    const scalar = (part: unknown) =>
      typeof part === "string" || typeof part === "number"
        ? String(part)
        : undefined;
    const text = scalar(label) ?? scalar(value);
    if (!text) return [];
    return [
      {
        value: scalar(value) ?? text,
        label: text,
        ...(typeof description === "string" && { description }),
      },
    ];
  });
}

const descriptions: Record<IntelligentUiComponentName, string> = {
  Stack:
    "Flex layout, a column by default. Use as the root. Leave gap unset on the root; set it on rows.",
  Row: "Horizontal layout, items vertically centered; a Spacer pushes items apart.",
  Box: "Container with optional padding, fill, border and radius, for custom tiles.",
  Spacer: "Fills the free space in a Row.",
  Grid: "Equal columns (1 to 12) that collapse on narrow widths; minChildWidth (px) sets when.",
  Card: "Bordered group with an optional title and description; soft is a filled panel for summaries.",
  Tabs: "Switches between Tab panels.",
  Tab: "One panel of Tabs.",
  Accordion: "Collapsible sections for FAQs or optional details.",
  AccordionItem: "One section of an Accordion.",
  Carousel:
    "Horizontal row that scrolls, each child an item itemWidth px wide (default 240): photos, cards, flashcards.",
  Popover:
    "Shows content in a small panel when the trigger is clicked: a definition, a source. The trigger is text or an Icon, never a Button.",
  Separator: "Thin divider line.",
  Heading:
    "Heading; level 1 is the largest. Use level 2 or 3 inside a Card. size overrides the look, e.g. 2xl for a big number.",
  Text: 'Paragraph of plain text, or a list mixing strings and inline components: [Icon("clock", "sm"), " 25 min · ", Badge("Easy")].',
  Caption: "Small secondary text, such as a footnote or source.",
  Label: "Short label above a group of content.",
  Markdown:
    "Rich text with **bold**, lists, links and `code`. Prefer Text for short lines.",
  List: "Bulleted or numbered list of strings or ListItems; timeline joins the markers with a line, for schedules and histories.",
  ListItem:
    "List entry with a description; marker replaces the bullet, e.g. a time or an emoji.",
  Link: "Link to an http(s) URL, opened in the browser.",
  Quote: "Quotation with a side rule; cite names the source.",
  Code: "Short highlighted snippet that illustrates the block; code to copy goes in a normal fence.",
  Math: 'LaTeX formula, e.g. Math("E = mc^2"); inline true to sit in a Text list.',
  Badge: "Short label for a quick fact or status; icon is a Lucide name.",
  Icon: 'Lucide icon by kebab-case name, e.g. "map-pin"; unknown names show nothing.',
  Image:
    "Picture from a URL or file path the user or a tool gave; never invent one. aspectRatio is width / height (default 1.5).",
  Stat: "Key number with a label, for KPIs and totals.",
  Callout: "Highlighted note, tip or warning.",
  Button:
    "Runs its action on click. Without an action it sends its label to the assistant. color danger for destructive steps.",
  IconButton: "Icon-only button; label is read aloud and shown on hover.",
  Pressable:
    "Makes any content clickable, such as a tile or swatch; selected highlights it.",
  Form: "Groups fields; a Button inside that sends a message first checks every field's rules.",
  Input: "Single-line text field; a number field stores numbers.",
  Textarea: "Multi-line text field.",
  Select: "Dropdown that picks one option.",
  DatePicker: 'Date field; value, min and max are "YYYY-MM-DD".',
  Slider:
    'Picks a number in a range; unit like "%" or "kg" follows the value, marks label points on the track.',
  Switch: "On/off toggle for a setting.",
  Checkbox: "Tickable item; use for checklists.",
  RadioGroup:
    "Picks one option from a short visible list; pills for short choices, cards for options with a description.",
  SegmentedControl:
    "Compact one-of-few picker that filters or switches a view.",
  Timer:
    "Countdown the user starts and pauses; it counts the bound seconds down to 0, so other statements can react, e.g. $left == 0.",
  Table:
    "Rows and columns of values; a cell may be a component such as a Badge. Number columns align right.",
  Progress: "Bar from 0 to 100.",
  Chart:
    'Chart over a list of objects: x names the category key (a number key for scatter), series the numeric keys (default: every number key). Every series entry must be a key spelled exactly as in the data objects, never a separate display name; the legend shows these keys, so name the keys the way the reader should see them. Pie and donut use the first series; format "percent" shows their slices as shares. stacked stacks bar and area series; height is in px.',
  Steps:
    "Numbered steps of a procedure; current (1-based) marks progress, earlier steps show as done.",
  Step: "One step of Steps.",
  Flashcard:
    "Card that flips between front and back when clicked, for study and quizzes. Put several in a Carousel or Grid.",
  Celebration:
    "Bursts confetti once when its condition turns true, e.g. Celebration($score == 5) at the end of a quiz.",
};

const componentGroups = [
  {
    name: "Layout",
    components: [
      "Stack",
      "Row",
      "Box",
      "Spacer",
      "Grid",
      "Card",
      "Tabs",
      "Tab",
      "Accordion",
      "AccordionItem",
      "Carousel",
      "Popover",
      "Separator",
    ],
  },
  {
    name: "Content",
    components: [
      "Heading",
      "Text",
      "Caption",
      "Label",
      "Markdown",
      "List",
      "ListItem",
      "Link",
      "Quote",
      "Code",
      "Math",
      "Badge",
      "Icon",
      "Image",
      "Stat",
      "Callout",
    ],
  },
  {
    name: "Inputs",
    components: [
      "Button",
      "IconButton",
      "Pressable",
      "Form",
      "Input",
      "Textarea",
      "Select",
      "DatePicker",
      "Slider",
      "Switch",
      "Checkbox",
      "RadioGroup",
      "SegmentedControl",
      "Timer",
    ],
    notes: [
      "- An input's first argument is its value, a $variable that other statements read.",
      "- Every input changes something shown in the block, or feeds a Button whose @ToAssistant message continues the conversation. No dead inputs.",
      "- You cannot see what the user picked or typed unless they send it: a block's values reach you only with the message of a Button that runs @ToAssistant, which appends every $variable's current value. So whenever you need the user's choice or answer (a RadioGroup, Select, Checkbox, Input and the like), put a submit Button with @ToAssistant in the same block, and do not ask the user to just pick something. If one click should answer, use one Button per option instead of a picker.",
      "- When some answers are needed before sending, wrap the fields and the submit Button in a Form and give the fields rules. Rules is an object of required, email, url, numeric (booleans), min, max (numbers), minLength, maxLength (characters) and pattern (a regex string), e.g. {required: true, min: 1}.",
    ],
  },
  {
    name: "Data",
    components: ["Table", "Progress", "Chart", "Steps", "Step"],
  },
  { name: "Interactive", components: ["Flashcard", "Celebration"] },
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

const exampleForm = `root = Card([form], "Set up your workspace")
$name = ""
$size = ""
$plan = "pro"
form = Form([Input($name, "Workspace name", "Acme", "text", {required: true}), size, plan, Button("Continue", @ToAssistant("Set up my workspace"))])
size = RadioGroup($size, ["1-5", "6-20", "21+"], "Team size", "pills", {required: true})
plan = RadioGroup($plan, [{value: "free", label: "Free", description: "Up to 3 projects"}, {value: "pro", label: "Pro", description: "Unlimited projects"}], "Plan", "cards")`;

const exampleCompare = `root = Stack([intro, view, shown])
$view = "Chart"
intro = Text("Quarterly revenue by product line.", "muted")
view = SegmentedControl($view, ["Chart", "Table"])
chart = Chart("bar", data, "quarter", ["cloud", "devices"])
shown = $view == "Chart" ? chart : Table(["Quarter", "Cloud", "Devices"], [["Q1", 120, 80], ["Q2", 150, 95], ["Q3", 170, 90]])
data = [{quarter: "Q1", cloud: 120, devices: 80}, {quarter: "Q2", cloud: 150, devices: 95}, {quarter: "Q3", cloud: 170, devices: 90}]`;

const promptRules = [
  'A block that collects a choice or answer from the user always ends with a Button that sends it with @ToAssistant (for example "Continue" or "Confirm"); without it the answer never reaches you and the user has no way to submit.',
  "Use @ToAssistant only for what the block cannot compute itself, such as a follow-up request. Its message is short and first person, written as the user would type it.",
  "Keep inputs and lists in $variables, compute what is shown from them with expressions, and change them with @Set and @Reset, so the block works without another message.",
  "$variable defaults are literals (numbers, strings, booleans, lists, objects), never expressions.",
  "Keep blocks focused: one Heading or Card title, short Text, then the interactive or visual part. Include everything the task needs (all options, rows or steps) rather than trimming it to a token example. Do not repeat the block's content in the surrounding prose.",
  "Write the text in the user's language.",
  'A Chart reads each series straight from its data keys: Chart("bar", rows, "species", ["Brain", "Cortex"]) needs rows like {species: "Human", Brain: 86, Cortex: 16}. Series names that are not keys of the rows draw as empty bars at 0. To show labels in the user\'s language, use them as the keys themselves, and quote every key that is not a plain ASCII name: {species: "人", "全脑": 86, "皮层": 16} with series ["全脑", "皮层"]. An unquoted non-ASCII key is not read.',
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
    additionalRules: promptRules,
    examples: [
      exampleChecklist,
      exampleCalculator,
      exampleForm,
      exampleCompare,
    ],
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
