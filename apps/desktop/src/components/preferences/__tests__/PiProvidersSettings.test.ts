import { createTestingPinia } from "@pinia/testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Switch } from "@/components/ui/switch";
import type { PiProvidersStatus } from "@/shared/piProviders";
import { useModelsStore } from "@/stores/models";
import PiProvidersSettings from "../PiProvidersSettings.vue";

const status = (overrides: Partial<PiProvidersStatus> = {}) =>
  ({
    enabled: false,
    agentDir: "/home/me/.pi/agent",
    agentDirSource: "default",
    path: "/home/me/.pi/agent/models.json",
    found: true,
    count: 0,
    skipped: [],
    ...overrides,
  }) satisfies PiProvidersStatus;

function mountWith(pine: Record<string, unknown>) {
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  const pinia = createTestingPinia({ createSpy: vi.fn });
  const wrapper = mount(PiProvidersSettings, {
    attachTo: document.body,
    global: { plugins: [pinia, createAppI18n("en-US")] },
  });
  return { wrapper, models: useModelsStore(pinia) };
}

function toggle(wrapper: VueWrapper) {
  const found = wrapper
    .findAllComponents(Switch)
    .find(
      (candidate) =>
        candidate.vm.$attrs["data-testid"] === "pine-pi-providers-switch",
    );
  if (!found) throw new Error("Missing switch");
  return found;
}

const text = (testId: string) =>
  [...document.querySelectorAll(`[data-testid="${testId}"]`)].map((element) =>
    element.textContent?.trim(),
  );

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PiProvidersSettings", () => {
  it("holds the layout with skeletons until the status loads", async () => {
    let resolve!: (value: PiProvidersStatus) => void;
    const { wrapper } = mountWith({
      getPiProviders: () => new Promise((done) => (resolve = done)),
    });
    expect(wrapper.find('[data-slot="skeleton"]').exists()).toBe(true);
    resolve(status());
    await flushPromises();
    expect(wrapper.find('[data-slot="skeleton"]').exists()).toBe(false);
    expect(text("pine-pi-providers-path")).toEqual([
      "/home/me/.pi/agent/models.json",
    ]);
  });

  it("turns the providers on and reloads the model catalog", async () => {
    const setPiProviders = vi.fn().mockResolvedValue(
      status({
        enabled: true,
        count: 2,
        skipped: [{ key: "cmd", reason: "command-value" }],
      }),
    );
    const { wrapper, models } = mountWith({
      getPiProviders: vi.fn().mockResolvedValue(status()),
      setPiProviders,
    });
    await flushPromises();
    expect(text("pine-pi-providers-summary")[0]).toContain("Off");

    toggle(wrapper).vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(setPiProviders).toHaveBeenCalledWith({ enabled: true });
    expect(models.load).toHaveBeenCalled();
    expect(text("pine-pi-providers-summary")).toEqual(["2 providers added"]);
    expect(text("pine-pi-providers-skipped")[0]).toContain(
      "Skipped cmd: its key or a header runs a command",
    );
  });

  it("explains a missing file and offers to go back to the default folder", async () => {
    const setPiProviders = vi.fn().mockResolvedValue(status());
    const { wrapper } = mountWith({
      getPiProviders: vi.fn().mockResolvedValue(
        status({
          enabled: true,
          found: false,
          agentDir: "/opt/pi",
          agentDirSource: "setting",
          path: "/opt/pi/models.json",
        }),
      ),
      setPiProviders,
    });
    await flushPromises();
    expect(text("pine-pi-providers-summary")[0]).toContain("No models.json");
    await wrapper
      .get('[data-testid="pine-pi-providers-default"]')
      .trigger("click");
    await flushPromises();
    expect(setPiProviders).toHaveBeenCalledWith({
      enabled: true,
      agentDir: null,
    });
  });

  it("reveals the file and applies a picked folder", async () => {
    const revealPiProviders = vi.fn().mockResolvedValue({ revealed: true });
    const pickPiAgentDir = vi.fn().mockResolvedValue({
      status: status({ agentDir: "/picked", agentDirSource: "setting" }),
    });
    const { wrapper } = mountWith({
      getPiProviders: vi.fn().mockResolvedValue(status()),
      revealPiProviders,
      pickPiAgentDir,
    });
    await flushPromises();
    await wrapper
      .get('[data-testid="pine-pi-providers-reveal"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="pine-pi-providers-choose"]')
      .trigger("click");
    await flushPromises();
    expect(revealPiProviders).toHaveBeenCalled();
    expect(pickPiAgentDir).toHaveBeenCalled();
    expect(
      wrapper.find('[data-testid="pine-pi-providers-default"]').exists(),
    ).toBe(true);
  });
});
