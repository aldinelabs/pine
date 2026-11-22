import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
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

  it("shows one hint at a time, keeping the one on screen", async () => {
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
    // The hint already on screen stays; the new moment waits its turn.
    expect(shownHints()).toEqual(["approval-card"]);
    await wrapper
      .get('[data-testid="first-use-hint-dismiss"]')
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
