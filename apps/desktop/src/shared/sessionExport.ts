import type { PineApprovalMode } from "./agent";
import type {
  PineContentBlock,
  PineSessionModel,
  PineSessionSummary,
  PineTextMessage,
  PineToolCall,
} from "./sessions";

export interface PineSessionExportInput {
  approvalMode: PineApprovalMode;
  messages: readonly PineTextMessage[];
  models: readonly PineSessionModel[];
  summary: PineSessionSummary;
}

function headingText(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/[\r\n]+/gu, " ");
}

function json(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value, null, 2);
}

function modelLabel(model: PineSessionModel): string {
  return `${model.providerId}/${model.modelId}`;
}

function appendCodeBlock(lines: string[], value: unknown): void {
  lines.push("```json", json(value), "```");
}

function appendToolCall(lines: string[], toolCall: PineToolCall): void {
  lines.push(
    `#### Tool call: ${headingText(toolCall.name, "Unnamed tool")}`,
    "",
    `- Status: ${toolCall.status}`,
    `- Call ID: ${toolCall.id}`,
    "",
    "Parameters:",
  );
  appendCodeBlock(lines, toolCall.input);
  lines.push("", "Result:");
  appendCodeBlock(lines, toolCall.output);
  if (toolCall.approval) {
    lines.push(
      "",
      `- Approval: ${toolCall.approval.state}`,
      ...(toolCall.approval.decidedBy
        ? [`- Decided by: ${toolCall.approval.decidedBy}`]
        : []),
      ...(toolCall.approval.reason
        ? [`- Reason: ${toolCall.approval.reason}`]
        : []),
    );
  }
}

function appendBlock(lines: string[], block: PineContentBlock): void {
  if (block.type === "text") {
    if (block.text.trim()) lines.push(block.text.trimEnd());
    return;
  }
  if (block.type === "thinking") {
    lines.push(
      "<details>",
      "<summary>Thinking</summary>",
      "",
      block.thinking,
      "",
      "</details>",
    );
    return;
  }
  if (block.type === "attachments") {
    lines.push(
      "Attachments:",
      ...block.attachments.map(
        (attachment) => `- ${attachment.name || attachment.path}`,
      ),
    );
    return;
  }
  if (block.type === "toolCall") {
    appendToolCall(lines, block.toolCall);
    return;
  }
  if (block.type === "compaction") {
    lines.push(`> Context compaction: ${block.compaction.status}`);
    return;
  }
  if (block.type === "backgroundTask") {
    lines.push(
      `> Background task ${block.task.name} (${block.task.id}): ${block.task.status}`,
    );
    return;
  }
  lines.push(`> Error: ${block.error.message}`);
}

function appendMessage(
  lines: string[],
  message: PineTextMessage,
  index: number,
): void {
  const role = message.role === "user" ? "User" : "Assistant";
  lines.push(`### ${index}. ${role}`, "", `_${message.createdAt}_`, "");
  for (const block of message.blocks) appendBlock(lines, block);
  lines.push("");
}

export function formatSessionAsMarkdown(input: PineSessionExportInput): string {
  const title = headingText(
    input.summary.name ?? input.summary.preview,
    "Conversation",
  );
  const lines = [
    `# ${title}`,
    "",
    "## Session settings",
    "",
    `- Session ID: ${input.summary.id}`,
    `- Created: ${input.summary.createdAt}`,
    `- Updated: ${input.summary.updatedAt}`,
    `- Approval mode: ${input.approvalMode}`,
    "- Models used:",
    ...(input.models.length > 0
      ? input.models.map((model) => `  - ${modelLabel(model)}`)
      : ["  - Unknown"]),
    "",
    "## Conversation",
    "",
  ];

  input.messages.forEach((message, index) =>
    appendMessage(lines, message, index + 1),
  );
  return `${lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()}\n`;
}
