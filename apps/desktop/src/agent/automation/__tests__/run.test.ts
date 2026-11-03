import { describe, expect, it } from "vitest";
import { AUTOMATION_REPORT_TOOL_NAME } from "../../../shared/automation";
import type { AgentAutomationRun } from "../../protocol";
import {
  toolNamesForAutomationAuthoringState,
  toolNamesForAutomationRun,
} from "../../runtime/session-state";
import { createAutomationRunExtension, PINE_AUTOMATION_PAYLOAD } from "../run";
import { AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES } from "../tools";

const run: AgentAutomationRun = {
  automationId: "a1",
  runId: "r1",
  name: "Orders",
  network: ["erp.example.com"],
  secrets: [{ name: "erp-token", env: "ERP_TOKEN", value: "s3cret-value" }],
  toolNames: ["read", "bash"],
  payload: { events: [{ id: "1" }] },
};

type Handler = (event: Record<string, unknown>) => unknown;

function load(hasPayload: boolean) {
  const handlers = new Map<string, Handler>();
  const extension = createAutomationRunExtension(run, () => hasPayload);
  const { factory } = extension as unknown as {
    factory: (pi: unknown) => void;
  };
  factory({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
  });
  return handlers;
}

describe("automation run tools", () => {
  it("exposes only the approved tools and the report tool", () => {
    expect(
      toolNamesForAutomationRun(
        [
          "read",
          "write",
          "bash",
          "ask_user_question",
          AUTOMATION_REPORT_TOOL_NAME,
          "activate_automation_authoring",
        ],
        run,
      ),
    ).toEqual(["read", "bash", AUTOMATION_REPORT_TOOL_NAME]);
  });

  it("hides authoring tools until activated and the report tool always", () => {
    const names = [
      "read",
      AUTOMATION_REPORT_TOOL_NAME,
      ...AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES,
    ];
    expect(toolNamesForAutomationAuthoringState(names, false)).toEqual([
      "read",
    ]);
    expect(toolNamesForAutomationAuthoringState(names, true)).toEqual([
      "read",
      ...AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES,
    ]);
  });
});

describe("automation run extension", () => {
  it("delivers the payload once as a hidden custom message", () => {
    const sections: Record<string, string> = {};
    const first = load(false).get("before_agent_start")!({
      systemPromptOptions: { sections },
    }) as {
      message: { customType: string; content: string; display: boolean };
    };
    expect(sections.pine_automation_run).toMatch(/untrusted data/);
    expect(first.message.customType).toBe(PINE_AUTOMATION_PAYLOAD);
    expect(first.message.display).toBe(false);
    expect(first.message.content).toContain('"id": "1"');
    expect(
      load(true).get("before_agent_start")!({
        systemPromptOptions: { sections },
      }),
    ).toBeUndefined();
  });

  it("redacts secrets from every tool result", () => {
    const result = load(true).get("tool_result")!({
      content: [{ type: "text", text: "token=s3cret-value" }],
      details: { stdout: "s3cret-value" },
      structuredContent: { value: "s3cret-value" },
    });
    expect(result).toEqual({
      content: [{ type: "text", text: "token=[secret:erp-token]" }],
      details: { stdout: "[secret:erp-token]" },
      structuredContent: { value: "[secret:erp-token]" },
    });
  });
});
