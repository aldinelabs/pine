import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SYSTEM_PROMPT,
  ASSISTANT_WECHAT_MARK,
  markWeChatMessage,
  readAssistantMessage,
} from "../prompt";

describe("the Assistant's prompt", () => {
  it("chooses the reply style by the message's WeChat mark", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(
      `A user message whose first line is ${ASSISTANT_WECHAT_MARK} was typed in WeChat`,
    );
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("### In WeChat");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("### On the computer");
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("${");
  });

  it("keeps facts and approvals out of the casual style", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(
      "Session titles and project names appear in full",
    );
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(
      "Approvals use no slang, no emoticons",
    );
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(
      "this message does not approve anything",
    );
  });
});

describe("WeChat messages to the Assistant", () => {
  it("marks the first line and reads it back", () => {
    const marked = markWeChatMessage("现在都在跑啥");
    expect(marked).toBe(`${ASSISTANT_WECHAT_MARK}\n现在都在跑啥`);
    expect(readAssistantMessage(marked)).toEqual({
      text: "现在都在跑啥",
      fromWeChat: true,
    });
  });

  it("leaves desktop messages, and the mark inside a line, alone", () => {
    expect(readAssistantMessage("现在都在跑啥")).toEqual({
      text: "现在都在跑啥",
      fromWeChat: false,
    });
    expect(readAssistantMessage(`${ASSISTANT_WECHAT_MARK} hi`)).toEqual({
      text: `${ASSISTANT_WECHAT_MARK} hi`,
      fromWeChat: false,
    });
  });
});
