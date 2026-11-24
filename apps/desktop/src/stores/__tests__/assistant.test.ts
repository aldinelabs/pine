import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ASSISTANT_SETTINGS } from "@/shared/assistant";
import { useAssistantStore } from "../assistant";

const session = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "c",
  updatedAt: "u",
  messageCount: 2,
};

function stubApi() {
  const api = {
    getAssistant: vi.fn().mockResolvedValue({
      session,
      settings: { approvalMode: "let-me-review", wakesOnReport: true },
    }),
    setAssistantSettings: vi
      .fn()
      .mockImplementation((settings: unknown) => Promise.resolve(settings)),
    clearAssistant: vi.fn().mockResolvedValue({ cleared: true }),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: api });
  return api;
}

describe("the Assistant store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("starts from the defaults and loads the conversation and settings", async () => {
    const api = stubApi();
    const store = useAssistantStore();
    expect(store.settings).toEqual(DEFAULT_ASSISTANT_SETTINGS);

    await Promise.all([store.load(), store.load()]);

    expect(api.getAssistant).toHaveBeenCalledOnce();
    expect(store.isLoaded).toBe(true);
    expect(store.session?.id).toBe(session.id);
    expect(store.settings.approvalMode).toBe("let-me-review");
  });

  it("saves settings as main returns them", async () => {
    const api = stubApi();
    const store = useAssistantStore();

    await store.saveSettings({
      approvalMode: "autonomous",
      wakesOnReport: false,
      costReminderUsd: 5,
    });

    expect(api.setAssistantSettings).toHaveBeenCalledWith({
      approvalMode: "autonomous",
      wakesOnReport: false,
      costReminderUsd: 5,
    });
    expect(store.settings.approvalMode).toBe("autonomous");
  });

  it("forgets the conversation once cleared", async () => {
    stubApi();
    const store = useAssistantStore();
    await store.load();

    await expect(store.clear()).resolves.toBe(true);

    expect(store.session).toBeNull();
  });

  it("counts asks for its settings", () => {
    stubApi();
    const store = useAssistantStore();
    store.requestSettings();
    store.requestSettings();
    expect(store.settingsRequests).toBe(2);
  });

  it("fails to load without breaking a window that lacks the API", async () => {
    Object.defineProperty(window, "pine", { configurable: true, value: {} });
    await expect(useAssistantStore().load()).rejects.toThrow();
  });
});
