import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  PROMPT_REWRITE_SYSTEM_PROMPT,
  promptRewriteContext,
  rewrittenPromptFromAssistantMessage,
} from "../prompt-rewrite";

function reply(...content: AssistantMessage["content"]): AssistantMessage {
  return { content } as AssistantMessage;
}

describe("prompt rewrite", () => {
  it("sends the draft to the rewriter's own system prompt", () => {
    const context = promptRewriteContext("写个周报");
    expect(context.systemPrompt).toBe(PROMPT_REWRITE_SYSTEM_PROMPT);
    expect(context.systemPrompt).toContain("[[");
    expect(context.tools).toBeUndefined();
    expect(context.messages[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining(
        "<draft_prompt>\n写个周报\n</draft_prompt>",
      ),
    });
  });

  it("takes the prompt out of its tag and drops thinking and chatter", () => {
    expect(
      rewrittenPromptFromAssistantMessage(
        reply(
          { type: "thinking", thinking: "plan" },
          {
            type: "text",
            text: "Here it is:\n<rewritten_prompt>\n为 [[团队]] 写周报。\n</rewritten_prompt>\nDone.",
          },
        ),
      ),
    ).toBe("为 [[团队]] 写周报。");
  });

  it("accepts an untagged or unclosed reply and rejects an empty one", () => {
    expect(
      rewrittenPromptFromAssistantMessage(
        reply({ type: "text", text: "  Plain prompt  " }),
      ),
    ).toBe("Plain prompt");
    expect(
      rewrittenPromptFromAssistantMessage(
        reply({ type: "text", text: "<rewritten_prompt>Cut off" }),
      ),
    ).toBe("Cut off");
    expect(
      rewrittenPromptFromAssistantMessage(
        reply({ type: "text", text: "<rewritten_prompt> </rewritten_prompt>" }),
      ),
    ).toBeUndefined();
    expect(rewrittenPromptFromAssistantMessage(undefined)).toBeUndefined();
  });

  it("puts the context before the draft as background", () => {
    const content = promptRewriteContext("按日期排一下", {
      project: { name: "Docs", folders: ["/repo"] },
      conversation: [
        { role: "user", text: "整理 docs 目录" },
        { role: "assistant", text: "已整理" },
      ],
      conversationTrimmed: true,
      attachments: [{ name: "README.md", path: "/repo/README.md" }],
      quotes: [{ text: "共 12 个文件", file: "/repo/a.md", lines: "3" }],
    }).messages[0]?.content as string;
    expect(content).toContain("Name: Docs\nFolders:\n- /repo");
    expect(content).toContain(
      "[User]\n整理 docs 目录\n\n[… earlier turns left out …]\n\n[Agent]\n已整理",
    );
    expect(content).toContain("- README.md: /repo/README.md");
    expect(content).toContain("(from /repo/a.md, lines 3)\n共 12 个文件");
    expect(content.indexOf("<draft_prompt>")).toBeGreaterThan(
      content.indexOf("</quoted_passages>"),
    );
  });

  it("sends the draft alone without context", () => {
    expect(promptRewriteContext("x", {}).messages[0]?.content).toBe(
      "Rewrite this draft prompt:\n\n<draft_prompt>\nx\n</draft_prompt>",
    );
  });
});
