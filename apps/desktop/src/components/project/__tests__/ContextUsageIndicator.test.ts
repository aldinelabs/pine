import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useSessionStore } from "@/stores/session";
import ContextUsageIndicator from "../ContextUsageIndicator.vue";

const passthroughStub = { template: "<div><slot /></div>" };

describe("ContextUsageIndicator", () => {
  it("allows the active session to be compacted manually", async () => {
    const compactSession = vi.fn().mockResolvedValue({ compacted: true });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        compactSession,
        loadSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
        resumeSession: vi.fn().mockResolvedValue({
          session: {
            id: "session-1",
            createdAt: "2026-09-07T12:00:00.000Z",
            updatedAt: "2026-09-07T12:00:00.000Z",
            messageCount: 2,
          },
          contextUsage: {
            tokens: 64_000,
            contextWindow: 128_000,
            percent: 50,
            cost: 0.25,
            cacheHitRate: 75.5,
          },
        }),
      },
    });
    const pinia = createPinia();
    setActivePinia(pinia);
    await useSessionStore().resume("project-1", "session-1");

    const wrapper = mount(ContextUsageIndicator, {
      global: {
        plugins: [pinia, createAppI18n("zh-CN")],
        stubs: {
          Popover: passthroughStub,
          PopoverContent: passthroughStub,
          PopoverTrigger: passthroughStub,
        },
      },
    });

    expect(wrapper.text()).toContain("64,000");
    expect(wrapper.text()).toContain("缓存命中率");
    expect(wrapper.text()).toContain("75.5%");
    await wrapper
      .get('[data-testid="compact-context-button"]')
      .trigger("click");
    await flushPromises();

    expect(compactSession).toHaveBeenCalledOnce();
  });

  it("hides cache hit rate when the provider does not report it", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
        resumeSession: vi.fn().mockResolvedValue({
          session: {
            id: "session-2",
            createdAt: "2026-09-07T12:00:00.000Z",
            updatedAt: "2026-09-07T12:00:00.000Z",
            messageCount: 2,
          },
          contextUsage: {
            tokens: 64_000,
            contextWindow: 128_000,
            percent: 50,
            cost: 0.25,
            cacheHitRate: null,
          },
        }),
      },
    });
    const pinia = createPinia();
    setActivePinia(pinia);
    await useSessionStore().resume("project-1", "session-2");

    const wrapper = mount(ContextUsageIndicator, {
      global: {
        plugins: [pinia, createAppI18n("zh-CN")],
        stubs: {
          Popover: passthroughStub,
          PopoverContent: passthroughStub,
          PopoverTrigger: passthroughStub,
        },
      },
    });

    expect(wrapper.text()).not.toContain("缓存命中率");
  });
});
