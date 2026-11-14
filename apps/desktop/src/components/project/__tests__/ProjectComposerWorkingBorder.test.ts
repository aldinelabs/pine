import { readFileSync } from "node:fs";
import path from "node:path";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectComposerWorkingBorder, {
  WORKING_BORDER_EXIT_MS,
} from "../ProjectComposerWorkingBorder.vue";

const BORDER = '[data-slot="session-composer-working-border"]';
const GLOW = '[data-slot="session-composer-working-border-glow"]';

function mountBorder(active: boolean) {
  return mount(ProjectComposerWorkingBorder, {
    props: { active },
    attachTo: document.body,
  });
}

describe("ProjectComposerWorkingBorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing while inactive", () => {
    const wrapper = mountBorder(false);
    expect(wrapper.find(BORDER).exists()).toBe(false);
    expect(wrapper.find(GLOW).exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders the border and its glow copy while active", () => {
    const wrapper = mountBorder(true);
    const border = wrapper.get(BORDER);
    const glow = wrapper.get(GLOW);
    expect(border.classes()).toEqual(["chat-input-working-border"]);
    expect(glow.classes()).toEqual(
      expect.arrayContaining([
        "chat-input-working-border",
        "chat-input-working-border-glow",
      ]),
    );
    expect(border.attributes("data-state")).toBe("on");
    expect(glow.attributes("data-state")).toBe("on");
    expect(border.attributes("aria-hidden")).toBe("true");
    expect(border.find(".chat-input-working-border-arc").exists()).toBe(true);
    expect(glow.find(".chat-input-working-border-arc").exists()).toBe(true);
    wrapper.unmount();
  });

  it("leaves over the exit, then unmounts", async () => {
    const wrapper = mountBorder(true);
    await wrapper.setProps({ active: false });
    expect(wrapper.get(BORDER).attributes("data-state")).toBe("leaving");
    expect(wrapper.get(GLOW).attributes("data-state")).toBe("leaving");
    expect(WORKING_BORDER_EXIT_MS).toBe(900);
    vi.advanceTimersByTime(899);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(BORDER).exists()).toBe(true);
    vi.advanceTimersByTime(1);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(BORDER).exists()).toBe(false);
    expect(wrapper.find(GLOW).exists()).toBe(false);
    wrapper.unmount();
  });

  it("comes back on mid-exit without a pending timer", async () => {
    const wrapper = mountBorder(true);
    await wrapper.setProps({ active: false });
    expect(vi.getTimerCount()).toBe(1);
    await wrapper.setProps({ active: true });
    expect(wrapper.get(BORDER).attributes("data-state")).toBe("on");
    expect(vi.getTimerCount()).toBe(0);
    wrapper.unmount();
  });

  it("leaves no timer when unmounted mid-exit", async () => {
    const wrapper = mountBorder(true);
    await wrapper.setProps({ active: false });
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ports VS Code's working border with Pine's colour, entrance and exit", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../ProjectComposerWorkingBorder.vue"),
      "utf8",
    );
    for (const fragment of [
      "microsoft/vscode",
      "conic-gradient(",
      "--chat-input-anim-duration: 4s",
      "@keyframes chat-input-working-border-spin",
      "rotate(360deg)",
      "hypot(",
      "mask-composite: exclude",
      "blur(1.5px)",
      "var(--composer-working-border-color)",
      "@property --composer-working-border-grow",
      "pow(tan(atan2(100cqw, 100cqh)), 0.6)",
      "scaleX(var(--composer-working-border-stretch))",
      "1100ms",
      "900ms",
    ])
      expect(source).toContain(fragment);
    expect(source).toMatch(/conic-gradient\(\s*from/);
    // Chrome keeps a running animation's size-dependent keyframe values, so
    // the spin carries no size: the stretch stays on a still element.
    const spin = source.slice(
      source.indexOf("@keyframes chat-input-working-border-spin"),
    );
    expect(spin.slice(0, spin.indexOf("\n}"))).not.toMatch(/var\(|cq[wh]/);
    const reduced = source.slice(
      source.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(/::before\s*\{\s*animation:\s*none;/);
  });
});
