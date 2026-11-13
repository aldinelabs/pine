// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TINYFISH_TOOL_NAMES } from "../../../agent/tinyfishTools";
import type { PineApprovalTrigger, PineJsonValue } from "../../../shared/agent";
import {
  AUTOMATION_APPROVAL_VERDICT,
  EXTERNAL_CONTENT_TOOLS,
  approvalCardPolicy,
  approvalCardText,
} from "../cardPolicy";
import type { CardPolicyContext } from "../cardPolicy";
import { render } from "../replies";
import type { ApprovalAsk } from "../types";

function card(
  toolName: string,
  trigger: PineApprovalTrigger,
  input: PineJsonValue | undefined = {
    subject: "rm -rf build/ && make",
    description: "Clean and rebuild",
  },
  evidence?: string,
): ApprovalAsk {
  const text = approvalCardText({ toolName, input, evidence });
  return {
    kind: "approval",
    number: 12,
    createdAtMs: 0,
    requestId: "request-1",
    sessionId: "session-1",
    projectId: "project-1",
    trigger,
    toolName,
    input,
    ...(evidence !== undefined ? { evidence } : {}),
    subjectCut: text.subjectCut,
    external: false,
  };
}

const off: CardPolicyContext = {
  settings: { allowHighRiskApprovals: false },
  mode: "let-me-review",
};
const on: CardPolicyContext = {
  settings: { allowHighRiskApprovals: true },
  mode: "let-me-review",
};
const approvable = { kind: "approvable", needsShow: false, highRisk: false };

describe("approvalCardPolicy", () => {
  it.each([
    ["bash", "pre-execution"],
    ["bash", "sandbox-denied"],
    ["edit", "authorize-denied"],
    ["ui_project_delete", "pre-execution"],
    ["ui_session_delete", "pre-execution"],
    ["computer_use", "pre-execution"],
    ["a_tool_added_next_year", "pre-execution"],
  ] as const)("%s %s is approvable by default", (tool, trigger) => {
    expect(approvalCardPolicy(card(tool, trigger), off)).toEqual(approvable);
    expect(approvalCardPolicy(card(tool, trigger), on)).toEqual(approvable);
  });

  it.each(["privileged-execution", "destructive-pattern"] as const)(
    "%s needs the high-risk switch",
    (trigger) => {
      expect(approvalCardPolicy(card("bash", trigger), off)).toEqual({
        kind: "display-only",
        reason: "high-risk",
      });
      expect(approvalCardPolicy(card("bash", trigger), on)).toEqual({
        kind: "approvable",
        needsShow: false,
        highRisk: true,
      });
    },
  );

  it("shows a view-only session's cards only, whatever the switch", () => {
    for (const trigger of [
      "pre-execution",
      "privileged-execution",
      "long-context-activation",
    ] as const) {
      expect(
        approvalCardPolicy(card("bash", trigger), { ...on, mode: "view-only" }),
      ).toEqual({ kind: "display-only", reason: "view-only" });
    }
  });

  it("offers compress or stop for a long-context card", () => {
    expect(
      approvalCardPolicy(card("bash", "long-context-activation"), off),
    ).toEqual({ kind: "long-context" });
  });

  it("approves a card without a subject", () => {
    const ask = card("mystery", "pre-execution", undefined);
    expect(approvalCardPolicy(ask, off)).toEqual(approvable);
  });

  it("needs .show for a cut subject, even a very long one", () => {
    const cut = card("bash", "pre-execution", { subject: "x".repeat(301) });
    expect(cut.subjectCut).toBe(true);
    expect(approvalCardPolicy(cut, off)).toEqual({
      kind: "approvable",
      needsShow: true,
      highRisk: false,
    });
    const huge = card("bash", "pre-execution", { subject: "y".repeat(1501) });
    expect(approvalCardPolicy(huge, off)).toEqual({
      kind: "approvable",
      needsShow: true,
      highRisk: false,
    });
    // The flag recorded on the ask is honoured on its own.
    expect(
      approvalCardPolicy(
        { ...card("bash", "pre-execution"), subjectCut: true },
        off,
      ),
    ).toMatchObject({ needsShow: true });
  });

  it("measures the cut on the subject the card shows", () => {
    const at = { project: "pine", title: "t" };
    const tail = "\nrm -rf ~/secret";
    for (const lines of [40, 60, 74, 75]) {
      const subject = `${Array.from({ length: lines }, () => ".a").join("\n")}${tail}`;
      const ask = card("bash", "pre-execution", { subject });
      const verdict = approvalCardPolicy(ask, off);
      const text = approvalCardText(ask);
      const rendered = render("T-APPROVAL", "en", {
        at,
        ask: ask.number,
        tool: ask.toolName,
        trigger: ask.trigger,
        ...(text.subject !== undefined ? { subject: text.fullSubject } : {}),
        external: false,
        cut: ask.subjectCut,
      });
      const showsCut = rendered.includes(render("T-CUT", "en", { ask: 12 }));
      expect(verdict).toMatchObject({ kind: "approvable" });
      expect(verdict.kind === "approvable" && verdict.needsShow).toBe(showsCut);
      expect(rendered.includes("rm -rf ~/secret")).toBe(!showsCut);
    }
  });

  it("keeps automation approvals local", () => {
    expect(AUTOMATION_APPROVAL_VERDICT).toEqual({
      kind: "display-only",
      reason: "automation",
    });
  });
});

describe("approvalCardText", () => {
  it("reads the runtime's { subject, description }", () => {
    expect(
      approvalCardText({
        toolName: "bash",
        input: { subject: "make test", description: "Run the tests" },
      }),
    ).toEqual({
      subject: "make test",
      fullSubject: "make test",
      description: "Run the tests",
      subjectCut: false,
      tooLong: false,
    });
  });

  it("falls back to command, path, file_path, url", () => {
    expect(
      approvalCardText({
        toolName: "x",
        input: { subject: " ", command: "ls" },
      }).subject,
    ).toBe("ls");
    expect(
      approvalCardText({ toolName: "x", input: { path: "a", url: "b" } })
        .subject,
    ).toBe("a");
    expect(
      approvalCardText({ toolName: "x", input: { file_path: "f" } }).subject,
    ).toBe("f");
    expect(
      approvalCardText({ toolName: "x", input: { url: "https://e.x" } })
        .subject,
    ).toBe("https://e.x");
  });

  it("uses the evidence for session tools only", () => {
    expect(
      approvalCardText({
        toolName: "ui_session_new",
        evidence: "Fix the build",
      }).subject,
    ).toBe("Fix the build");
    expect(
      approvalCardText({ toolName: "ui_session_delete", evidence: "Old notes" })
        .subject,
    ).toBe("Old notes");
    expect(
      approvalCardText({ toolName: "bash", evidence: "stderr" }).subject,
    ).toBeUndefined();
    expect(
      approvalCardText({
        toolName: "ui_session_new",
        input: { subject: "own" },
        evidence: "prompt",
      }).subject,
    ).toBe("own");
  });

  it("cuts by code points", () => {
    const emoji = "😀".repeat(301);
    const text = approvalCardText({
      toolName: "bash",
      input: { subject: emoji },
    });
    expect(text.subjectCut).toBe(true);
    expect(text.tooLong).toBe(false);
    expect(Array.from(text.subject ?? "")).toHaveLength(300);
    expect(text.subject?.endsWith("…")).toBe(true);
    expect(text.fullSubject).toBe(emoji);
    expect(
      approvalCardText({
        toolName: "bash",
        input: { subject: "😀".repeat(300) },
      }).subjectCut,
    ).toBe(false);
    expect(
      approvalCardText({
        toolName: "bash",
        input: { subject: "a".repeat(1501) },
      }).tooLong,
    ).toBe(true);
    const description = approvalCardText({
      toolName: "bash",
      input: { subject: "s", description: "d".repeat(121) },
    }).description;
    expect(Array.from(description ?? "")).toHaveLength(120);
  });

  it("has no subject for missing or non-object input", () => {
    expect(approvalCardText({ toolName: "bash" })).toEqual({
      subjectCut: false,
      tooLong: false,
    });
    expect(approvalCardText({ toolName: "bash", input: ["ls"] }).subject).toBe(
      undefined,
    );
    expect(
      approvalCardText({ toolName: "bash", input: { subject: 3 } }).subject,
    ).toBeUndefined();
  });
});

describe("EXTERNAL_CONTENT_TOOLS", () => {
  it("matches the agent's TinyFish tools", () => {
    expect([...EXTERNAL_CONTENT_TOOLS].sort()).toEqual(
      [...TINYFISH_TOOL_NAMES].sort(),
    );
  });
});

describe("approvalCardText reviewer explanation", () => {
  it("returns a cut summary and the first two cut risks", () => {
    const text = approvalCardText({
      toolName: "bash",
      input: { subject: "rm -rf build", description: "clean" },
      explanation: {
        summary: "x".repeat(300),
        risks: ["r".repeat(100), " ", "second", "third"],
      },
    });
    expect(text.description).toBe("clean");
    expect(text.summary).toBe(`${"x".repeat(199)}…`);
    expect(text.risks).toEqual([`${"r".repeat(79)}…`, "second"]);
  });

  it("omits both without an explanation", () => {
    const text = approvalCardText({
      toolName: "bash",
      input: { command: "ls" },
    });
    expect(text).not.toHaveProperty("summary");
    expect(text).not.toHaveProperty("risks");
  });
});
