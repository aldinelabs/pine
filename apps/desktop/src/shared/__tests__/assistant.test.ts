import { describe, expect, it } from "vitest";
import {
  ASSISTANT_WECHAT_MARK,
  markWeChatMessage,
  readAssistantMessage,
} from "../assistant";

describe("Assistant message sources", () => {
  it("leaves a desktop message as typed", () => {
    expect(readAssistantMessage("你好")).toEqual({
      text: "你好",
      fromWeChat: false,
    });
  });

  it("marks a WeChat message on its first line and reads the mark back", () => {
    const sent = markWeChatMessage("看看进度");
    expect(sent).toBe(`${ASSISTANT_WECHAT_MARK}\n看看进度`);
    expect(readAssistantMessage(sent)).toEqual({
      text: "看看进度",
      fromWeChat: true,
    });
  });
});
