import { readFileSync } from "node:fs";
import path from "node:path";
import { mount } from "@vue/test-utils";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { nextTick } from "vue";
import { createAppI18n } from "@/app/i18n";
import enUS from "@/app/i18n/locales/en-US";
import ProjectAwaitingResponseMarker, {
  AWAITING_RESPONSE_DELAY_MS,
} from "../ProjectAwaitingResponseMarker.vue";

const MARKER = '[data-testid="awaiting-response-marker"]';

function mountMarker(
  props: { waiting: boolean; active: boolean },
  locale: Parameters<typeof createAppI18n>[0] = "en-US",
) {
  return mount(ProjectAwaitingResponseMarker, {
    props,
    global: {
      plugins: [createAppI18n(locale)],
      stubs: {
        // The real item registers with a MessageScroller; only its box matters.
        MessageScrollerItem: { template: "<div><slot /></div>" },
      },
    },
  });
}

describe("ProjectAwaitingResponseMarker", () => {
  beforeAll(() => {
    // Vue's first mount schedules a one-off devtools probe; let it fire so
    // the timer counts below are the marker's alone.
    vi.useFakeTimers();
    mountMarker({ waiting: false, active: true }).unmount();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the note after three seconds of waiting", async () => {
    expect(AWAITING_RESPONSE_DELAY_MS).toBe(3000);
    const wrapper = mountMarker({ waiting: true, active: true });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2999);
    await nextTick();
    expect(wrapper.find(MARKER).exists()).toBe(false);
    vi.advanceTimersByTime(1);
    await nextTick();
    const marker = wrapper.get(MARKER);
    const { status, hint } = enUS.project.transcript.awaitingResponse;
    // One sentence per line.
    expect(marker.get('[data-slot="awaiting-response-status"]').text()).toBe(
      status,
    );
    const hintLine = marker.get('[data-slot="awaiting-response-hint"]');
    expect(hintLine.text()).toBe(hint);
    // The hint breaks only between clauses.
    expect(
      hintLine.findAll(".inline-block").map((part) => part.text()),
    ).toEqual([
      "If this message stays for more than a few tens of seconds,",
      "check your network connection and the model provider’s availability.",
    ]);
    expect(marker.find('[role="status"]').exists()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    wrapper.unmount();
  });

  it("goes as soon as the wait ends", async () => {
    const wrapper = mountMarker({ waiting: true, active: true });
    vi.advanceTimersByTime(3000);
    await nextTick();
    expect(wrapper.find(MARKER).exists()).toBe(true);
    await wrapper.setProps({ waiting: false });
    expect(wrapper.find(MARKER).exists()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    wrapper.unmount();
  });

  it("ends a wait shorter than the delay without showing", async () => {
    const wrapper = mountMarker({ waiting: true, active: true });
    vi.advanceTimersByTime(1000);
    await wrapper.setProps({ waiting: false });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    await nextTick();
    expect(wrapper.find(MARKER).exists()).toBe(false);
    wrapper.unmount();
  });

  it("runs no timer in a background tab and shows at once on return", async () => {
    const wrapper = mountMarker({ waiting: true, active: false });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    await nextTick();
    expect(wrapper.find(MARKER).exists()).toBe(false);
    await wrapper.setProps({ active: true });
    expect(wrapper.find(MARKER).exists()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    wrapper.unmount();
  });

  it("keeps at most one timer while the tab switches", async () => {
    const wrapper = mountMarker({ waiting: true, active: true });
    for (const active of [false, true, false, true, true]) {
      await wrapper.setProps({ active });
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
      vi.advanceTimersByTime(500);
    }
    // 2.5 s of waiting so far: the rest of the delay, not a fresh one.
    vi.advanceTimersByTime(499);
    await nextTick();
    expect(wrapper.find(MARKER).exists()).toBe(false);
    vi.advanceTimersByTime(1);
    await nextTick();
    expect(wrapper.find(MARKER).exists()).toBe(true);
    wrapper.unmount();
  });

  it("clears its timer when unmounted", () => {
    const wrapper = mountMarker({ waiting: true, active: true });
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps an empty item that cancels the transcript gap while hidden", () => {
    const wrapper = mountMarker({ waiting: false, active: true });
    const item = wrapper.get('[data-slot="awaiting-response-item"]');
    expect(item.classes()).toContain("-mt-8");
    expect(item.find(MARKER).exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps Chinese clauses whole without adding spaces", async () => {
    const wrapper = mountMarker({ waiting: true, active: true }, "zh-CN");
    vi.advanceTimersByTime(3000);
    await nextTick();
    const hintLine = wrapper.get('[data-slot="awaiting-response-hint"]');
    expect(
      hintLine.findAll(".inline-block").map((part) => part.text()),
    ).toEqual([
      "若这条消息持续数十秒仍然不消失，",
      "考虑检查您的网络状况和模型提供商的可用性。",
    ]);
    expect(hintLine.text()).not.toContain(" ");
    wrapper.unmount();
  });

  it("fades in and out instead of growing open", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../ProjectAwaitingResponseMarker.vue"),
      "utf8",
    );
    expect(source).toContain('<Transition name="awaiting-response-fade">');
    expect(source).not.toContain("useCollapseTransition");
    expect(source).toMatch(
      /\.awaiting-response-fade-enter-active\s*\{\s*transition:\s*opacity/,
    );
  });
});
