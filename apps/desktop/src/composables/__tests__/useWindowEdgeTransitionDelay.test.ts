import { effectScope, nextTick, ref } from "vue";
import { afterEach, expect, it } from "vitest";
import { useWindowEdgeTransitionDelay } from "../useWindowEdgeTransitionDelay";

afterEach(() => {
  document.body.innerHTML = "";
});

function mountLayout() {
  document.body.innerHTML = `
    <div id="root">
      <div data-slot="sidebar-gap"></div>
      <div data-slot="sidebar-container"><span id="inner"></span></div>
      <div data-window-edge-follower></div>
      <main id="content"></main>
    </div>`;
  const root = document.getElementById("root")!;
  const followers = [
    ...root.querySelectorAll<HTMLElement>(
      '[data-slot="sidebar-gap"], [data-slot="sidebar-container"], [data-window-edge-follower]',
    ),
  ];
  return { root, followers };
}

it("delays only the window-edge followers, not the layout root", async () => {
  const { root, followers } = mountLayout();
  const delay = ref<number | null>(null);
  const scope = effectScope();
  scope.run(() => useWindowEdgeTransitionDelay(root, delay));

  delay.value = -3;
  await nextTick();
  for (const follower of followers)
    expect(follower.style.transitionDelay).toBe("-3ms");
  expect(root.getAttribute("style")).toBeNull();
  expect(document.getElementById("inner")!.style.transitionDelay).toBe("");
  expect(document.getElementById("content")!.style.transitionDelay).toBe("");

  delay.value = null;
  await nextTick();
  for (const follower of followers)
    expect(follower.style.transitionDelay).toBe("");
  scope.stop();
});

it("waits for the root to exist", async () => {
  const { root, followers } = mountLayout();
  const element = ref<Element | null>(null);
  const scope = effectScope();
  scope.run(() => useWindowEdgeTransitionDelay(element, 0));

  element.value = root;
  await nextTick();
  for (const follower of followers)
    expect(follower.style.transitionDelay).toBe("0ms");
  scope.stop();
});
