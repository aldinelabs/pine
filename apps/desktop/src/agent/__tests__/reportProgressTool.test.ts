import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  createReportProgressToolDefinition,
  REPORT_PROGRESS_ACK,
  REPORT_PROGRESS_LONG_ACK,
  REPORT_PROGRESS_LONG_CONTENT_CHARS,
} from "../reportProgressTool";

function run(content: string) {
  return createReportProgressToolDefinition().execute(
    "id",
    { content },
    undefined,
    undefined,
    undefined as never,
  );
}

/** What pi does with a call's arguments before `execute` runs. */
function validate(args: unknown) {
  const tool = createReportProgressToolDefinition();
  return validateToolArguments(tool, {
    type: "toolCall",
    id: "id",
    name: tool.name,
    arguments: tool.prepareArguments?.(args) as ToolCall["arguments"],
  });
}

describe("createReportProgressToolDefinition", () => {
  // Reply text before a tool call is already on screen; a model that also
  // reports it would show the user the same passage twice in a row.
  it("tells the model not to repeat its own preamble in a report", () => {
    const { description } = createReportProgressToolDefinition();
    expect(description).toMatch(
      /Reply text you write before a tool call is shown to the user as well/,
    );
    expect(description).toMatch(/never both in the same step/);
  });

  // Knowledge the model already has is worth showing before a slow lookup.
  it("asks for a preliminary answer before slow work", () => {
    const { description } = createReportProgressToolDefinition();
    expect(description).toMatch(/Before slow work/);
    expect(description).toMatch(
      /post a brief preliminary answer from what you already know/,
    );
    expect(description).toMatch(
      /clearly marked as preliminary and still to be verified/,
    );
    expect(description).toMatch(/latest Nobel Peace Prize/);
  });

  it("keeps strongly time-sensitive questions as the exception", () => {
    const { description } = createReportProgressToolDefinition();
    expect(description).toMatch(/strongly time-sensitive/);
    expect(description).toMatch(/almost certainly be wrong or misleading/);
    expect(description).toMatch(/latest software versions/);
    expect(description).toMatch(/current events and news/);
    expect(description).toMatch(/prices/);
    expect(description).toMatch(/live data/);
    expect(description).toMatch(/Look those up first/);
  });

  it("reports multi-part work part by part", () => {
    const { description } = createReportProgressToolDefinition();
    expect(description).toMatch(/report each part as soon as it is solved/);
    expect(description).toMatch(/exam or worksheet/);
  });

  it("still avoids duplicates and noise", () => {
    const { description } = createReportProgressToolDefinition();
    expect(description).toMatch(/never both in the same step/);
    expect(description).toMatch(/instead of repeating them word for word/);
    expect(description).toMatch(
      /Skip it when you can give the complete answer right away/,
    );
  });

  // Citation cards resolve within one text block, and each report is its own
  // block: a footnote defined only in the final reply would dangle here.
  it("tells the model to define a report's footnotes in that report", () => {
    const { description } = createReportProgressToolDefinition();
    expect(description).toMatch(/Each report is rendered on its own/);
    expect(description).toMatch(
      /define those footnotes at the end of that same report/,
    );
    expect(description).toMatch(
      /define them again in the final reply if it cites them too/,
    );
  });

  // The acknowledgement is the last thing the model reads before it goes on.
  it("acknowledges with the end-of-turn rule", () => {
    for (const ack of [REPORT_PROGRESS_ACK, REPORT_PROGRESS_LONG_ACK]) {
      expect(ack).toMatch(/^Shown to the user as reply text\./);
      expect(ack).toMatch(/Continue working now/);
      expect(ack).toMatch(
        /end with a normal reply that builds on this report instead of repeating it\.$/,
      );
    }
    expect(REPORT_PROGRESS_LONG_ACK).toMatch(/keep interim reports brief/);
    expect(REPORT_PROGRESS_ACK).not.toMatch(/keep interim reports brief/);
  });

  it("requires a non-empty string content and sets no upper bound", () => {
    const schema = createReportProgressToolDefinition().parameters as {
      required?: string[];
      properties: { content: Record<string, unknown> };
    };
    expect(schema.required).toEqual(["content"]);
    expect(schema.properties.content.type).toBe("string");
    expect(schema.properties.content.minLength).toBe(1);
    expect(schema.properties.content.maxLength).toBeUndefined();
  });

  it("accepts string content as it is", () => {
    expect(validate({ content: "Probably **X**." })).toEqual({
      content: "Probably **X**.",
    });
  });

  // pi coerces scalars to strings, but the transcript shows string content
  // only: an accepted null or number would be acknowledged and never shown.
  it("rejects content that is not a string", () => {
    for (const content of [null, 123, true, ["a"], { text: "a" }])
      expect(() => validate({ content })).toThrow(/content/);
    expect(() => validate({})).toThrow(/content/);
    expect(() => validate(null)).toThrow();
  });

  it("acknowledges a report and tells the model to continue", async () => {
    const result = await run("Preliminary: **yes**, checking the workspace.");
    expect(result.content).toEqual([
      { type: "text", text: REPORT_PROGRESS_ACK },
    ]);
    expect(result.details).toEqual({});
  });

  it("asks for shorter reports above the soft limit without rejecting", async () => {
    const atLimit = await run("a".repeat(REPORT_PROGRESS_LONG_CONTENT_CHARS));
    expect(atLimit.content).toEqual([
      { type: "text", text: REPORT_PROGRESS_ACK },
    ]);
    const over = await run("a".repeat(REPORT_PROGRESS_LONG_CONTENT_CHARS + 1));
    expect(over.content).toEqual([
      { type: "text", text: REPORT_PROGRESS_LONG_ACK },
    ]);
    expect(over.details).toEqual({});
  });

  it("rejects whitespace-only content", () => {
    expect(() => run(" \n\t ")).toThrow(/content is empty/);
  });
});
