import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  applyWorkbenchCommand,
  closePanel,
  openPanel,
  parseWorkbenchLayout,
  presentInWorkbench,
  setWorkbenchOpen,
  type WorkbenchLayout,
} from "../workbenchLayout";

const closed: WorkbenchLayout = { ...DEFAULT_WORKBENCH_LAYOUT };
const single: WorkbenchLayout = {
  ...closed,
  open: true,
  top: "artifacts",
  bottom: null,
};

describe("workbench layout", () => {
  it("opens a panel in the first free card", () => {
    expect(openPanel(single, "preview")).toMatchObject({
      open: true,
      top: "artifacts",
      bottom: "preview",
    });
    expect(
      openPanel({ ...closed, top: null, bottom: null }, "preview"),
    ).toMatchObject({ open: true, top: "preview", bottom: null });
  });

  it("keeps a visible panel in place, or swaps it to the requested card", () => {
    const both = { ...single, bottom: "preview" as const };
    expect(openPanel(both, "preview")).toMatchObject({
      top: "artifacts",
      bottom: "preview",
    });
    expect(openPanel(both, "preview", "top")).toMatchObject({
      top: "preview",
      bottom: "artifacts",
    });
    // A hidden panel takes over the requested card.
    expect(openPanel(single, "preview", "top")).toMatchObject({
      top: "preview",
      bottom: null,
    });
  });

  it("moves the remaining card up and closes with the last card", () => {
    const both = { ...single, bottom: "preview" as const };
    expect(closePanel(both, "artifacts")).toMatchObject({
      open: true,
      top: "preview",
      bottom: null,
    });
    // The last card is kept for the next time the workbench opens.
    expect(closePanel(single, "artifacts")).toMatchObject({
      open: false,
      top: "artifacts",
    });
    expect(closePanel(both)).toMatchObject({ open: false, top: "artifacts" });
    expect(closePanel(single, "preview")).toBe(single);
  });

  it("arranges both cards at once and clamps the split", () => {
    expect(
      applyWorkbenchCommand(closed, {
        kind: "arrange",
        top: null,
        bottom: "preview",
        split: 95,
      }),
    ).toMatchObject({ open: true, top: "preview", bottom: null, split: 80 });
    expect(
      applyWorkbenchCommand(single, {
        kind: "arrange",
        top: "preview",
        bottom: "preview",
      }),
    ).toMatchObject({ top: "preview", bottom: null });
    expect(
      applyWorkbenchCommand(single, {
        kind: "arrange",
        top: null,
        bottom: null,
      }),
    ).toMatchObject({ open: false });
  });

  it("shows presented files in the preview card", () => {
    const preview = {
      target: { source: "presented" as const, path: "/tmp/report.pdf" },
      toolCallId: "call-1",
    };
    expect(presentInWorkbench(closed, preview)).toMatchObject({
      open: true,
      top: "artifacts",
      bottom: "preview",
      preview,
    });
  });

  it("falls back to the default card when opening an empty workbench", () => {
    expect(
      setWorkbenchOpen({ ...closed, top: null, bottom: null }, true),
    ).toMatchObject({ open: true, top: "artifacts" });
  });

  it("drops malformed stored layouts", () => {
    expect(parseWorkbenchLayout("nope")).toBeNull();
    expect(
      parseWorkbenchLayout({
        open: true,
        top: "bogus",
        bottom: "preview",
        split: "wide",
        preview: { target: { source: "presented" } },
      }),
    ).toEqual({
      open: true,
      top: "preview",
      bottom: null,
      split: 40,
      preview: null,
    });
  });

  it("drops the retired todo and process cards from stored layouts", () => {
    expect(
      parseWorkbenchLayout({
        open: true,
        top: "todos",
        bottom: "artifacts",
        split: 40,
      }),
    ).toMatchObject({ open: true, top: "artifacts", bottom: null });
    expect(
      parseWorkbenchLayout({ open: true, top: "tasks", bottom: "todos" }),
    ).toMatchObject({ open: false, top: null, bottom: null });
  });
});
