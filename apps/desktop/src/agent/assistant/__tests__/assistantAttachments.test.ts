import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  serializeAttachmentMessage,
  sessionAttachment,
  type PineAttachment,
} from "../../../shared/attachments";
import {
  assistantAttachmentId,
  markWeChatMessage,
} from "../../../shared/assistant";
import { assistantContextMessages, assistantMessageText } from "../attachments";

const report: PineAttachment = {
  name: "q3-report.pdf",
  path: "/Users/me/Private/q3-report.pdf",
  extension: "pdf",
  kind: "file",
  size: 1_572_864,
  modifiedAt: "2026-11-20T00:00:00.000Z",
};
const screenshot: PineAttachment = {
  name: "bug.png",
  path: "/Users/me/Library/Application Support/Pine/assistant/attachments/a.png",
  extension: "png",
  kind: "file",
  size: 2048,
  modifiedAt: "2026-11-20T00:00:00.000Z",
};
const folder: PineAttachment = {
  name: "designs",
  path: "/Users/me/designs",
  extension: "",
  kind: "directory",
  size: 0,
  modifiedAt: "2026-11-20T00:00:00.000Z",
};

describe("what the Assistant's model sees of attachments", () => {
  it("is each one's id, name, type and size, never its path", () => {
    const text = assistantMessageText(
      serializeAttachmentMessage(
        [
          report,
          screenshot,
          folder,
          sessionAttachment({
            projectId: "p-1",
            sessionId: "s-1",
            projectName: "Blog",
            title: "改首页",
            updatedAt: "2026-11-20T00:00:00.000Z",
          }),
        ],
        "交给合适的项目",
      ),
    );

    expect(text).toBe(
      [
        "<attachments>",
        `- ${assistantAttachmentId(report)}: q3-report.pdf (pdf file, 1.5 MB)`,
        `- ${assistantAttachmentId(screenshot)}: bug.png (image, 2 KB)`,
        `- ${assistantAttachmentId(folder)}: designs (folder)`,
        `- ${assistantAttachmentId({ path: "pine-session://p-1/s-1" })}: “改首页” (a session in Blog)`,
        "</attachments>",
        "",
        "交给合适的项目",
      ].join("\n"),
    );
    expect(text).not.toContain("/Users/me");
    expect(text).not.toContain("pine_attachments");
  });

  it("keeps a WeChat mark as the first line", () => {
    const text = assistantMessageText(
      serializeAttachmentMessage([report], markWeChatMessage("看看这个")),
    );
    expect(text.split("\n")[0]).toBe("[WeChat]");
    expect(text).toContain("q3-report.pdf");
    expect(text.endsWith("\n\n看看这个")).toBe(true);
  });

  it("leaves messages without attachments, and replies, alone", () => {
    const messages = [
      { role: "user", content: "现在都在跑什么？", timestamp: 1 },
      {
        role: "user",
        content: [{ type: "text", text: "<pine_attachments> is just text" }],
        timestamp: 2,
      },
    ] as AgentMessage[];
    expect(assistantContextMessages(messages)).toBeUndefined();
  });

  it("rewrites user messages in either content shape, the same way each time", () => {
    const raw = serializeAttachmentMessage([report], "交给博客项目");
    const messages = [
      { role: "user", content: raw, timestamp: 1 },
      {
        role: "user",
        content: [
          { type: "text", text: raw },
          { type: "image", data: "", mimeType: "image/png" },
        ],
        timestamp: 2,
      },
    ] as AgentMessage[];
    const first = assistantContextMessages(messages);
    const second = assistantContextMessages(messages);
    expect(first).toEqual(second);
    const [plain, parts] = first ?? [];
    expect(plain && "content" in plain ? plain.content : "").toBe(
      assistantMessageText(raw),
    );
    expect(JSON.stringify(parts)).not.toContain(report.path);
    // The stored messages are untouched.
    expect(messages[0] && "content" in messages[0] && messages[0].content).toBe(
      raw,
    );
  });

  it("names an attachment by a stable id from its path", () => {
    expect(assistantAttachmentId(report)).toMatch(/^att_[0-9a-f]{16}$/);
    const resized: PineAttachment = { ...report, size: 1 };
    expect(assistantAttachmentId(resized)).toBe(assistantAttachmentId(report));
    expect(assistantAttachmentId(screenshot)).not.toBe(
      assistantAttachmentId(report),
    );
  });
});
