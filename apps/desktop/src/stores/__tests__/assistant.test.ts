import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistantStore } from "../assistant";

const session = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "c",
  updatedAt: "u",
  messageCount: 2,
};

describe("the Assistant store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("loads its one conversation, once however often it is asked", async () => {
    const getAssistant = vi.fn().mockResolvedValue({ session });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { getAssistant },
    });
    const store = useAssistantStore();

    await Promise.all([store.load(), store.load()]);

    expect(getAssistant).toHaveBeenCalledOnce();
    expect(store.isLoaded).toBe(true);
    expect(store.session?.id).toBe(session.id);
  });

  it("has no conversation before the first message, or once it is deleted", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { getAssistant: vi.fn().mockResolvedValue({}) },
    });
    const store = useAssistantStore();
    await store.load();
    expect(store.session).toBeNull();
  });

  it("reports a missing API as a failed load", async () => {
    Object.defineProperty(window, "pine", { configurable: true, value: {} });
    await expect(useAssistantStore().load()).rejects.toThrow();
  });
});
