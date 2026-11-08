import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import type { SideChatHighlight } from "@/stores/sideChat";
import { useSideChatHighlights } from "../useSideChatHighlights";

const observed: Element[] = [];
let disconnects = 0;

class RecordingObserver {
  observe(target: Element): void {
    observed.push(target);
  }
  disconnect(): void {
    disconnects++;
  }
  takeRecords(): MutationRecord[] {
    return [];
  }
}

const highlight: SideChatHighlight = {
  sideChatId: "chat-1",
  anchor: {
    messageId: "message-1",
    start: 0,
    end: 5,
    text: "Hello",
    quote: "Hello",
  },
};

describe("useSideChatHighlights", () => {
  beforeEach(() => {
    observed.length = 0;
    disconnects = 0;
    vi.stubGlobal("MutationObserver", RecordingObserver);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("watches transcript mutations only while there are passages to mark", async () => {
    const container = ref<HTMLElement | null>(document.createElement("div"));
    const enabled = ref(true);
    const highlights = ref<SideChatHighlight[]>([]);
    const scope = effectScope();
    scope.run(() =>
      useSideChatHighlights({
        container,
        enabled,
        highlights,
        activeSideChatId: ref(undefined),
        entryIdOf: (id) => id,
        open: () => undefined,
      }),
    );

    expect(observed).toHaveLength(0);

    highlights.value = [highlight];
    await nextTick();
    expect(observed).toEqual([container.value]);

    enabled.value = false;
    await nextTick();
    expect(disconnects).toBe(1);

    enabled.value = true;
    await nextTick();
    expect(observed).toHaveLength(2);

    highlights.value = [];
    await nextTick();
    expect(disconnects).toBe(2);
    scope.stop();
  });
});
