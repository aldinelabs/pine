import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { createAppI18n } from "@/app/i18n";
import { FIRST_USE_HINTS_PREFERENCE_KEY } from "@/shared/preferenceStorage";
import { useAppearanceStore } from "@/stores/appearance";
import { useFirstUseHintsStore } from "@/stores/firstUseHints";
import { useHelpStore } from "@/stores/help";
import FirstUseHint from "../FirstUseHint.vue";

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  window.localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
});

const hintProps = {
  id: "approval-card",
  text: "First approval?",
  guide: { topic: "approval-modes", step: 2 },
} as const;

function mountHints(count = 1) {
  const shown = ref(count);
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        Array.from({ length: shown.value }, (_, index) =>
          h(FirstUseHint, { ...hintProps, key: index }),
        ),
    }),
    { global: { plugins: [pinia, createAppI18n("en-US")] } },
  );
  return { wrapper, shown };
}

describe("FirstUseHint", () => {
  it("shows in one place only, and moves on when that place goes", async () => {
    const { wrapper, shown } = mountHints(2);
    await flushPromises();
    expect(wrapper.findAll('[data-slot="first-use-hint"]')).toHaveLength(1);
    shown.value = 0;
    await flushPromises();
    shown.value = 1;
    await flushPromises();
    expect(wrapper.findAll('[data-slot="first-use-hint"]')).toHaveLength(1);
  });

  it("shows each hint on its own, alongside others", async () => {
    const later = ref(false);
    const wrapper = mount(
      defineComponent({
        setup: () => () => [
          h(FirstUseHint, hintProps),
          later.value
            ? h(FirstUseHint, {
                id: "stopped",
                text: "Stopped.",
                guide: { topic: "steer-stop", step: 1 },
              })
            : null,
        ],
      }),
      { global: { plugins: [pinia, createAppI18n("en-US")] } },
    );
    await flushPromises();
    later.value = true;
    await flushPromises();
    const shownHints = () =>
      wrapper
        .findAll('[data-slot="first-use-hint"]')
        .map((hint) => hint.attributes("data-hint"));
    expect(shownHints()).toEqual(["approval-card", "stopped"]);
    await wrapper
      .get('[data-hint="approval-card"] [data-testid="first-use-hint-dismiss"]')
      .trigger("click");
    await flushPromises();
    expect(shownHints()).toEqual(["stopped"]);
  });

  it("goes for good on Got it, and comes back after a reset", async () => {
    const { wrapper } = mountHints();
    await flushPromises();
    await wrapper
      .get('[data-testid="first-use-hint-dismiss"]')
      .trigger("click");
    expect(wrapper.find('[data-slot="first-use-hint"]').exists()).toBe(false);
    expect(
      JSON.parse(
        window.localStorage.getItem(FIRST_USE_HINTS_PREFERENCE_KEY) ?? "[]",
      ),
    ).toEqual(["approval-card"]);

    const hints = useFirstUseHintsStore();
    expect(hints.hasDismissed).toBe(true);
    hints.reset();
    await flushPromises();
    expect(wrapper.find('[data-slot="first-use-hint"]').exists()).toBe(true);
  });

  it("opens its guide on Show me and stays dismissed", async () => {
    const { wrapper } = mountHints();
    await flushPromises();
    expect(wrapper.text()).toContain("First approval?");
    await wrapper.get('[data-testid="first-use-hint-guide"]').trigger("click");
    expect(useHelpStore().topicId).toBe("approval-modes");
    expect(useHelpStore().step).toBe(2);
    expect(wrapper.find('[data-slot="first-use-hint"]').exists()).toBe(false);
  });

  it("stays hidden with Guide buttons off, and remembers earlier dismissals", async () => {
    window.localStorage.setItem(
      FIRST_USE_HINTS_PREFERENCE_KEY,
      JSON.stringify(["compaction"]),
    );
    const hints = useFirstUseHintsStore();
    expect(hints.isAvailable("compaction")).toBe(false);
    expect(hints.isAvailable("approval-card")).toBe(true);

    useAppearanceStore().setHelpGuides(false);
    const { wrapper } = mountHints();
    await flushPromises();
    expect(wrapper.find('[data-slot="first-use-hint"]').exists()).toBe(false);
  });
});

interface FakeAnimation {
  keyframes: Keyframe[];
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
  finish: () => void;
  cancel: () => void;
}

describe("FirstUseHint motion", () => {
  let animations: FakeAnimation[];
  beforeEach(() => {
    animations = [];
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value(keyframes: Keyframe[]) {
        const animation: FakeAnimation = {
          keyframes,
          onfinish: null,
          oncancel: null,
          finish: () => animation.onfinish?.(),
          cancel: () => animation.oncancel?.(),
        };
        animations.push(animation);
        return animation;
      },
    });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    vi.unstubAllGlobals();
  });

  const global = {
    plugins: () => [pinia, createAppI18n("en-US")],
  };

  function mountToggled(initially: boolean) {
    const shown = ref(initially);
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h("div", [shown.value ? h(FirstUseHint, hintProps) : null]),
      }),
      {
        global: { plugins: global.plugins(), stubs: { transition: false } },
      },
    );
    return { wrapper, shown };
  }

  const hint = (wrapper: ReturnType<typeof mount>) =>
    wrapper.find('[data-slot="first-use-hint"]');

  it("shows at once when it mounts with what is around it", async () => {
    const { wrapper } = mountToggled(true);
    await flushPromises();
    expect(hint(wrapper).exists()).toBe(true);
    expect(animations).toHaveLength(0);
  });

  it("folds in when added to what is already on screen", async () => {
    const { wrapper, shown } = mountToggled(false);
    await flushPromises();
    shown.value = true;
    await flushPromises();
    expect(hint(wrapper).exists()).toBe(true);
    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes[0]).toMatchObject({
      height: "0px",
      opacity: 0,
    });
    expect(animations[0].keyframes[1]).toMatchObject({ opacity: 1 });
  });

  it("folds out on Got it, inert, and goes once the fold ends", async () => {
    const { wrapper } = mountToggled(true);
    await flushPromises();
    await wrapper
      .get('[data-testid="first-use-hint-dismiss"]')
      .trigger("click");
    await nextTick();
    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes[1]).toMatchObject({
      height: "0px",
      opacity: 0,
    });
    const element = hint(wrapper).element as HTMLElement;
    expect(element.inert).toBe(true);
    animations[0].finish();
    await nextTick();
    expect(hint(wrapper).exists()).toBe(false);
  });

  it("folds every hint out when Guide buttons go off", async () => {
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h("div", [
            h(FirstUseHint, hintProps),
            h(FirstUseHint, {
              id: "stopped",
              text: "Stopped.",
              guide: { topic: "steer-stop", step: 1 },
            }),
          ]),
      }),
      {
        global: { plugins: global.plugins(), stubs: { transition: false } },
      },
    );
    await flushPromises();
    useAppearanceStore().setHelpGuides(false);
    await nextTick();
    expect(animations).toHaveLength(2);
    for (const animation of animations) animation.finish();
    await nextTick();
    expect(wrapper.findAll('[data-slot="first-use-hint"]')).toHaveLength(0);
  });

  it("leaves nothing behind when unmounted mid-fold", async () => {
    const { wrapper, shown } = mountToggled(true);
    await flushPromises();
    useFirstUseHintsStore().dismiss("approval-card");
    await nextTick();
    expect(hint(wrapper).exists()).toBe(true);
    expect(animations).toHaveLength(1);
    shown.value = false;
    await flushPromises();
    expect(hint(wrapper).exists()).toBe(false);
    expect(wrapper.html()).not.toContain("first-use-hint");
  });

  it("skips the motion with reduced motion on", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({ matches: query.includes("reduce") }) as MediaQueryList,
    );
    const { wrapper, shown } = mountToggled(false);
    await flushPromises();
    shown.value = true;
    await flushPromises();
    expect(hint(wrapper).exists()).toBe(true);
    await wrapper
      .get('[data-testid="first-use-hint-dismiss"]')
      .trigger("click");
    await nextTick();
    expect(animations).toHaveLength(0);
    expect(hint(wrapper).exists()).toBe(false);
  });
});
