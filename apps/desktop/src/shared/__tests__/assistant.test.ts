import { describe, expect, it } from "vitest";
import {
  parseAssistantMessageSource,
  withAssistantMessageSource,
} from "../assistant";

describe("Assistant message sources", () => {
  it("leaves a desktop message as typed", () => {
    expect(withAssistantMessageSource("desktop", "你好")).toBe("你好");
    expect(parseAssistantMessageSource("你好")).toEqual({
      source: "desktop",
      body: "你好",
    });
  });

  it("marks a WeChat message and reads the mark back", () => {
    const sent = withAssistantMessageSource("wechat", "看看进度");
    expect(sent).not.toBe("看看进度");
    expect(parseAssistantMessageSource(sent)).toEqual({
      source: "wechat",
      body: "看看进度",
    });
  });
});
