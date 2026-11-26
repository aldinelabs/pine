import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOL_NAMES } from "../tools";
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

  it("introduces itself by the name Pine shows in each language", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(
      /^You are the Orchestrator inside Pine/,
    );
    for (const name of [
      "指挥",
      "指揮",
      "Dirigent",
      "Chef d'orchestre",
      "Director",
      "指揮者",
      "지휘자",
      "Дирижёр",
    ])
      expect(ASSISTANT_SYSTEM_PROMPT).toContain(name);
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/\bthe Assistant\b/);
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

describe("the prompt's tool notes", () => {
  it("names every tool the Assistant has, and no other management tool", () => {
    for (const name of ASSISTANT_TOOL_NAMES)
      if (name !== "submit_session_summary" && name !== "memory_remove")
        expect(ASSISTANT_SYSTEM_PROMPT).toContain(name);
    for (const name of [
      "ui_project_delete",
      "ui_session_delete",
      "automation_save",
      "automation_delete",
      "approval_respond",
    ])
      expect(ASSISTANT_SYSTEM_PROMPT).not.toContain(name);
  });

  it("sends what only the user may do to the computer", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(
      "## What only the user can do on the computer",
    );
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("turning an automation on");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(
      "Never say such a thing is done.",
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
