import { describe, expect, it } from "vitest";
import { parseAutomationRunMessage } from "../automationRunMessage";

const message = [
  '<automation_run name="Daily \\"summary\\"" trigger="schedule" started="2026-11-04T01:13:22.823Z" events="1">',
  "You are carrying out an automation the user approved.",
  "",
  "## Instructions",
  "Summarize new files.",
  "",
  "Keep it short.",
  "",
  "## How this run works",
  "- Finish by calling automation_report.",
  "</automation_run>",
].join("\n");

describe("parseAutomationRunMessage", () => {
  it("reads the run's name, trigger, start and instructions", () => {
    expect(parseAutomationRunMessage(message)).toEqual({
      name: 'Daily "summary"',
      trigger: "schedule",
      startedAt: "2026-11-04T01:13:22.823Z",
      instructions: "Summarize new files.\n\nKeep it short.",
    });
  });

  it("leaves other messages alone", () => {
    expect(parseAutomationRunMessage("hello")).toBeUndefined();
    expect(
      parseAutomationRunMessage(`${message}\nand something the user added`),
    ).toBeUndefined();
    expect(
      parseAutomationRunMessage(message.replace("## How this run works", "")),
    ).toBeUndefined();
  });
});
