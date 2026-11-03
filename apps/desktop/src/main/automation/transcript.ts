import { readFile } from "node:fs/promises";
import type { AutomationTranscriptEntry } from "../../shared/automation";

const MAX_ENTRY_CHARS = 4_000;
const MAX_ENTRIES = 300;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const block = part as { type?: unknown; text?: unknown; name?: unknown };
      if (block.type === "text" && typeof block.text === "string")
        return [block.text];
      if (block.type === "toolCall" && typeof block.name === "string")
        return [`→ ${block.name}`];
      return [];
    })
    .join("\n");
}

/** A readable digest of a run's Pi session, without thinking blocks. */
export async function readRunTranscript(
  sessionFile: string,
): Promise<AutomationTranscriptEntry[]> {
  const text = await readFile(sessionFile, "utf8").catch(() => "");
  const entries: AutomationTranscriptEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: { type?: unknown; message?: Record<string, unknown> };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.type !== "message" || !entry.message) continue;
    const message = entry.message;
    const body = textOf(message.content).trim().slice(0, MAX_ENTRY_CHARS);
    if (message.role === "user" || message.role === "assistant") {
      if (body) entries.push({ role: message.role, text: body });
    } else if (message.role === "toolResult") {
      entries.push({
        role: "tool",
        text: body,
        ...(typeof message.toolName === "string"
          ? { toolName: message.toolName }
          : {}),
        ...(message.isError === true ? { isError: true } : {}),
      });
    }
  }
  return entries.slice(-MAX_ENTRIES);
}

/** The run's last assistant text, for runs that ended without a report. */
export function lastAssistantText(
  transcript: readonly AutomationTranscriptEntry[],
): string | undefined {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (entry.role === "assistant" && !entry.text.startsWith("→ "))
      return entry.text;
  }
  return undefined;
}
