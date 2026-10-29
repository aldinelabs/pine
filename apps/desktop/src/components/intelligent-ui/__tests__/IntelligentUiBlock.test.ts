import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import IntelligentUiBlock from "../IntelligentUiBlock.vue";
import { intelligentUiHostKey } from "../context";

const checklist = `root = Card([progress, items, ask], "Packing")
$tent = false
$stove = false
progress = Progress(((($tent ? 1 : 0) + ($stove ? 1 : 0)) / 2) * 100, "Packed")
items = Stack([Checkbox($tent, "Tent"), Checkbox($stove, "Stove")], "column", "sm")
ask = Button("What am I missing?", @ToAssistant("What else should I pack?"))`;

const counter = `root = Stack([label, Stack([add, reset], "row")])
$count = 0
label = Text("Count: " + $count)
add = Button("Add", @Set($count, $count + 1))
reset = Button("Reset", Action([@Reset($count)]), "outline")`;

let mounted = 0;

function mountBlock(
  code: string,
  options: { streaming?: boolean; send?: (message: string) => void } = {},
) {
  return mount(IntelligentUiBlock, {
    // Block state outlives a mount, so each test gets its own message.
    props: {
      code,
      streaming: options.streaming ?? false,
      messageId: `message-${++mounted}`,
    },
    global: {
      plugins: [createAppI18n("en-US")],
      provide: options.send
        ? { [intelligentUiHostKey as symbol]: { send: options.send } }
        : {},
    },
  });
}

function buttonNamed(wrapper: ReturnType<typeof mountBlock>, name: string) {
  const button = wrapper
    .findAll("button")
    .find((candidate) => candidate.text() === name);
  if (!button) throw new Error(`No button named ${name}`);
  return button;
}

describe("IntelligentUiBlock", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders the program with Pine's components", async () => {
    const wrapper = mountBlock(checklist, { send: vi.fn() });
    await flushPromises();

    expect(wrapper.find('[data-iui="card"]').text()).toContain("Packing");
    expect(wrapper.findAll('[data-iui="checkbox"]')).toHaveLength(2);
    expect(wrapper.find('[data-iui="progress"]').text()).toContain("0%");
  });

  it("recomputes what is shown when an input changes its $variable", async () => {
    const wrapper = mountBlock(checklist, { send: vi.fn() });
    await flushPromises();

    await wrapper.find('[data-iui="checkbox"] button').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-iui="progress"]').text()).toContain("50%");
  });

  it("runs @Set and @Reset buttons inside the block", async () => {
    const wrapper = mountBlock(counter);
    await flushPromises();

    await buttonNamed(wrapper, "Add").trigger("click");
    await buttonNamed(wrapper, "Add").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-iui="text"]').text()).toBe("Count: 2");

    await buttonNamed(wrapper, "Reset").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-iui="text"]').text()).toBe("Count: 0");
  });

  it("sends @ToAssistant messages with the block's values", async () => {
    const send = vi.fn();
    const wrapper = mountBlock(checklist, { send });
    await flushPromises();

    await wrapper.find('[data-iui="checkbox"] button').trigger("click");
    await flushPromises();
    await buttonNamed(wrapper, "What am I missing?").trigger("click");

    expect(send).toHaveBeenCalledWith(
      "What else should I pack?\n\n(tent: true; stove: false)",
    );
  });

  it("disables inputs while the fence is still streaming", async () => {
    const wrapper = mountBlock(checklist, { streaming: true });
    await flushPromises();

    expect(
      buttonNamed(wrapper, "What am I missing?").attributes("disabled"),
    ).toBeDefined();
  });

  it("shows the source when the program renders nothing", async () => {
    const wrapper = mountBlock("this is not openui lang");
    await flushPromises();

    expect(
      wrapper.find('[data-slot="intelligent-ui-block"]').attributes("style"),
    ).toContain("display: none");
    expect(wrapper.text()).toContain("this is not openui lang");
  });
});
