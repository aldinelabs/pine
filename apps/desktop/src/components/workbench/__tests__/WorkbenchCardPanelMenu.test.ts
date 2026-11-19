import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import WorkbenchCardPanelMenu from "../WorkbenchCardPanelMenu.vue";

vi.mock("@/composables/useSideChat", () => ({
  useSideChat: () => ({ showPanel: vi.fn() }),
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ activeSession: { id: "session-1" } }),
}));
vi.mock("@/stores/liveContext", () => ({
  useLiveContextStore: () => ({ available: true }),
}));

const mounted: { unmount(): void }[] = [];

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

function mountMenu(panel: "live-context" | "artifacts") {
  const wrapper = mount(WorkbenchCardPanelMenu, {
    props: { panel, position: "top" },
    attachTo: document.body,
    global: { plugins: [createAppI18n("en-US")] },
  });
  mounted.push(wrapper);
  return wrapper;
}

it("marks Live context as beta in the card title", () => {
  const badge = mountMenu("live-context").get(
    "[data-testid=workbench-panel-beta]",
  );
  expect(badge.text()).toBe("Beta");
  expect(badge.classes()).toContain("uppercase");
  expect(
    mountMenu("artifacts").find("[data-testid=workbench-panel-beta]").exists(),
  ).toBe(false);
});

it("marks Live context as beta in the panel menu, and only it", async () => {
  const wrapper = mountMenu("artifacts");
  await wrapper.get("[data-testid=workbench-card-switch]").trigger("click");
  await flushPromises();
  const items = [
    ...document.body.querySelectorAll<HTMLElement>("[role=menuitemradio]"),
  ];
  const beta = items.filter((item) => item.textContent?.includes("Beta"));
  expect(
    beta.map((item) => item.textContent?.replace("Beta", "").trim()),
  ).toEqual(["Live context"]);
});
