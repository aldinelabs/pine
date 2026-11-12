// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PineCore } from "../../pineCore";
import { answerAutomationOperation } from "../automations";

const requester = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
};

function fixture(refusal: string | undefined) {
  const runNow = vi.fn();
  const automationRunRefusal = vi.fn(() => refusal);
  const get = vi.fn().mockResolvedValue({
    id: "nightly",
    name: "Nightly build",
    spec: { enabled: false },
  });
  const core = {
    automations: { get, runNow },
    wechat: { automationRunRefusal },
  } as unknown as PineCore;
  return { core, runNow, automationRunRefusal, get };
}

describe("automation_run_now", () => {
  it("refuses a run WeChat remote does not allow", async () => {
    const { core, runNow, automationRunRefusal } = fixture(
      "WeChat may not run this automation.",
    );
    await expect(
      answerAutomationOperation(
        core,
        requester,
        { op: "run-now", id: "nightly" },
        false,
      ),
    ).rejects.toThrow("WeChat may not run this automation.");
    expect(automationRunRefusal).toHaveBeenCalledWith(requester.sessionId, {
      id: "nightly",
      name: "Nightly build",
      enabled: false,
    });
    expect(runNow).not.toHaveBeenCalled();
  });

  it("runs the automation when nothing refuses it", async () => {
    const { core, runNow, get } = fixture(undefined);
    await expect(
      answerAutomationOperation(
        core,
        requester,
        { op: "run-now", id: "nightly" },
        false,
      ),
    ).resolves.toEqual({ started: true });
    expect(get).toHaveBeenCalledWith(requester.projectId, "nightly");
    expect(runNow).toHaveBeenCalledWith(requester.projectId, "nightly");
  });
});
