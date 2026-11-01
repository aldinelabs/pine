import { describe, expect, it } from "vitest";
import {
  approvalNotificationActions,
  approvalNotificationBody,
  questionnaireNotificationBody,
} from "../attentionNotifications";

describe("attention notifications", () => {
  it("shows what an approval would run", () => {
    expect(
      approvalNotificationBody("bash", { command: "rm -rf dist" }, false),
    ).toBe("Pine wants approval to run bash: rm -rf dist");
    expect(approvalNotificationBody("edit", { path: "a.ts" }, true)).toBe(
      "Pine 请求批准运行 edit：a.ts",
    );
  });

  it("falls back to the tool name when the input has no obvious subject", () => {
    expect(approvalNotificationBody("mcp", { count: 3 }, false)).toBe(
      "Pine wants approval to run mcp.",
    );
    expect(approvalNotificationBody("mcp", undefined, false)).toBe(
      "Pine wants approval to run mcp.",
    );
  });

  it("puts approve first so the first action index approves", () => {
    expect(approvalNotificationActions(false)).toEqual(["Approve", "Deny"]);
  });

  it("quotes the first question", () => {
    expect(
      questionnaireNotificationBody(
        {
          questions: [
            {
              header: "Approach",
              question: "How should Pine implement this?",
              options: [
                { label: "Small", description: "" },
                { label: "Large", description: "" },
              ],
            },
          ],
        },
        false,
      ),
    ).toBe("Pine needs your answer: How should Pine implement this?");
  });
});
