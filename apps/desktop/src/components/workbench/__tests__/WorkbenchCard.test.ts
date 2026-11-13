import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useWorkbenchStore } from "@/stores/workbench";
import WorkbenchCard from "../WorkbenchCard.vue";

vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({ activate: vi.fn() }),
}));

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

function mountCard() {
  return mount(WorkbenchCard, {
    props: { panel: "preview", position: "bottom" },
    global: {
      plugins: [createAppI18n("en-US")],
      stubs: {
        WorkbenchPreviewPanel: true,
        WorkbenchCardPanelMenu: true,
        WorkbenchCardAddMenu: true,
      },
    },
  });
}

it("draws the highlight ring on an overlay above the previewer", () => {
  const store = useWorkbenchStore();
  store.isHighlighted = (panel) => panel === "preview";
  const card = mountCard().get("[data-testid=workbench-card]");
  const classes = card.classes();

  expect(card.attributes("data-highlighted")).toBe("true");
  // The card keeps previewers' z-indexes inside it...
  expect(classes).toContain("isolate");
  // ...and the ring is a pseudo-element stacked above them, not an outline
  // on the card that positioned previewer content paints over.
  expect(classes).toEqual(
    expect.arrayContaining([
      "before:absolute",
      "before:inset-0",
      "before:z-50",
      "before:pointer-events-none",
      "before:outline-1",
      "[--attention-flash-overlay-z-index:50]",
    ]),
  );
  expect(classes).not.toContain("outline-1");
});

it("shows no ring when the card is not highlighted", () => {
  const classes = mountCard().get("[data-testid=workbench-card]").classes();
  expect(classes).not.toContain("attention-flash");
  expect(classes.some((name) => name.startsWith("before:"))).toBe(false);
});
