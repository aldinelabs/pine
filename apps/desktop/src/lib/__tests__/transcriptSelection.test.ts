import { beforeEach, describe, expect, it } from "vitest";
import {
  locatePassage,
  proseText,
  rangeFromOffsets,
  rangeOffsets,
  rangesOverlap,
  transcriptSelection,
} from "../transcriptSelection";

function mount(): HTMLElement {
  document.body.innerHTML = `
    <div id="container">
      <div data-message-id="m1">
        <div class="transcript-prose"><p>Hello <b>bold</b> world</p></div>
        <div class="tool">Ran for 3s</div>
        <div class="transcript-prose"><p>Second part</p></div>
      </div>
    </div>`;
  return document.querySelector<HTMLElement>("[data-message-id]")!;
}

describe("transcript selection offsets", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = mount();
  });

  it("counts only prose text", () => {
    expect(proseText(root)).toBe("Hello bold worldSecond part");
  });

  it("maps a range to offsets and back", () => {
    const bold = root.querySelector("b")!.firstChild!;
    const range = document.createRange();
    range.setStart(bold, 1);
    range.setEnd(root.querySelectorAll("p")[1].firstChild!, 6);
    const offsets = rangeOffsets(root, range);
    expect(offsets).toEqual({ start: 7, end: 22 });
    expect(rangeFromOffsets(root, offsets!)?.toString()).toContain("old");
  });

  it("finds a passage again when its offsets moved", () => {
    const range = locatePassage(root, { start: 0, end: 4, text: "world" });
    expect(range?.toString()).toBe("world");
    expect(
      locatePassage(root, { start: 0, end: 5, text: "absent" }),
    ).toBeUndefined();
  });

  it("detects overlapping passages", () => {
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 4, end: 8 })).toBe(
      true,
    );
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 5, end: 8 })).toBe(
      false,
    );
  });

  it("reads a selection inside one message", () => {
    const text = root.querySelector("p")!.firstChild!;
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    selection.addRange(range);
    const result = transcriptSelection(
      selection,
      document.getElementById("container")!,
    );
    expect(result).toMatchObject({
      messageId: "m1",
      start: 0,
      end: 5,
      text: "Hello",
    });
  });
});
