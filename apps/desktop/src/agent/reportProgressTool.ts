import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { UI_REPORT_PROGRESS_TOOL_NAME } from "../shared/agent";

export const REPORT_PROGRESS_ACK = "Shown to the user. Continue working.";
/** Soft limit: longer reports are still shown, the result asks for brevity. */
export const REPORT_PROGRESS_LONG_CONTENT_CHARS = 4_000;
export const REPORT_PROGRESS_LONG_ACK =
  "Shown to the user. That report was long: keep interim reports brief and save the full write-up for the final answer. Continue working.";

// Pine passes its own system prompt, so pi does not render promptSnippet or
// promptGuidelines: the description has to carry the guidance by itself.
const DESCRIPTION = [
  "Show the user an interim answer while you keep working. Pine displays `content` in the conversation exactly like your normal reply text (Markdown, including LaTeX math), not as a tool call. The tool does nothing else: it has no side effects, needs no approval, and its result only confirms that the text was shown.",
  "",
  "Use it when a request is complex or will take a while (long reasoning, several tool calls, research across files or the web) and you already have something useful to say: think briefly, report a preliminary answer, then continue working in the same turn. Typical case: a question you can answer from your own knowledge while the workspace may hold more specific context. Report the answer you already know and what you are going to check, then read the workspace and refine it. A person does the same: a rough answer first, then the investigation.",
  "",
  "- Lead with substance: the preliminary answer, conclusion or finding, plus what is still uncertain and what you will verify next. Say so when it is preliminary.",
  "- Call it early, before long reasoning or the first slow step. You may issue it together with other tool calls in the same step.",
  "- Report again only when something material changes: the conclusion turns out to be different, or you reach a result the user would want before you finish. Do not narrate every step, tool call or plan item.",
  "- Do not use it for simple questions or short tasks; answer those directly.",
  "- It never replaces the final answer. Always end the turn with a normal reply. The user has already read your reports, so the final reply confirms, corrects or extends them instead of repeating them word for word.",
  "- Write in the language the user is using, and keep each report short: a few sentences to a few short paragraphs.",
  "",
  "After the call returns, continue the work immediately. Do not stop and do not wait for the user to respond.",
].join("\n");

const reportProgressParams = Type.Object({
  // No maxLength: the text is already on screen when the arguments are
  // validated, so rejecting it would report a failure the user never saw.
  content: Type.String({
    minLength: 1,
    description:
      "Markdown shown to the user as reply text. Lead with the preliminary answer or finding and keep it short.",
  }),
});

type ReportProgressParams = Static<typeof reportProgressParams>;

/**
 * Lets the model show an interim answer and keep working in the same turn.
 * The transcript renders the call's `content` as reply text; running the tool
 * only acknowledges it, so it has no side effects and needs no approval.
 */
export function createReportProgressToolDefinition(): ToolDefinition {
  return defineTool({
    name: UI_REPORT_PROGRESS_TOOL_NAME,
    label: "Report Progress",
    description: DESCRIPTION,
    promptSnippet: `Use ${UI_REPORT_PROGRESS_TOOL_NAME} to give the user an interim answer on a complex or long-running request, then keep working`,
    promptGuidelines: [
      `On a complex or long-running request, call ${UI_REPORT_PROGRESS_TOOL_NAME} early with a preliminary answer, then continue investigating in the same turn`,
      `Call ${UI_REPORT_PROGRESS_TOOL_NAME} again only when the conclusion changes materially; never use it to narrate individual steps or for simple questions`,
      `${UI_REPORT_PROGRESS_TOOL_NAME} never replaces the final answer: always end the turn with a normal reply that builds on what you reported`,
    ],
    parameters: reportProgressParams,
    prepareArguments: (args) => args as ReportProgressParams,
    execute: (_toolCallId, params) => {
      if (params.content.trim() === "")
        throw new Error(
          "content is empty. Pass the Markdown to show the user, or skip this tool.",
        );
      const text =
        params.content.length > REPORT_PROGRESS_LONG_CONTENT_CHARS
          ? REPORT_PROGRESS_LONG_ACK
          : REPORT_PROGRESS_ACK;
      return Promise.resolve({
        content: [{ type: "text" as const, text }],
        details: {},
      });
    },
  }) as ToolDefinition;
}
