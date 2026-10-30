import { describe, expect, it } from "vitest";
import {
  attachmentImageUrl,
  attachmentMessagePreview,
  extensionForPastedImage,
  isImageAttachment,
  isPastedImageMimeType,
  PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES,
  pastedTextByteLength,
  parseAttachmentMessage,
  serializeAttachmentMessage,
  shouldAttachPastedText,
  type PineAttachment,
} from "../attachments";
import { parseMessageBlocks } from "../sessions";

const attachment: PineAttachment = {
  extension: "md",
  modifiedAt: "2026-09-02T12:00:00.000Z",
  name: "notes.md",
  path: "/Users/example/notes.md",
  size: 1_024,
};

describe("attachment messages", () => {
  it("preserves selected text and line numbers in persisted messages", () => {
    const selected = {
      ...attachment,
      selection: { startLine: 2, endLine: 4, text: "part\nof\na file" },
    };
    expect(
      parseAttachmentMessage(serializeAttachmentMessage([selected], "Review")),
    ).toEqual({ attachments: [selected], prompt: "Review" });
  });

  it("preserves a rendered-document selection label", () => {
    const selected = {
      ...attachment,
      selection: {
        startLine: 1,
        endLine: 1,
        label: "Selected content · Sheet1!A1:B2",
        text: "Name\tValue",
      },
    };
    expect(
      parseAttachmentMessage(serializeAttachmentMessage([selected], "Review")),
    ).toEqual({ attachments: [selected], prompt: "Review" });
  });

  it.each([
    { startLine: 0, endLine: 2, text: "x" },
    { startLine: 4, endLine: 2, text: "x" },
    { startLine: 1.5, endLine: 2, text: "x" },
    { startLine: 1, endLine: 2, text: "" },
    { startLine: 1, endLine: 2, label: "", text: "x" },
  ])("rejects invalid selection metadata: %j", (selection) => {
    const message = serializeAttachmentMessage(
      [{ ...attachment, selection }],
      "Review",
    );
    expect(parseAttachmentMessage(message)).toEqual({
      attachments: [],
      prompt: message,
    });
  });

  it("round-trips attachment metadata without changing the user prompt", () => {
    const message = serializeAttachmentMessage([attachment], "Read this file.");

    expect(message).toMatch(/^<pine_attachments version="1">/);
    expect(parseAttachmentMessage(message)).toEqual({
      attachments: [attachment],
      prompt: "Read this file.",
    });
  });

  it("round-trips folder metadata and accepts legacy blocks without kind", () => {
    const folder: PineAttachment = {
      extension: "",
      kind: "directory",
      modifiedAt: "2026-09-02T12:00:00.000Z",
      name: "references",
      path: "/Users/example/references",
      size: 96,
    };

    expect(
      parseAttachmentMessage(serializeAttachmentMessage([folder], ""))
        .attachments,
    ).toEqual([folder]);
    expect(
      parseAttachmentMessage(serializeAttachmentMessage([attachment], ""))
        .attachments,
    ).toEqual([attachment]);
  });

  it("round-trips the app an attachment was taken from", () => {
    const captured: PineAttachment = {
      ...attachment,
      source: {
        app: "Safari",
        bundleId: "com.apple.Safari",
        windowTitle: "Pine",
        url: "https://example.com/",
      },
    };
    expect(
      parseAttachmentMessage(serializeAttachmentMessage([captured], "Hi"))
        .attachments,
    ).toEqual([captured]);

    const message = serializeAttachmentMessage(
      [{ ...attachment, source: { app: "" } }],
      "Hi",
    );
    expect(parseAttachmentMessage(message).attachments).toEqual([]);
  });

  it("leaves malformed or ordinary user text untouched", () => {
    const malformed =
      '<pine_attachments version="1">\nnot json\n</pine_attachments>\n\nHello';

    expect(parseAttachmentMessage(malformed)).toEqual({
      attachments: [],
      prompt: malformed,
    });
    expect(parseAttachmentMessage("Hello")).toEqual({
      attachments: [],
      prompt: "Hello",
    });
  });

  it("parses persisted user messages into attachment and visible text blocks", () => {
    const message = serializeAttachmentMessage([attachment], "Read this file.");

    expect(parseMessageBlocks({ role: "user", content: message })).toEqual([
      { type: "attachments", attachments: [attachment] },
      { type: "text", text: "Read this file." },
    ]);
    expect(attachmentMessagePreview(message)).toBe("Read this file.");
    expect(
      attachmentMessagePreview(serializeAttachmentMessage([attachment], "")),
    ).toBe("notes.md");
  });
});

describe("pasted image helpers", () => {
  it("treats image files but not folders as image attachments", () => {
    expect(isImageAttachment({ ...attachment, extension: "PNG" })).toBe(true);
    expect(isImageAttachment({ ...attachment, extension: "png" })).toBe(true);
    expect(
      isImageAttachment({ ...attachment, extension: "png", kind: "directory" }),
    ).toBe(false);
    expect(isImageAttachment(attachment)).toBe(false);
  });

  it("maps pasted mime types to canonical extensions", () => {
    expect(extensionForPastedImage("image/jpeg")).toBe("jpg");
    expect(extensionForPastedImage("image/png")).toBe("png");
    expect(extensionForPastedImage("image/webp")).toBe("webp");
    expect(isPastedImageMimeType("image/webp")).toBe(true);
    expect(isPastedImageMimeType("application/pdf")).toBe(false);
  });

  it("builds scoped protocol URLs for attachment previews", () => {
    expect(attachmentImageUrl("/tmp/a b/pic.png")).toBe(
      "pine-attachment://local/?p=%2Ftmp%2Fa%20b%2Fpic.png",
    );
  });
});

describe("pasted text helpers", () => {
  it("measures UTF-8 bytes instead of JavaScript code units", () => {
    expect(pastedTextByteLength("pine")).toBe(4);
    expect(pastedTextByteLength("松树")).toBe(6);
  });

  it("only converts non-blank text at the attachment threshold", () => {
    expect(
      shouldAttachPastedText(
        "a".repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES - 1),
      ),
    ).toBe(false);
    expect(
      shouldAttachPastedText(
        "a".repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES),
      ),
    ).toBe(true);
    expect(
      shouldAttachPastedText(
        " ".repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES),
      ),
    ).toBe(false);
  });
});
