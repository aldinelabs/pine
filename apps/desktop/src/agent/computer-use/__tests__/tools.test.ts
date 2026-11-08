import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PineApprovalMode } from "../../../shared/agent";
import type { GateDecision } from "../../protocol";
import type { ToolGate } from "../../gate";
import {
  ACTIVATE_COMPUTER_USE_TOOL_NAME,
  COMPUTER_USE_DYNAMIC_TOOL_NAMES,
  ComputerUseController,
  createComputerUseExtension,
  MUNIM_COMPUTER_USE_TOOL_NAMES,
} from "../tools";

function fakeClient() {
  return {
    start: vi.fn(() => Promise.resolve()),
    callTool: vi.fn(() =>
      Promise.resolve({
        content: [{ type: "text", text: "Safari (pid 42)" }],
        isError: false,
      }),
    ),
    dispose: vi.fn(() => Promise.resolve()),
  };
}

function fakeGate(
  review: ToolGate["reviewPrivilegedCall"] = vi.fn(() =>
    Promise.resolve({ kind: "allow" as const }),
  ),
) {
  return {
    reviewBashCommand: vi.fn(),
    reviewFileCall: vi.fn(),
    reviewDenial: vi.fn(),
    reviewPrivilegedCall: review,
    isApprovedCommand: vi.fn(() => false),
    resetTurn: vi.fn(),
  } satisfies ToolGate;
}

describe("ComputerUseController", () => {
  it("returns the skill and newly activated tools from the activator", async () => {
    const client = fakeClient();
    const controller = new ComputerUseController({
      client,
      executablePath: "/mock/pine-computer-use",
      getApprovalMode: () => "auto-approve",
      getGate: () => fakeGate(),
    });

    const activate = vi.fn();
    const result = await controller.activate(activate);

    expect(client.start).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(result.details.addedToolNames).toBeUndefined();
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("<computer_use_skill>"),
    });
  });

  it("keeps observations silent and reviews computer control once per task", async () => {
    const client = fakeClient();
    const review = vi.fn(() => Promise.resolve({ kind: "allow" as const }));
    const controller = new ComputerUseController({
      client,
      executablePath: "/mock/pine-computer-use",
      getApprovalMode: () => "auto-approve",
      getGate: () => fakeGate(review),
    });

    await controller.call("call-1", "list_apps", {});
    await controller.call("call-2", "click", { element_id: "e12" });

    await controller.call("call-3", "type_text", { text: "Hello" });
    await controller.call("call-4", "activate_app", { app: "Safari" });
    await controller.call("call-5", "browser_navigate", {
      url: "https://example.com",
    });

    expect(client.start).toHaveBeenCalledTimes(5);
    expect(client.callTool).toHaveBeenCalledTimes(5);
    expect(review).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "call-2",
        toolName: "click",
        subject: expect.stringContaining(
          "current task. First action: click on element e12",
        ),
      }),
    );
  });

  it.each<PineApprovalMode>(["auto-approve", "let-me-review", "autonomous"])(
    "expires the grant after a task reset in %s mode",
    async (mode) => {
      const review = vi.fn(() => Promise.resolve({ kind: "allow" as const }));
      const controller = new ComputerUseController({
        client: fakeClient(),
        getApprovalMode: () => mode,
        getGate: () => fakeGate(review),
      });
      await controller.call("first", "click", {});
      await controller.call("second", "scroll", {});
      controller.resetTaskAuthorization();
      await controller.call("next-task", "click", {});
      expect(review).toHaveBeenCalledTimes(2);
    },
  );

  it("does not reuse task control for extension setup", async () => {
    const review = vi
      .fn<() => Promise<GateDecision>>()
      .mockResolvedValueOnce({ kind: "allow" })
      .mockResolvedValueOnce({ kind: "deny", reason: "Setup declined" });
    const controller = new ComputerUseController({
      client: fakeClient(),
      getApprovalMode: () => "auto-approve",
      getGate: () => fakeGate(review),
    });
    await controller.call("first", "click", {});
    await expect(controller.installBrowserExtension("setup")).rejects.toThrow(
      "Setup declined",
    );
    await controller.call("second", "scroll", {});
    expect(review).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenLastCalledWith(
      expect.objectContaining({
        toolName: "install_pine_browser_extension",
        subject: "install_pine_browser_extension on the visible desktop",
      }),
    );
  });

  it("does not execute or cache a denied task grant", async () => {
    const client = fakeClient();
    const review = vi
      .fn<() => Promise<GateDecision>>()
      .mockResolvedValueOnce({ kind: "deny", reason: "Not authorized" })
      .mockResolvedValueOnce({ kind: "allow" });
    const controller = new ComputerUseController({
      client,
      getApprovalMode: () => "auto-approve",
      getGate: () => fakeGate(review),
    });
    await expect(controller.call("denied", "click", {})).rejects.toThrow(
      "Not authorized",
    );
    expect(client.callTool).not.toHaveBeenCalled();
    await controller.call("retry", "click", {});
    expect(review).toHaveBeenCalledTimes(2);
    expect(client.callTool).toHaveBeenCalledOnce();
  });

  it.each(["reset", "abort"])(
    "does not execute or restore a pending grant after %s",
    async (cause) => {
      const client = fakeClient();
      let resolve!: (decision: GateDecision) => void;
      const pending = new Promise<GateDecision>((done) => {
        resolve = done;
      });
      const review = vi
        .fn<() => Promise<GateDecision>>()
        .mockReturnValueOnce(pending)
        .mockResolvedValue({ kind: "allow" });
      const controller = new ComputerUseController({
        client,
        getApprovalMode: () => "auto-approve",
        getGate: () => fakeGate(review),
      });
      const abort = new AbortController();
      const action = controller.call("pending", "click", {}, abort.signal);
      const rejected = expect(action).rejects.toThrow();
      await vi.waitFor(() => expect(review).toHaveBeenCalledOnce());
      if (cause === "reset") controller.resetTaskAuthorization();
      else abort.abort();
      resolve({ kind: "allow" });
      await rejected;
      expect(client.callTool).not.toHaveBeenCalled();
      await controller.call("new-task", "click", {});
      expect(review).toHaveBeenCalledTimes(2);
    },
  );

  it("does not request a new grant for an action stopped during backend startup", async () => {
    const client = fakeClient();
    let finishStartup!: () => void;
    client.start.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishStartup = resolve;
      }),
    );
    const review = vi.fn(() => Promise.resolve({ kind: "allow" as const }));
    const controller = new ComputerUseController({
      client,
      getApprovalMode: () => "auto-approve",
      getGate: () => fakeGate(review),
    });
    const action = controller.call("stopped", "click", {});
    const rejected = expect(action).rejects.toThrow("authorization expired");
    controller.resetTaskAuthorization();
    finishStartup();
    await rejected;
    expect(review).not.toHaveBeenCalled();
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("requires a fresh grant after an approval mode change", async () => {
    let mode: PineApprovalMode = "auto-approve";
    const review = vi.fn(() => Promise.resolve({ kind: "allow" as const }));
    const controller = new ComputerUseController({
      client: fakeClient(),
      getApprovalMode: () => mode,
      getGate: () => fakeGate(review),
    });
    await controller.call("first", "click", {});
    mode = "let-me-review";
    await controller.call("changed-mode", "click", {});
    expect(review).toHaveBeenCalledTimes(2);
  });

  it("surfaces MCP tool errors as failed tool calls", async () => {
    const client = fakeClient();
    client.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "Accessibility permission is missing" }],
      isError: true,
    });
    const controller = new ComputerUseController({
      client,
      executablePath: "/mock/pine-computer-use",
      getApprovalMode: () => "YOLO",
      getGate: () => null,
    });

    await expect(controller.call("call-1", "click", {})).rejects.toThrow(
      "Accessibility permission is missing",
    );
  });
});

describe("createComputerUseExtension", () => {
  it("registers all tools and activates the hidden tools additively", async () => {
    const registered: Array<{
      name: string;
      execute: (...args: never[]) => Promise<unknown>;
    }> = [];
    const setActiveTools = vi.fn();
    const activated = vi.fn();
    const { extension } = createComputerUseExtension({
      activated,
      client: fakeClient(),
      executablePath: "/mock/pine-computer-use",
      getApprovalMode: () => "YOLO",
      getGate: () => null,
    });
    if (typeof extension === "function")
      throw new Error("Expected named extension");
    await extension.factory({
      getActiveTools: () => ["read", ACTIVATE_COMPUTER_USE_TOOL_NAME],
      registerTool: (tool: ToolDefinition) => registered.push(tool as never),
      setActiveTools,
    } as never);

    expect(registered[0]?.name).toBe(ACTIVATE_COMPUTER_USE_TOOL_NAME);
    expect(registered).toHaveLength(1 + COMPUTER_USE_DYNAMIC_TOOL_NAMES.length);
    expect(registered.map((tool) => tool.name)).toEqual([
      ACTIVATE_COMPUTER_USE_TOOL_NAME,
      ...COMPUTER_USE_DYNAMIC_TOOL_NAMES,
    ]);
    expect(MUNIM_COMPUTER_USE_TOOL_NAMES).toHaveLength(28);

    await registered[0]?.execute();

    expect(setActiveTools).toHaveBeenCalledWith([
      "read",
      ACTIVATE_COMPUTER_USE_TOOL_NAME,
      ...COMPUTER_USE_DYNAMIC_TOOL_NAMES,
    ]);
    expect(activated).toHaveBeenCalledOnce();
  });
});
