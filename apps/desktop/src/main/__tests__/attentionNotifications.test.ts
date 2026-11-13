import { describe, expect, it } from "vitest";
import {
  approvalNotificationActions,
  approvalNotificationBody,
  questionnaireNotificationBody,
  replyNotificationBody,
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

  it("keeps the tool and subject first and adds the reviewer's summary below", () => {
    expect(
      approvalNotificationBody(
        "bash",
        { command: "git push --force" },
        false,
        "Force-pushes main.",
      ),
    ).toBe(
      "Pine wants approval to run bash: git push --force\nForce-pushes main.",
    );
    expect(
      approvalNotificationBody("bash", undefined, true, "强制推送 main。"),
    ).toBe("Pine 请求批准运行 bash。\n强制推送 main。");
    expect(
      approvalNotificationBody("bash", { command: "ls" }, false, "  "),
    ).toBe("Pine wants approval to run bash: ls");
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

  it("strips Markdown syntax from a reply", () => {
    expect(
      replyNotificationBody(
        "## Done\n\n**Fixed** the `parser`, see [docs](https://x.dev).\n- one\n- two",
      ),
    ).toBe("Done Fixed the parser, see docs. one two");
  });
});
