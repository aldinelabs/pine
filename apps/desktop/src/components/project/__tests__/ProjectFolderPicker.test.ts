import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ProjectFolderPicker from "../ProjectFolderPicker.vue";

function mountPicker(pine: Record<string, unknown>) {
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  return mount(ProjectFolderPicker, {
    props: { mode: "default" },
    slots: {
      default: '<button type="button" data-testid="pick">Pick</button>',
    },
    global: { plugins: [createAppI18n("en-US")] },
    attachTo: document.body,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("project folder picker", () => {
  it("uses the native picker in the desktop window", async () => {
    const folder = {
      id: "f",
      name: "app",
      path: "/Users/me/app",
      access: "read-write",
    };
    const pickProjectFolders = vi.fn().mockResolvedValue({ folders: [folder] });
    const wrapper = mountPicker({ runtime: "desktop", pickProjectFolders });
    await wrapper.get('[data-testid="pick"]').trigger("click");
    await flushPromises();
    expect(pickProjectFolders).toHaveBeenCalledWith({ mode: "default" });
    expect(wrapper.emitted("picked")).toEqual([[[folder]]]);
    wrapper.unmount();
  });

  it("asks a browser for an absolute host path", async () => {
    const wrapper = mountPicker({ runtime: "web" });
    await wrapper.get('[data-testid="pick"]').trigger("click");
    await flushPromises();
    const submitPath = async (value: string) => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="host-folder-path"]',
      )!;
      input.value = value;
      input.dispatchEvent(new Event("input"));
      // Input syncs its v-model on the next tick.
      await flushPromises();
      input.closest("form")!.requestSubmit();
      await flushPromises();
    };

    await submitPath("relative/app");
    expect(wrapper.emitted("picked")).toBeUndefined();
    expect(document.body.textContent).toContain("Enter an absolute path.");

    await submitPath("/Users/me/app/");
    expect(wrapper.emitted("picked")?.[0]?.[0]).toEqual([
      expect.objectContaining({
        name: "app",
        path: "/Users/me/app",
        access: "read-write",
      }),
    ]);
    wrapper.unmount();
  });
});
