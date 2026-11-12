import { describe, expect, it } from "vitest";
import { approvalModeWithin, currentToolName } from "../agent";
import { sessionSearchQuery } from "../sessions";

describe("approvalModeWithin", () => {
  it("allows the same or a more supervised mode", () => {
    expect(approvalModeWithin("YOLO", "YOLO")).toBe(true);
    expect(approvalModeWithin("let-me-review", "YOLO")).toBe(true);
    expect(approvalModeWithin("auto-approve", "autonomous")).toBe(true);
  });

  it("refuses a less supervised mode", () => {
    expect(approvalModeWithin("YOLO", "autonomous")).toBe(false);
    expect(approvalModeWithin("auto-approve", "let-me-review")).toBe(false);
  });
});

describe("currentToolName", () => {
  it("maps names recorded before the ui_<area>_<action> rename", () => {
    expect(currentToolName("ui_list_project")).toBe("ui_project_list");
    expect(currentToolName("ui_teleport")).toBe("ui_session_teleport");
    expect(currentToolName("ui_session_new")).toBe("ui_session_new");
  });
});

describe("sessionSearchQuery", () => {
  it("treats a bare wildcard as listing", () => {
    expect(sessionSearchQuery(" * ")).toBe("");
    expect(sessionSearchQuery("***")).toBe("");
    expect(sessionSearchQuery(" release *")).toBe("release *");
  });
});
