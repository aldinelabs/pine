import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { UI_REPORT_PROGRESS_TOOL_NAME } from "../shared/agent";

// The acknowledgement is the last thing the model reads before its next step,
// so it repeats the rule a misused report breaks: the turn still ends with a
// normal reply, and that reply does not restate the report.
const ACK_TAIL =
  "Continue working now; when the work is done, end with a normal reply that builds on this report instead of repeating it.";
export const REPORT_PROGRESS_ACK = `Shown to the user as reply text. ${ACK_TAIL}`;
/** Soft limit: longer reports are still shown, the result asks for brevity. */
export const REPORT_PROGRESS_LONG_CONTENT_CHARS = 4_000;
export const REPORT_PROGRESS_LONG_ACK = `Shown to the user as reply text. That report was long: keep interim reports brief and save the full write-up for the final reply. ${ACK_TAIL}`;

// Pine passes its own system prompt, so pi does not render promptSnippet or
// promptGuidelines: the description has to carry the guidance by itself.
const DESCRIPTION = [
  "Show the user an interim answer while you keep working. Pine displays `content` in the conversation exactly like your normal reply text (Markdown, including LaTeX math), not as a tool call. The tool does nothing else: it has no side effects, needs no approval, and its result only confirms that the text was shown.",
  "",
  'Before slow work (searching or fetching the web, reading or searching files, running commands, long reasoning), post a brief preliminary answer from what you already know, then continue and finish with the refined or final answer. If your knowledge or your reasoning so far already points to a likely answer, report it first, clearly marked as preliminary and still to be verified, instead of keeping it to yourself until the slow work is done. Example: asked who received the latest Nobel Peace Prize, report the most recent laureate you know of and say you are checking for a newer award, then search. State what you know "as of" your knowledge; do not guess today\'s date.',
  "",
  "Exception: skip the preliminary answer when the question is strongly time-sensitive, so that an unverified answer would almost certainly be wrong or misleading: the latest software versions or releases, current events and news, prices and exchange rates, scores, weather or other live data. Look those up first. Facts that change only occasionally, such as an annual award, are not this exception.",
  "",
  "For multi-part work (an exam or worksheet with many questions, a list of independent items to answer, look up or fix), report each part as soon as it is solved instead of waiting for all of them. Parts solved in the same step go into one report.",
  "",
  "- Lead with substance: the preliminary answer, conclusion, finding or solved part, plus what is still uncertain and what you will verify next. Say so when it is preliminary.",
  "- Call it early, before the first slow step. You may issue it together with other tool calls in the same step.",
  "- Reply text you write before a tool call is shown to the user as well. Put an interim answer in one place, that text or this tool, never both in the same step.",
  "- Report again only when you have something new for the user: a conclusion that changed, another solved part, or a result they would want before you finish. Do not narrate every step, tool call or plan item.",
  "- Skip it when you can give the complete answer right away without slow work; answer directly.",
  "- It never replaces the final answer. Always end the turn with a normal reply. The user has already read your reports, so the final reply confirms, corrects or extends them instead of repeating them word for word; after per-part reports, it covers the remaining parts and a short wrap-up.",
  "- Write in the language the user is using, and keep each report short: a few sentences to a few short paragraphs.",
  "- Each report is rendered on its own, separately from the final reply. If a report cites web sources with footnote markers such as [^1], define those footnotes at the end of that same report, and define them again in the final reply if it cites them too.",
  "",
  "After the call returns, continue the work immediately. Do not stop and do not wait for the user to respond.",
].join("\n");

const reportProgressParams = Type.Object({
  // No maxLength: the text is already on screen when the arguments are
  // validated, so rejecting it would report a failure the user never saw.
  content: Type.String({
    minLength: 1,
    description:
      "Markdown shown to the user as reply text. Lead with the preliminary answer, finding or solved part, mark what is not yet verified, and keep it short.",
  }),
});

type ReportProgressParams = Static<typeof reportProgressParams>;

/**
 * pi coerces scalars to strings when it validates, but the transcript shows
 * `content` only when the call carries a string. Dropping any other value
 * makes validation fail, so the model is never told that something the user
 * cannot see was shown.
 */
function withoutNonStringContent(args: unknown): ReportProgressParams {
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return args as ReportProgressParams;
  const { content, ...rest } = args as Record<string, unknown>;
  return (
    typeof content === "string" || content === undefined ? args : rest
  ) as ReportProgressParams;
}

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
    promptSnippet: `Use ${UI_REPORT_PROGRESS_TOOL_NAME} to post a preliminary answer, or each solved part, before slow work, then keep working`,
    promptGuidelines: [
      `Before slow work (search, reading files, running commands), call ${UI_REPORT_PROGRESS_TOOL_NAME} with what you already know, marked as preliminary, unless the question is strongly time-sensitive (latest versions, news, prices, live data)`,
      `For multi-part work, call ${UI_REPORT_PROGRESS_TOOL_NAME} as each part is solved; otherwise call it again only when the conclusion changes; never narrate steps or use it when you can answer completely right away`,
      `${UI_REPORT_PROGRESS_TOOL_NAME} never replaces the final answer: always end the turn with a normal reply that builds on what you reported`,
    ],
    parameters: reportProgressParams,
    prepareArguments: withoutNonStringContent,
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
