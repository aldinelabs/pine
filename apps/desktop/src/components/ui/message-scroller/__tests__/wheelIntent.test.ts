import { mount } from "@vue/test-utils";
import { h } from "vue";
import { afterEach, expect, it } from "vitest";
import MessageScrollerProvider from "../MessageScrollerProvider.vue";
import MessageScrollerViewport from "../MessageScrollerViewport.vue";
import { nestedScrollerTakes } from "../nestedScroll";

/** A nested panel like the live thinking panel: 600px of text in 256px. */
function scrollPanel(
  scrollTop: number,
  overscroll: "auto" | "contain" = "auto",
): HTMLElement {
  const panel = document.createElement("div");
  panel.style.overflowY = "auto";
  panel.style.overscrollBehaviorY = overscroll;
  panel.dataset.scrollHeight = "600";
  Object.defineProperties(panel, {
    clientHeight: { get: () => 256 },
    scrollHeight: { get: () => Number(panel.dataset.scrollHeight) },
  });
  panel.scrollTop = scrollTop;
  return panel;
}

afterEach(() => {
  document.body.replaceChildren();
});

it("leaves the transcript's follow alone for wheels that cannot scroll it", async () => {
  const wrapper = mount(MessageScrollerProvider, {
    attachTo: document.body,
    slots: {
      default: () =>
        h(MessageScrollerViewport, null, {
          default: () =>
            h(
              "div",
              {
                "data-panel": "",
                style: "overflow-y: auto; overscroll-behavior-y: contain",
              },
              [h("p", { "data-line": "" })],
            ),
        }),
    },
  });
  const viewport = wrapper.getComponent(MessageScrollerViewport);
  const panel = wrapper.get<HTMLElement>("[data-panel]").element;
  Object.defineProperties(panel, {
    clientHeight: { get: () => 256 },
    scrollHeight: { get: () => 600 },
  });

  // Sideways over a wide table or code block.
  await viewport.trigger("wheel", { deltaX: 40, deltaY: 0 });
  // Over the thinking panel, which scrolls itself.
  await wrapper.get("[data-line]").trigger("wheel", { deltaY: -40 });
  expect(viewport.emitted("userScrollIntent")).toBeUndefined();

  await viewport.trigger("wheel", { deltaY: -40 });
  expect(viewport.emitted("userScrollIntent")).toHaveLength(1);
  wrapper.unmount();
});

it("hands wheels to a nested scroller only while it can take them", () => {
  const root = document.createElement("div");
  const panel = scrollPanel(0);
  const line = document.createElement("p");
  panel.append(line);
  root.append(panel);
  document.body.append(root);

  expect(nestedScrollerTakes(line, root, "end")).toBe(true);
  // At its top the rest of an upward wheel reaches the transcript.
  expect(nestedScrollerTakes(line, root, "start")).toBe(false);
  panel.scrollTop = 344;
  expect(nestedScrollerTakes(line, root, "end")).toBe(false);
  expect(nestedScrollerTakes(line, root, "start")).toBe(true);
  // Contained overscroll never passes the wheel on, even at an edge.
  panel.style.overscrollBehaviorY = "contain";
  expect(nestedScrollerTakes(line, root, "end")).toBe(true);
  // Content that fits scrolls nothing, so the transcript gets the wheel.
  panel.dataset.scrollHeight = "256";
  expect(nestedScrollerTakes(line, root, "end")).toBe(false);
  expect(nestedScrollerTakes(root, root, "end")).toBe(false);
});
