import { describe, expect, it } from "vitest";
import { formatSessionAsMarkdown } from "../sessionExport";

describe("formatSessionAsMarkdown", () => {
  it("keeps settings, message order, and tool payloads readable", () => {
    const markdown = formatSessionAsMarkdown({
      approvalMode: "let-me-review",
      messages: [
        {
          createdAt: "2026-09-08T12:00:00.000Z",
          id: "user-1",
          role: "user",
          blocks: [{ type: "text", text: "Read the project file." }],
        },
        {
          createdAt: "2026-09-08T12:00:01.000Z",
          id: "assistant-1",
          role: "assistant",
          blocks: [
            { type: "text", text: "I will inspect it." },
            {
              type: "toolCall",
              toolCall: {
                id: "call-1",
                name: "read",
                status: "complete",
                input: { path: "/project/src/main.ts" },
                output: { content: "export {}" },
              },
            },
          ],
        },
      ],
      models: [{ modelId: "gpt-test", providerId: "openai" }],
      summary: {
        createdAt: "2026-09-08T12:00:00.000Z",
        id: "session-1",
        messageCount: 2,
        preview: "Read the project file.",
        updatedAt: "2026-09-08T12:00:01.000Z",
      },
    });

    expect(markdown).toContain("- Approval mode: let-me-review");
    expect(markdown).toContain("- Models used:\n  - openai/gpt-test");
    expect(markdown.indexOf("Read the project file.")).toBeLessThan(
      markdown.indexOf("I will inspect it."),
    );
    expect(markdown).toContain('"path": "/project/src/main.ts"');
    expect(markdown).toContain('"content": "export {}"');
  });

  // An interim answer is a text block of its own, so text blocks now sit
  // next to each other and to tool calls and thinking within one message.
  it("keeps each text block a paragraph of its own", () => {
    const markdown = formatSessionAsMarkdown({
      approvalMode: "auto-approve",
      messages: [
        {
          createdAt: "2026-09-08T12:00:01.000Z",
          id: "assistant-1",
          role: "assistant",
          blocks: [
            { type: "thinking", thinking: "Hmm." },
            { type: "text", text: "Let me check.\n\n- one\n- two" },
            { type: "text", text: "Probably X." },
            {
              type: "toolCall",
              toolCall: {
                id: "call-1",
                name: "bash",
                status: "complete",
                input: { command: "ls" },
                output: { content: "a" },
                approval: { state: "approved", reason: "Safe" },
              },
            },
            { type: "text", text: "Confirmed: X." },
          ],
        },
      ],
      models: [],
      summary: {
        createdAt: "2026-09-08T12:00:00.000Z",
        id: "session-1",
        messageCount: 1,
        preview: "Why?",
        updatedAt: "2026-09-08T12:00:01.000Z",
      },
    });

    expect(markdown).toContain("</details>\n\nLet me check.");
    expect(markdown).toContain("- two\n\nProbably X.\n\n#### Tool call: bash");
    expect(markdown).toContain("- Reason: Safe\n\nConfirmed: X.\n");
    expect(markdown).not.toMatch(/\n{3,}/u);
  });
});
