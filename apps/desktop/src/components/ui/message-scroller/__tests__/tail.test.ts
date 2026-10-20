import { expect, it } from "vitest";
import { measureContentHeight } from "../useMessageScroller";

function box(top: number, bottom: number): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({ top, bottom, height: bottom - top }) as DOMRect;
  return element;
}

it("leaves the tail out of the transcript's height", () => {
  const content = box(0, 900);
  const message = box(0, 400);
  const spacer = box(400, 600);
  const tail = box(600, 900);
  tail.setAttribute("data-message-scroller-tail", "");
  content.append(message, spacer, tail);

  expect(
    measureContentHeight({ content, spacer, viewport: box(0, 600) }),
  ).toBe(400);
});
