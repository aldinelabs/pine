import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  defaultPineToolGroups,
  PINE_TOOL_GROUP_IDS,
  type PineToolGroupId,
} from "@/shared/toolGroups";
import ToolGroupSettings from "../ToolGroupSettings.vue";

vi.mock("@/app/errors/errorHandler", () => ({ handleError: vi.fn() }));

function mountWith(api: Record<string, unknown>) {
  Object.defineProperty(window, "pine", { configurable: true, value: api });
  return mount(ToolGroupSettings, {
    global: { plugins: [createAppI18n("en-US")] },
    slots: { web: '<div data-testid="web-extra">TinyFish key</div>' },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

it("lists every tool group with an icon, a description and its switch", async () => {
  const wrapper = mountWith({
    getToolGroups: vi
      .fn()
      .mockResolvedValue({ ...defaultPineToolGroups(), mcp: false }),
    setToolGroupEnabled: vi.fn(),
  });
  await flushPromises();
  for (const id of PINE_TOOL_GROUP_IDS) {
    const row = wrapper.get(`[data-testid="pine-tool-group-${id}"]`);
    expect(row.find("svg").exists()).toBe(true);
    expect(row.text()).not.toContain("preferences.");
    expect(
      row
        .get(`[data-testid="pine-tool-group-${id}-toggle"]`)
        .attributes("aria-checked"),
    ).toBe(id === "mcp" ? "false" : "true");
  }
  expect(wrapper.text()).toContain("Shell commands");
  // The web row carries the TinyFish key setting right below it.
  const html = wrapper.html();
  expect(html.indexOf("web-extra")).toBeGreaterThan(
    html.indexOf("pine-tool-group-web"),
  );
  expect(html.indexOf("web-extra")).toBeLessThan(
    html.indexOf("pine-tool-group-computerUse"),
  );
  wrapper.unmount();
});

it("saves one switch and keeps the others", async () => {
  const api = {
    getToolGroups: vi.fn().mockResolvedValue(defaultPineToolGroups()),
    setToolGroupEnabled: vi
      .fn()
      .mockImplementation(
        (request: { id: PineToolGroupId; enabled: boolean }) =>
          Promise.resolve({
            ...defaultPineToolGroups(),
            [request.id]: request.enabled,
          }),
      ),
  };
  const wrapper = mountWith(api);
  await flushPromises();
  const toggle = wrapper.get('[data-testid="pine-tool-group-shell-toggle"]');
  await toggle.trigger("click");
  await flushPromises();
  expect(api.setToolGroupEnabled).toHaveBeenCalledWith({
    id: "shell",
    enabled: false,
  });
  expect(toggle.attributes("aria-checked")).toBe("false");
  expect(
    wrapper
      .get('[data-testid="pine-tool-group-web-toggle"]')
      .attributes("aria-checked"),
  ).toBe("true");
  wrapper.unmount();
});

it("restores a switch whose change could not be saved", async () => {
  const wrapper = mountWith({
    getToolGroups: vi.fn().mockResolvedValue(defaultPineToolGroups()),
    setToolGroupEnabled: vi.fn().mockRejectedValue(new Error("disk full")),
  });
  await flushPromises();
  const toggle = wrapper.get('[data-testid="pine-tool-group-media-toggle"]');
  await toggle.trigger("click");
  await flushPromises();
  expect(toggle.attributes("aria-checked")).toBe("true");
  wrapper.unmount();
});
