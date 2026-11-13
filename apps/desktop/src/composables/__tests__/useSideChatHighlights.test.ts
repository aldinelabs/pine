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

  describe("placement", () => {
    let frames: FrameRequestCallback[] = [];
    let published = 0;
    let registry: Map<string, { ranges: Range[] }>;

    class FakeHighlight {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }

    beforeEach(() => {
      vi.unstubAllGlobals();
      frames = [];
      published = 0;
      registry = new Map();
      vi.stubGlobal(
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      vi.stubGlobal("cancelAnimationFrame", () => undefined);
      vi.stubGlobal("Highlight", FakeHighlight);
      vi.stubGlobal("CSS", {
        highlights: {
          set: (name: string, value: { ranges: Range[] }) => {
            if (name === "pine-side-chat") published++;
            registry.set(name, value);
          },
        },
      });
    });

    /** Lets the MutationObserver deliver, then runs the queued frames. */
    async function settle(): Promise<number> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const pending = frames;
      frames = [];
      for (const callback of pending) callback(0);
      return pending.length;
    }

    function messageRoot(id: string, text: string): HTMLElement {
      const root = document.createElement("div");
      root.dataset.messageId = id;
      const prose = document.createElement("div");
      prose.className = "transcript-prose";
      prose.textContent = text;
      root.append(prose);
      return root;
    }

    function marked(): string[] {
      return (registry.get("pine-side-chat")?.ranges ?? []).map((range) =>
        range.toString(),
      );
    }

    async function mount(children: HTMLElement[]) {
      const container = document.createElement("div");
      container.append(...children);
      document.body.append(container);
      const scope = effectScope();
      scope.run(() =>
        useSideChatHighlights({
          container: ref(container),
          enabled: ref(true),
          highlights: ref([highlight]),
          activeSideChatId: ref(undefined),
          entryIdOf: (id) => id,
          open: () => undefined,
        }),
      );
      await nextTick();
      await settle();
      return {
        container,
        stop: () => {
          scope.stop();
          container.remove();
        },
      };
    }

    it("ignores streaming into messages without a follow-up", async () => {
      const streaming = messageRoot("message-2", "Streaming");
      const view = await mount([
        messageRoot("message-1", "Hello world"),
        streaming,
      ]);
      expect(marked()).toEqual(["Hello"]);
      expect(published).toBe(1);

      const prose = streaming.firstElementChild!;
      for (let index = 0; index < 5; index++) {
        prose.append(document.createTextNode(` token ${index}`));
        (prose.firstChild as Text).data += "!";
        expect(await settle()).toBe(0);
      }
      expect(published).toBe(1);
      view.stop();
    });

    it("does not republish when a re-place finds the same ranges", async () => {
      const root = messageRoot("message-1", "Hello world");
      const view = await mount([root]);
      expect(published).toBe(1);

      root.append(document.createElement("span"));
      expect(await settle()).toBe(1);
      expect(published).toBe(1);
      expect(marked()).toEqual(["Hello"]);
      view.stop();
    });

    it("re-places a highlight when its message re-renders", async () => {
      const root = messageRoot("message-1", "Hello world");
      const view = await mount([root]);
      const before = registry.get("pine-side-chat")!.ranges[0];

      root.firstElementChild!.textContent = "Hello again";
      expect(await settle()).toBe(1);
      expect(published).toBe(2);
      const after = registry.get("pine-side-chat")!.ranges[0];
      expect(after).not.toBe(before);
      expect(after.startContainer.isConnected).toBe(true);
      expect(marked()).toEqual(["Hello"]);

      // The whole message element replaced by a fresh one.
      const replacement = messageRoot("message-1", "Hello there");
      root.replaceWith(replacement);
      expect(await settle()).toBe(1);
      expect(published).toBe(3);
      const replaced = registry.get("pine-side-chat")!.ranges[0];
      expect(replacement.contains(replaced.startContainer)).toBe(true);
      view.stop();
    });

    it("marks a highlighted message that mounts later", async () => {
      const view = await mount([messageRoot("message-0", "Earlier")]);
      expect(marked()).toEqual([]);
      expect(published).toBe(0);

      const wrapper = document.createElement("div");
      wrapper.append(messageRoot("message-1", "Hello world"));
      view.container.append(wrapper);
      expect(await settle()).toBe(1);
      expect(marked()).toEqual(["Hello"]);
      view.stop();
    });

    it("drops the mark when its message unmounts", async () => {
      const root = messageRoot("message-1", "Hello world");
      const view = await mount([root, messageRoot("message-2", "Other")]);
      expect(marked()).toEqual(["Hello"]);

      root.remove();
      expect(await settle()).toBe(1);
      expect(marked()).toEqual([]);
      view.stop();
    });
  });
});
