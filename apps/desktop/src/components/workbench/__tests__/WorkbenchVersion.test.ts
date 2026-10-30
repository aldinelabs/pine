import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { PINE_RELEASES_URL } from "@/shared/window";
import { useUpdaterStore } from "@/stores/updater";
import WorkbenchVersion from "../WorkbenchVersion.vue";

beforeEach(() => {
  setActivePinia(createPinia());
  window.pine = {
    getAppVersion: vi.fn().mockResolvedValue("0.1.0"),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.pine;
});

function mountVersion() {
  return mount(WorkbenchVersion, {
    global: { plugins: [createAppI18n("zh-CN")] },
  });
}

it("shows the version and opens the releases on click", async () => {
  const wrapper = mountVersion();
  await flushPromises();
  const version = wrapper.get('[data-testid="pine-version"]');
  expect(version.text()).toBe("版本 0.1.0");
  await version.trigger("click");
  expect(window.pine.openExternalUrl).toHaveBeenCalledWith(PINE_RELEASES_URL);
  wrapper.unmount();
});

it("hides when the version lookup fails", async () => {
  vi.mocked(window.pine.getAppVersion).mockRejectedValue(new Error("nope"));
  const wrapper = mountVersion();
  await flushPromises();
  expect(wrapper.find('[data-testid="pine-version"]').exists()).toBe(false);
  wrapper.unmount();
});

it("shows the update notice in place of the version and opens the update", async () => {
  const updater = useUpdaterStore();
  const wrapper = mountVersion();
  await flushPromises();
  updater.update = {
    changelog: "Changes",
    internalVersion: "2.0.0",
    publishedAt: "2026-09-15",
    version: "2.0.0",
  };
  await flushPromises();
  const notice = wrapper.get('[data-testid="pine-version"]');
  expect(notice.text()).toBe("新版本 Pine 可用");
  expect(notice.classes()).toContain("text-info");
  await notice.trigger("click");
  expect(updater.isDialogOpen).toBe(true);
  expect(window.pine.openExternalUrl).not.toHaveBeenCalled();
  wrapper.unmount();
});
