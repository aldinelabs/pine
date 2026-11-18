import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { LiveContextEvent, LiveContextStatus } from "@/shared/liveContext";
import WorkbenchLiveContextPanel from "../WorkbenchLiveContextPanel.vue";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    activeSession: { id: "session-1" },
    projectOf: () => PROJECT_ID,
  }),
}));
vi.mock("@/stores/project", () => ({
  useProjectStore: () => ({ currentProjectId: PROJECT_ID }),
}));

const idle: LiveContextStatus = { available: true, state: "idle", sources: [] };
const listeningHere: LiveContextStatus = {
  available: true,
  state: "listening",
  projectId: PROJECT_ID,
  sessionId: "session-1",
  sources: ["mic", "system"],
  startedAt: 0,
};

function stubApi(status: LiveContextStatus) {
  let emit: (event: LiveContextEvent) => void = () => undefined;
  const api = {
    status: vi.fn().mockResolvedValue(status),
    start: vi.fn().mockResolvedValue(listeningHere),
    pause: vi.fn().mockResolvedValue({ ...listeningHere, state: "paused" }),
    resume: vi.fn().mockResolvedValue(listeningHere),
    stop: vi.fn().mockResolvedValue(idle),
    transcript: vi.fn().mockResolvedValue([
      {
        id: "a",
        source: "system",
        start: 0,
        end: 1,
        text: "期末考第五章",
        final: true,
      },
    ]),
    subscribe: vi.fn((listener: (event: LiveContextEvent) => void) => {
      emit = listener;
      return () => undefined;
    }),
  };
  vi.stubGlobal("pine", { liveContext: api });
  return { api, emit: (event: LiveContextEvent) => emit(event) };
}

async function mountPanel() {
  setActivePinia(createPinia());
  const wrapper = mount(WorkbenchLiveContextPanel, {
    global: { plugins: [createAppI18n("en-US")] },
  });
  await flushPromises();
  return wrapper;
}

describe("WorkbenchLiveContextPanel", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("explains why it is unavailable", async () => {
    stubApi({ ...idle, available: false, unavailableReason: "platform" });
    const wrapper = await mountPanel();
    expect(wrapper.get("[data-testid=live-context-unavailable]").text()).toBe(
      "Live context needs macOS 26 or later.",
    );
  });

  it("starts both sources for the active session and shows its saved transcript", async () => {
    const { api } = stubApi(idle);
    const wrapper = await mountPanel();
    expect(api.transcript).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sessionId: "session-1",
    });
    expect(wrapper.text()).toContain("期末考第五章");

    await wrapper.get("[data-testid=live-context-start]").trigger("click");
    await flushPromises();
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        sessionId: "session-1",
        sources: ["mic", "system"],
      }),
    );
    expect(wrapper.find("[data-testid=live-context-stop]").exists()).toBe(true);
  });

  it("shows volatile text muted after the final text, and stops", async () => {
    const { api, emit } = stubApi(listeningHere);
    const wrapper = await mountPanel();
    emit({
      kind: "segment",
      sessionId: "session-1",
      segment: {
        id: "b",
        source: "mic",
        start: 2,
        end: 3,
        text: "那评审",
        final: false,
      },
    });
    await flushPromises();
    const items = wrapper.findAll("[data-testid=live-context-transcript] li");
    expect(items.map((item) => item.text())).toEqual([
      expect.stringContaining("Others"),
      expect.stringContaining("Me"),
    ]);
    expect(items[1]?.attributes("data-final")).toBeUndefined();

    await wrapper.get("[data-testid=live-context-stop]").trigger("click");
    await flushPromises();
    expect(api.stop).toHaveBeenCalled();
  });

  it("offers to stop a capture that belongs to another session", async () => {
    stubApi({ ...listeningHere, sessionId: "session-2" });
    const wrapper = await mountPanel();
    expect(
      wrapper.get("[data-testid=live-context-elsewhere]").text(),
    ).toContain("Another conversation is capturing live context.");
    expect(wrapper.find("[data-testid=live-context-start]").exists()).toBe(
      false,
    );
  });
});
