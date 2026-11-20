import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  PROMPT_REWRITE_SYSTEM_PROMPT,
  promptRewriteContext,
  REPLY_SUGGESTION_SYSTEM_PROMPT,
  replySuggestionContext,
  collectReplySuggestions,
  REPLY_SUGGESTION_COUNT,
  ReplySuggestionStream,
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

  it("asks for the next message from the conversation alone", () => {
    const context = replySuggestionContext({
      conversation: [
        { role: "user", text: "整理 docs" },
        { role: "assistant", text: "要按日期还是名称排序？" },
      ],
    });
    expect(context.systemPrompt).toBe(REPLY_SUGGESTION_SYSTEM_PROMPT);
    expect(context.messages[0]?.content).toContain(
      "[Agent]\n要按日期还是名称排序？",
    );
  });

  it("asks for a fixed number of distinct alternatives in a stable prompt", () => {
    expect(REPLY_SUGGESTION_COUNT).toBe(3);
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("up to 3");
    expect(REPLY_SUGGESTION_SYSTEM_PROMPT).toContain("<reply>");
    // Nothing per request in the system prompt, so it stays cacheable.
    expect(replySuggestionContext({ conversation: [] }).systemPrompt).toBe(
      replySuggestionContext({
        conversation: [{ role: "user", text: "x" }],
      }).systemPrompt,
    );
  });
});

describe("ReplySuggestionStream", () => {
  const text =
    "<reply>按日期排序</reply>\n<reply>按名称\n排序</reply>\n<reply>先别动 docs</reply>";

  function pushAll(stream: ReplySuggestionStream, chunks: string[]) {
    const completed: string[][] = [];
    for (const chunk of chunks)
      if (stream.push(chunk)) completed.push([...stream.suggestions]);
    return completed;
  }

  it("completes each alternative only once its tag closes, at any chunking", () => {
    for (const size of [1, 2, 3, 5, 8]) {
      const stream = new ReplySuggestionStream(3, 200);
      const chunks = [];
      for (let index = 0; index < text.length; index += size)
        chunks.push(text.slice(index, index + size));
      const completed = pushAll(stream, chunks);
      expect(completed).toEqual([
        ["按日期排序"],
        ["按日期排序", "按名称 排序"],
        ["按日期排序", "按名称 排序", "先别动 docs"],
      ]);
    }
    const whole = new ReplySuggestionStream(3, 200);
    expect(pushAll(whole, [text])).toEqual([
      ["按日期排序", "按名称 排序", "先别动 docs"],
    ]);
  });

  it("never shows a half-written alternative", () => {
    const stream = new ReplySuggestionStream(3, 200);
    expect(stream.push("<reply>按日期")).toBe(false);
    expect(stream.push("排序</rep")).toBe(false);
    expect(stream.suggestions).toEqual([]);
    expect(stream.push("ly>")).toBe(true);
    expect(stream.suggestions).toEqual(["按日期排序"]);
    // A reply cut off by the token limit does not finish its last one.
    stream.push("<reply>按名称");
    expect(stream.finish(false)).toBe(false);
    expect(stream.suggestions).toEqual(["按日期排序"]);
  });

  it("ignores chatter, stray tags, empties, near-duplicates and extras", () => {
    const stream = new ReplySuggestionStream(3, 200);
    stream.push("Sure! Here you go:\n<reply></reply>\n");
    stream.push("<reply>Sort by date.</reply>\n<reply>sort by  DATE</reply>\n");
    stream.push("<reply>oops <reply>Rename the files</reply>\n");
    stream.push("<reply>Sort by dates</reply>\n");
    stream.push("<reply>Delete the drafts</reply><reply>Fifth</reply>");
    expect(stream.finish(true)).toBe(false);
    expect(stream.suggestions).toEqual([
      "Sort by date.",
      "Rename the files",
      "Delete the drafts",
    ]);
  });

  it("finishes a closed reply's unclosed last tag or untagged lines", () => {
    const unclosed = new ReplySuggestionStream(3, 200);
    unclosed.push("<reply>一</reply><reply>二");
    expect(unclosed.finish(true)).toBe(true);
    expect(unclosed.suggestions).toEqual(["一", "二"]);

    const untagged = new ReplySuggestionStream(3, 200);
    untagged.push("1. 按日期排序\n- 按名称排序\n\n");
    expect(untagged.finish(true)).toBe(true);
    expect(untagged.suggestions).toEqual(["按日期排序", "按名称排序"]);

    const long = new ReplySuggestionStream(3, 200);
    long.push(`<reply>${"x".repeat(300)}</reply>`);
    expect(long.suggestions[0]).toHaveLength(200);
  });
});

describe("collectReplySuggestions", () => {
  type Event =
    Parameters<typeof collectReplySuggestions>[0] extends AsyncIterable<infer E>
      ? E
      : never;

  async function* events(items: (Event | Error)[]) {
    for (const item of items) {
      await Promise.resolve();
      if (item instanceof Error) throw item;
      yield item;
    }
  }
  const delta = (text: string) =>
    ({ type: "text_delta", contentIndex: 0, delta: text }) as Event;
  const done = { type: "done", reason: "stop" } as Event;
  const failed = {
    type: "error",
    error: { errorMessage: "overloaded" },
  } as Event;

  it("reports each alternative set as it completes", async () => {
    const progress: string[][] = [];
    const result = await collectReplySuggestions(
      events([
        delta("<reply>一</re"),
        delta("ply>"),
        delta("<reply>二</reply>"),
        delta("<reply>三"),
        done,
      ]),
      {
        maxItems: 3,
        maxLength: 200,
        cancelled: () => false,
        onProgress: (suggestions) => progress.push(suggestions),
      },
    );
    expect(progress).toEqual([["一"], ["一", "二"]]);
    expect(result).toEqual(["一", "二", "三"]);
  });

  it("keeps what is complete when the stream fails or is cancelled", async () => {
    const options = {
      maxItems: 3,
      maxLength: 200,
      cancelled: () => false,
      onProgress: () => undefined,
    };
    await expect(
      collectReplySuggestions(
        events([delta("<reply>一</reply><reply>二"), failed]),
        options,
      ),
    ).resolves.toEqual(["一"]);
    await expect(
      collectReplySuggestions(
        events([delta("<reply>一</reply>"), new Error("aborted")]),
        options,
      ),
    ).resolves.toEqual(["一"]);
    await expect(
      collectReplySuggestions(events([delta("<reply>一"), failed]), options),
    ).rejects.toThrow("overloaded");
    // A cancel with nothing complete is quiet and reports nothing.
    const progress: string[][] = [];
    await expect(
      collectReplySuggestions(events([delta("<reply>一</reply>"), failed]), {
        ...options,
        cancelled: () => true,
        onProgress: (suggestions) => progress.push(suggestions),
      }),
    ).resolves.toEqual(["一"]);
    expect(progress).toEqual([]);
  });
});
