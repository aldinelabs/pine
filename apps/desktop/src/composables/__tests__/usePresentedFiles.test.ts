import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { PineSessionEvent } from "@/shared/agent";
import { useAttentionFlashStore } from "@/stores/attentionFlash";
import { useContentTabsStore } from "@/stores/contentTabs";
import { usePresentedFiles } from "../usePresentedFiles";

function mountPresentedFiles({
  isActive = () => false,
}: { isActive?: () => boolean } = {}) {
  let emit!: (event: PineSessionEvent) => void;
  const unsubscribe = vi.fn();
  const reveal = vi.fn();
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      onSessionEvent: (listener: (event: PineSessionEvent) => void) => {
        emit = listener;
        return unsubscribe;
      },
    },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(
    defineComponent({
      setup() {
        usePresentedFiles({ reveal, isActive });
        return () => null;
      },
    }),
    { global: { plugins: [pinia] } },
  );
  return { emit, reveal, unsubscribe, wrapper };
}

function presentEvent(path: string): PineSessionEvent {
  return {
    type: "present-file",
    sessionId: "session-1",
    toolCallId: "tool-1",
    path,
    target: { source: "presented", path },
  };
}

describe("agent presented files", () => {
  it("opens a tab, reveals it, and flashes it without activating anything", async () => {
    const { emit, reveal, wrapper } = mountPresentedFiles();
    const tabs = useContentTabsStore();
    tabs.setActiveTab("session-1");

    emit(presentEvent("/tmp/report.pdf"));
    await flushPromises();

    const tab = tabs.tabs.at(-1)!;
    expect(tab).toMatchObject({
      kind: "file",
      label: "report.pdf",
      source: "presented",
    });
    expect(tabs.presentedTargetFor("tool-1")).toEqual({
      source: "presented",
      path: "/tmp/report.pdf",
    });
    expect(reveal).toHaveBeenCalledWith(tab.id);
    expect(useAttentionFlashStore().isFlashing(tab.id)).toBe(true);
    // Opening a tab must not move the user's view.
    expect(tabs.fallbackActiveTabId).toBe("session-1");
    wrapper.unmount();
  });

  it("re-flashes the existing tab when the same file is presented twice", async () => {
    const { emit, wrapper } = mountPresentedFiles();
    const flash = useAttentionFlashStore();
    const tabs = useContentTabsStore();

    emit(presentEvent("/tmp/report.pdf"));
    await flushPromises();
    const tabId = tabs.tabs.at(-1)!.id;
    flash.stop(tabId);
    expect(flash.isFlashing(tabId)).toBe(false);

    emit(presentEvent("/tmp/report.pdf"));

    expect(
      tabs.tabs.filter((candidate) => candidate.kind === "file"),
    ).toHaveLength(1);
    expect(flash.isFlashing(tabId)).toBe(true);
    wrapper.unmount();
  });

  it("does not flash a file the user is already reading", async () => {
    const { emit, wrapper } = mountPresentedFiles({ isActive: () => true });
    const flash = useAttentionFlashStore();

    emit(presentEvent("/tmp/report.pdf"));
    await flushPromises();

    expect(flash.flashingIds.size).toBe(0);
    wrapper.unmount();
  });

  it("stops flashing and unsubscribes when the surface unmounts", async () => {
    const { emit, unsubscribe, wrapper } = mountPresentedFiles();
    const flash = useAttentionFlashStore();
    const tabs = useContentTabsStore();

    emit(presentEvent("/tmp/report.pdf"));
    await flushPromises();
    const tabId = tabs.tabs.at(-1)!.id;
    expect(flash.isFlashing(tabId)).toBe(true);

    wrapper.unmount();

    expect(unsubscribe).toHaveBeenCalled();
    expect(flash.flashingIds.size).toBe(0);
  });

  it("drops the flash when the tab it belongs to is closed", async () => {
    const { emit, wrapper } = mountPresentedFiles();
    const flash = useAttentionFlashStore();
    const tabs = useContentTabsStore();

    emit(presentEvent("/tmp/report.pdf"));
    await flushPromises();
    const tabId = tabs.tabs.at(-1)!.id;
    expect(flash.isFlashing(tabId)).toBe(true);

    tabs.close(tabId, tabId);
    await flushPromises();

    expect(flash.isFlashing(tabId)).toBe(false);
    wrapper.unmount();
  });
});
