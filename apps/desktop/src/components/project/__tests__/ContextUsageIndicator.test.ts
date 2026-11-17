import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useSessionStore } from "@/stores/session";
import ContextUsageIndicator from "../ContextUsageIndicator.vue";

const passthroughStub = { template: "<div><slot /></div>" };

async function mountWithCost(cost: number) {
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      loadSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
      resumeSession: vi.fn().mockResolvedValue({
        session: {
          id: "session-cost",
          createdAt: "2026-09-07T12:00:00.000Z",
          updatedAt: "2026-09-07T12:00:00.000Z",
          messageCount: 2,
        },
        contextUsage: {
          tokens: 12_800,
          contextWindow: 128_000,
          percent: 10,
          cost,
          cacheHitRate: null,
        },
      }),
    },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useSessionStore();
  await store.resume("project-1", "session-cost");
  const wrapper = mount(ContextUsageIndicator, {
    global: {
      plugins: [pinia, createAppI18n("en-US")],
      stubs: {
        Popover: passthroughStub,
        PopoverContent: passthroughStub,
        PopoverTrigger: passthroughStub,
      },
    },
  });
  return { wrapper, store };
}

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

  it("sets and clears a session cost limit", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
        resumeSession: vi.fn().mockResolvedValue({
          session: {
            id: "session-limit",
            createdAt: "2026-09-07T12:00:00.000Z",
            updatedAt: "2026-09-07T12:00:00.000Z",
            messageCount: 2,
          },
          contextUsage: {
            tokens: 1_000,
            contextWindow: 128_000,
            percent: 1,
            cost: 0.25,
            cacheHitRate: null,
          },
        }),
      },
    });
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useSessionStore();
    await store.resume("project-1", "session-limit");

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

    expect(
      wrapper.get('[data-testid="cost-limit-field"]').attributes("inert"),
    ).toBeDefined();
    await wrapper.get('[data-testid="cost-limit-toggle"]').trigger("click");
    expect(store.costLimitFor("session-limit")).toBe(5);

    const input = wrapper.get('[data-testid="cost-limit-input"]');
    await input.setValue("2");
    await input.trigger("blur");
    expect(store.costLimitFor("session-limit")).toBe(2);
    expect(wrapper.text()).toContain("$2.00");

    await wrapper.get('[data-testid="cost-limit-toggle"]').trigger("click");
    expect(store.costLimitFor("session-limit")).toBeNull();
    store.setCostLimit("session-limit", null);
  });
  it("shows the session cost beside the percentage", async () => {
    const { wrapper } = await mountWithCost(0.4249);
    const trigger = wrapper.get('[data-slot="context-usage-trigger"]');
    expect(trigger.text()).toContain("10%");
    expect(
      trigger.get('[data-testid="context-usage-trigger-cost"]').text(),
    ).toBe("$0.42");
  });

  it("shows tiny costs as less than one cent", async () => {
    const { wrapper } = await mountWithCost(0.0004);
    expect(
      wrapper.get('[data-testid="context-usage-trigger-cost"]').text(),
    ).toBe("<$0.01");
  });

  it("hides the cost when nothing has been charged", async () => {
    const { wrapper } = await mountWithCost(0);
    expect(
      wrapper.find('[data-testid="context-usage-trigger-cost"]').exists(),
    ).toBe(false);
  });
});
