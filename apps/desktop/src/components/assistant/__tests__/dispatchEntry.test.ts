import { describe, expect, it } from "vitest";
import type { PineToolCall } from "@/shared/sessions";
import {
  dispatchEntryOfNotice,
  dispatchEntryOfToolCall,
  isDispatchToolCall,
} from "../dispatchEntry";

const call = (overrides: Partial<PineToolCall>): PineToolCall => ({
  id: "t1",
  name: "dispatch_task",
  status: "running",
  input: { projectId: "p1", title: "修首页", message: "修一下首页" },
  ...overrides,
});

describe("dispatch cards", () => {
  it("reads a dispatch while it runs, from what it asked for", () => {
    expect(isDispatchToolCall(call({}))).toBe(true);
    expect(isDispatchToolCall(call({ name: "pine_overview" }))).toBe(false);
    expect(dispatchEntryOfToolCall(call({}))).toEqual({
      projectId: "p1",
      title: "修首页",
      state: "dispatching",
    });
  });

  it("names the session a finished dispatch started", () => {
    expect(
      dispatchEntryOfToolCall(
        call({
          status: "complete",
          output: {
            details: {
              sessionId: "s1",
              projectId: "p1",
              projectName: "Blog",
            },
          },
        }),
      ),
    ).toEqual({
      sessionId: "s1",
      projectId: "p1",
      projectName: "Blog",
      title: "修首页",
      state: "dispatched",
    });
  });

  it("says a dispatch failed when it started nothing", () => {
    expect(dispatchEntryOfToolCall(call({ status: "error" })).state).toBe(
      "dispatch-failed",
    );
  });

  it("carries a report's state", () => {
    expect(
      dispatchEntryOfNotice({
        sessionId: "s1",
        projectId: "p1",
        state: "awaiting-approval",
      }),
    ).toMatchObject({ sessionId: "s1", state: "awaiting-approval" });
  });
});
