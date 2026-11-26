import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  isImageAttachment,
  parseAttachmentMessage,
  type PineAttachment,
} from "../../shared/attachments";
import {
  ASSISTANT_WECHAT_MARK,
  assistantAttachmentId,
  readAssistantMessage,
} from "../../shared/assistant";
import { formatBytes } from "../../lib/formatBytes";

/**
 * One attachment as the Assistant sees it: its id, name, type and size,
 * never its path or contents. It cannot open files; it only decides where
 * the work goes and forwards the attachment with dispatch_task.
 */
export function describeAssistantAttachment(
  attachment: PineAttachment,
): string {
  const id = assistantAttachmentId(attachment);
  if (attachment.kind === "session" && attachment.session) {
    const project = attachment.session.projectName;
    return `- ${id}: “${attachment.name}” (a session${project ? ` in ${project}` : ""})`;
  }
  if (attachment.kind === "directory")
    return `- ${id}: ${attachment.name} (folder)`;
  const type = isImageAttachment(attachment)
    ? "image"
    : attachment.extension
      ? `${attachment.extension.toLowerCase()} file`
      : "file";
  const lines = attachment.selection
    ? `, lines ${attachment.selection.startLine}–${attachment.selection.endLine}`
    : "";
  return `- ${id}: ${attachment.name} (${type}, ${formatBytes(attachment.size, "en-US")}${lines})`;
}

/**
 * The text of a user message as the Assistant's model reads it: the
 * attachment block becomes a list of ids and metadata, and a WeChat mark
 * stays the first line. Text without attachments is returned unchanged.
 */
export function assistantMessageText(text: string): string {
  const { attachments, prompt } = parseAttachmentMessage(text);
  if (attachments.length === 0) return text;
  const { text: body, fromWeChat } = readAssistantMessage(prompt);
  const list = [
    "<attachments>",
    ...attachments.map(describeAssistantAttachment),
    "</attachments>",
  ].join("\n");
  return [
    ...(fromWeChat ? [ASSISTANT_WECHAT_MARK] : []),
    list,
    ...(body ? ["", body] : []),
  ].join("\n");
}

/**
 * The conversation as sent to the Assistant's model: every user message's
 * attachments as metadata only. Deterministic, so the prompt cache holds.
 */
export function assistantContextMessages(
  messages: readonly AgentMessage[],
): AgentMessage[] | undefined {
  let changed = false;
  const result = messages.map((message) => {
    if (message.role !== "user") return message;
    if (typeof message.content === "string") {
      const text = assistantMessageText(message.content);
      if (text === message.content) return message;
      changed = true;
      return { ...message, content: text };
    }
    let partChanged = false;
    const content = message.content.map((part) => {
      if (part.type !== "text") return part;
      const text = assistantMessageText(part.text);
      if (text === part.text) return part;
      partChanged = true;
      return { ...part, text };
    });
    if (!partChanged) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? result : undefined;
}
