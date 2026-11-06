import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref, type Ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PineTranscriptMessage } from "@/stores/session";
import { useSteeringMessageTransition } from "../useSteeringMessageTransition";

const wrappers: ReturnType<typeof mount>[] = [];
let frames: Map<number, FrameRequestCallback>;
let reduced = false;
function message(id: string, text: string): PineTranscriptMessage {
  return {
    id,
    createdAt: "2000-01-01T00:00:00.000Z",
    role: "user",
    status: "complete",
    blocks: [{ type: "text", text }],
  };
}
function setup(queueValues = ["Queued message"]) {
  const queue = ref(queueValues);
  const messages: Ref<PineTranscriptMessage[]> = ref([]);
  const active = ref(true);
  const sessionId = ref<string | undefined>("session");
  const wrapper = mount(
    defineComponent({
      setup() {
        const container = ref<HTMLElement | null>(null);
        useSteeringMessageTransition({
          container,
          queue,
          messages,
          active,
          sessionId,
        });
        return { container, queue, messages };
      },
      template: `<div ref="container"><div v-for="(text, index) in queue" :key="index" data-steering-content><div data-slot="bubble">{{ text }}</div></div><div v-for="message in messages" :key="message.id" :data-message-id="message.id"><div data-slot="user-message-row"><div data-slot="bubble">{{ message.blocks[0].text }}</div></div></div></div>`,
    }),
    { attachTo: document.body },
  );
  wrappers.push(wrapper);
  return { wrapper, queue, messages, active, sessionId };
}
function frame(time: number) {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(time));
}

beforeEach(() => {
  frames = new Map();
  reduced = false;
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(
        200,
        this.closest("[data-steering-content]") ? 600 : 300,
        100,
        40,
      );
    },
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("flies a consumed queue bubble into its destination across separate IPC batches", async () => {
  const { wrapper, queue, messages } = setup();
  queue.value = [];
  await flushPromises();
  messages.value = [message("user-1", "Queued message")];
  await flushPromises();
  const target = wrapper.get<HTMLElement>(
    '[data-message-id="user-1"] [data-slot="bubble"]',
  );
  const flight = document.querySelector<HTMLElement>(
    '[data-slot="steering-message-flight"]',
  )!;
  expect(flight.textContent).toBe("Queued message");
  expect(flight.style.position).toBe("fixed");
  expect(flight.style.transform).toContain("200px, 600px");
  expect(flight.getAttribute("aria-hidden")).toBe("true");
  // The dashed source and the real message trade opacity on one curve.
  expect(flight.style.opacity).toBe("1");
  expect(target.element.style.opacity).toBe("0");
  frame(0);
  frame(250);
  expect(Number(flight.style.opacity)).toBeLessThan(1);
  expect(Number(target.element.style.opacity)).toBeGreaterThan(0);
  expect(
    Number(flight.style.opacity) + Number(target.element.style.opacity),
  ).toBeCloseTo(1);
  frame(500);
  expect(
    document.querySelector('[data-slot="steering-message-flight"]'),
  ).toBeNull();
  expect(target.element.style.opacity).toBe("");
});

it("does not animate a withdrawn message or an unrelated new message", async () => {
  const { queue, messages } = setup();
  queue.value = [];
  await flushPromises();
  messages.value = [message("other", "Unrelated")];
  await flushPromises();
  expect(
    document.querySelector('[data-slot="steering-message-flight"]'),
  ).toBeNull();
});

it("respects reduced motion", async () => {
  reduced = true;
  const { queue, messages } = setup();
  queue.value = [];
  messages.value = [message("user-1", "Queued message")];
  await flushPromises();
  expect(
    document.querySelector('[data-slot="steering-message-flight"]'),
  ).toBeNull();
});

it("cancels safely when the tab becomes inactive", async () => {
  const { wrapper, queue, messages, active } = setup();
  queue.value = [];
  messages.value = [message("user-1", "Queued message")];
  await flushPromises();
  expect(
    document.querySelector('[data-slot="steering-message-flight"]'),
  ).not.toBeNull();
  active.value = false;
  expect(
    document.querySelector('[data-slot="steering-message-flight"]'),
  ).toBeNull();
  expect(
    wrapper.get<HTMLElement>(
      '[data-slot="user-message-row"] [data-slot="bubble"]',
    ).element.style.opacity,
  ).toBe("");
});

it("reveals a normally sent message without a flight overlay", async () => {
  const { wrapper, messages } = setup([]);
  await flushPromises();
  // A transcript that already shows an earlier turn, then a normal send.
  messages.value = [message("old", "Earlier")];
  await flushPromises();
  messages.value = [message("old", "Earlier"), message("user-1", "Sent")];
  await flushPromises();
  expect(
    document.querySelector('[data-slot="steering-message-flight"]'),
  ).toBeNull();
  const target = wrapper.get<HTMLElement>(
    '[data-message-id="user-1"] [data-slot="bubble"]',
  );
  expect(target.element.style.opacity).toBe("0");
  frame(0);
  frame(250);
  expect(Number(target.element.style.opacity)).toBeGreaterThan(0);
  frame(500);
  expect(target.element.style.opacity).toBe("");
});

it("does not reveal history loads, prepends or assistant messages", async () => {
  const { wrapper, messages } = setup([]);
  await flushPromises();
  // First fill is a history load.
  messages.value = [
    message("a", "A"),
    { ...message("b", "B"), role: "assistant" as const },
  ];
  await flushPromises();
  for (const id of ["a", "b"]) {
    expect(
      wrapper.get<HTMLElement>(`[data-message-id="${id}"] [data-slot="bubble"]`)
        .element.style.opacity,
    ).toBe("");
  }
  // Loading earlier messages prepends new ids.
  messages.value = [message("old", "Old"), ...messages.value];
  await flushPromises();
  expect(
    wrapper.get<HTMLElement>('[data-message-id="old"] [data-slot="bubble"]')
      .element.style.opacity,
  ).toBe("");
  // A plain assistant append is not a sent user message.
  messages.value = [
    ...messages.value,
    { ...message("c", "C"), role: "assistant" as const },
  ];
  await flushPromises();
  expect(
    wrapper.get<HTMLElement>('[data-message-id="c"] [data-slot="bubble"]')
      .element.style.opacity,
  ).toBe("");
});

it("handles two identical queued messages without sharing destinations", async () => {
  const { queue, messages } = setup(["Same", "Same"]);
  queue.value = [];
  messages.value = [message("user-1", "Same"), message("user-2", "Same")];
  await flushPromises();
  expect(
    document.querySelectorAll('[data-slot="steering-message-flight"]'),
  ).toHaveLength(2);
  frame(0);
  frame(500);
  expect(
    document.querySelectorAll('[data-slot="steering-message-flight"]'),
  ).toHaveLength(0);
});

it("expires unmatched snapshots so later messages do not fly from stale positions", async () => {
  vi.useFakeTimers();
  const { queue, messages } = setup();
  queue.value = [];
  await flushPromises();
  await vi.advanceTimersByTimeAsync(5_001);
  messages.value = [message("later", "Queued message")];
  await flushPromises();
  expect(
    document.querySelector('[data-slot="steering-message-flight"]'),
  ).toBeNull();
});
