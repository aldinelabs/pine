import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BEHIND_MODAL_ATTRIBUTE,
  trackModalOverlays,
} from "../modalOverlayState";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("trackModalOverlays", () => {
  let stop: (() => void) | undefined;
  let sidebar: HTMLElement;

  beforeEach(() => {
    sidebar = document.createElement("div");
    sidebar.dataset.slot = "sidebar-container";
    sidebar.dataset.side = "left";
    const app = document.createElement("div");
    app.append(sidebar);
    document.body.append(app);
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
  });

  function overlay(slot: string): HTMLElement {
    const element = document.createElement("div");
    element.dataset.slot = slot;
    return element;
  }

  const marked = () => sidebar.hasAttribute(BEHIND_MODAL_ATTRIBUTE);

  it("marks the left sidebar while an overlay is mounted in body", async () => {
    stop = trackModalOverlays();
    expect(marked()).toBe(false);

    const element = overlay("alert-dialog-overlay");
    document.body.append(element);
    await flush();
    expect(marked()).toBe(true);

    element.remove();
    await flush();
    expect(marked()).toBe(false);
  });

  it("stays set until the last of several overlays leaves", async () => {
    stop = trackModalOverlays();
    const dialog = overlay("dialog-overlay");
    const sheet = overlay("sheet-overlay");
    document.body.append(dialog, sheet);
    await flush();

    dialog.remove();
    await flush();
    expect(marked()).toBe(true);
    sheet.remove();
    await flush();
    expect(marked()).toBe(false);
  });

  it("picks up an open overlay and ignores other elements", async () => {
    const element = overlay("dialog-overlay");
    document.body.append(element);
    stop = trackModalOverlays();
    expect(marked()).toBe(true);

    element.remove();
    document.body.append(overlay("popover-content"));
    await flush();
    expect(marked()).toBe(false);
  });

  it("leaves the right sidebar alone", async () => {
    const right = document.createElement("div");
    right.dataset.slot = "sidebar-container";
    right.dataset.side = "right";
    document.body.append(right);
    stop = trackModalOverlays();
    document.body.append(overlay("dialog-overlay"));
    await flush();
    expect(marked()).toBe(true);
    expect(right.hasAttribute(BEHIND_MODAL_ATTRIBUTE)).toBe(false);
  });

  it("clears the mark when stopped", () => {
    document.body.append(overlay("dialog-overlay"));
    stop = trackModalOverlays();
    stop();
    stop = undefined;
    expect(marked()).toBe(false);
  });
});
