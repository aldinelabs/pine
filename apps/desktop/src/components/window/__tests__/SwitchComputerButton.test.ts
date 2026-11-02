import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";

const parent = { postMessage: vi.fn() };

/** Pine embedded in the RC page, which answers with `count` computers. */
async function mountInShell(count?: number) {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: { runtime: "web" },
  });
  const { default: SwitchComputerButton } =
    await import("../SwitchComputerButton.vue");
  const wrapper = mount(SwitchComputerButton, {
    global: { plugins: [createAppI18n("en-US")] },
  });
  if (count !== undefined)
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "pine-computers", count },
        origin: window.location.origin,
        source: parent as unknown as Window,
      }),
    );
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetModules();
  parent.postMessage.mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(window, "parent");
  Reflect.deleteProperty(window, "pine");
});

describe("SwitchComputerButton", () => {
  it("asks the RC page how many computers are paired", async () => {
    await mountInShell();
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "pine-computers-request" },
      window.location.origin,
    );
  });

  it("stays hidden with a single paired computer", async () => {
    const wrapper = await mountInShell(1);
    expect(wrapper.find('[data-testid="switch-computer"]').exists()).toBe(
      false,
    );
  });

  it("shows once another computer is paired", async () => {
    const wrapper = await mountInShell(2);
    expect(wrapper.find('[data-testid="switch-computer"]').exists()).toBe(true);
  });
});
