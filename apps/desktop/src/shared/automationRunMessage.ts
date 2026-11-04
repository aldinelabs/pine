import type { AutomationTriggerKind } from "./automation";

/** What the transcript shows of the message that starts an automation run. */
export interface AutomationRunMessage {
  name: string;
  trigger: AutomationTriggerKind | "batch";
  startedAt: string;
  instructions: string;
}

const OPENING = /^<automation_run (?<attributes>[^>\n]*)>\n/;
const CLOSING = "\n</automation_run>";
const INSTRUCTIONS = "\n## Instructions\n";
const RULES = "\n\n## How this run works\n";

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`(?:^| )${name}=("(?:[^"\\\\]|\\\\.)*")`).exec(
    attributes,
  );
  if (!match) return undefined;
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the run message the automation service writes (`runMessage` in
 * main/automation/service.ts). Anything else, including a user's own text
 * that merely starts with the tag, stays an ordinary message.
 */
export function parseAutomationRunMessage(
  text: string,
): AutomationRunMessage | undefined {
  const opening = OPENING.exec(text);
  if (!opening?.groups || !text.endsWith(CLOSING)) return undefined;
  const attributes = opening.groups.attributes;
  const name = attribute(attributes, "name");
  const trigger = attribute(attributes, "trigger");
  const startedAt = attribute(attributes, "started");
  if (!name || !trigger || !startedAt) return undefined;
  const body = text.slice(opening[0].length, -CLOSING.length);
  const start = body.indexOf(INSTRUCTIONS);
  const end = body.lastIndexOf(RULES);
  if (start < 0 || end < start) return undefined;
  return {
    name,
    trigger: trigger as AutomationRunMessage["trigger"],
    startedAt,
    instructions: body.slice(start + INSTRUCTIONS.length, end).trim(),
  };
}
