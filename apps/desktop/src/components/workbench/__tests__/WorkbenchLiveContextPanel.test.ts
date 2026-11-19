import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { LiveContextEvent, LiveContextStatus } from "@/shared/liveContext";
import { useContentTabsStore } from "@/stores/contentTabs";
import WorkbenchLiveContextPanel from "../WorkbenchLiveContextPanel.vue";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

interface MockState {
  activeSession: { id: string } | null;
  activeSessionTab: {
    id: string;
    kind: "session";
    projectId: string;
    state: "draft" | "bound";
  } | null;
}

const mocks = vi.hoisted(() => {
  const state: MockState = {
    activeSession: { id: "session-1" },
    activeSessionTab: null,
  };
  return Object.assign(state, {
    createLiveContextSession: vi.fn(),
    bindSession: vi.fn(),
    ensureOpen: vi.fn(),
  });
});

vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    get activeSession() {
      return mocks.activeSession;
    },
    projectOf: () => PROJECT_ID,
    createLiveContextSession: mocks.createLiveContextSession,
  }),
}));
vi.mock("@/stores/project", () => ({
  useProjectStore: () => ({
    currentProjectId: PROJECT_ID,
    ensureOpen: mocks.ensureOpen,
  }),
}));
vi.mock("@/composables/useContentTabNavigation", async () => {
  const { computed } = await import("vue");
  return {
    useContentTabNavigation: () => ({
      activeSessionTab: computed(() => mocks.activeSessionTab),
      bindSession: mocks.bindSession,
    }),
  };
});

const idle: LiveContextStatus = { available: true, state: "idle", sources: [] };
const listeningHere: LiveContextStatus = {
  available: true,
  state: "listening",
  projectId: PROJECT_ID,
  sessionId: "session-1",
  sources: ["mic", "system"],
  startedAt: 0,
};

function stubApi(
  status: LiveContextStatus,
  transcript?: { segments: unknown[]; speakers: unknown },
) {
  let emit: (event: LiveContextEvent) => void = () => undefined;
  const api = {
    status: vi.fn().mockResolvedValue(status),
    start: vi.fn().mockResolvedValue(listeningHere),
    pause: vi.fn().mockResolvedValue({ ...listeningHere, state: "paused" }),
    resume: vi.fn().mockResolvedValue(listeningHere),
    stop: vi.fn().mockResolvedValue(idle),
    transcript: vi.fn().mockResolvedValue(
      transcript ?? {
        segments: [
          {
            id: "a",
            source: "system",
            start: 0,
            end: 1,
            text: "期末考第五章",
            final: true,
          },
        ],
        speakers: { names: {}, merges: {} },
      },
    ),
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
  beforeEach(() => {
    vi.unstubAllGlobals();
    mocks.activeSession = { id: "session-1" };
    mocks.activeSessionTab = null;
    mocks.createLiveContextSession.mockReset();
    mocks.bindSession.mockReset();
    mocks.ensureOpen.mockReset();
    mocks.ensureOpen.mockResolvedValue({ opened: true });
  });
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

  describe("on a new session's page", () => {
    const NEW_SESSION_ID = "11111111-1111-4111-8111-111111111111";

    beforeEach(() => {
      mocks.activeSession = null;
      mocks.activeSessionTab = {
        id: "session-3",
        kind: "session",
        projectId: PROJECT_ID,
        state: "draft",
      };
    });

    it("shows the controls without loading a transcript", async () => {
      const { api } = stubApi(idle);
      const wrapper = await mountPanel();
      expect(
        wrapper.get("[data-testid=live-context-start]").attributes("disabled"),
      ).toBeUndefined();
      expect(api.transcript).not.toHaveBeenCalled();
    });

    it("creates a conversation in the draft's project, binds the tab and captures into it", async () => {
      const { api } = stubApi(idle);
      const session = { id: NEW_SESSION_ID };
      mocks.createLiveContextSession.mockResolvedValue(session);
      const wrapper = await mountPanel();

      await wrapper.get("[data-testid=live-context-start]").trigger("click");
      await flushPromises();

      expect(mocks.ensureOpen).toHaveBeenCalledWith(PROJECT_ID);
      expect(mocks.createLiveContextSession).toHaveBeenCalledWith(
        PROJECT_ID,
        "auto-approve",
      );
      expect(mocks.bindSession).toHaveBeenCalledWith("session-3", session);
      expect(api.start).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          sessionId: NEW_SESSION_ID,
          sources: ["mic", "system"],
        }),
      );
      expect(mocks.bindSession.mock.invocationCallOrder[0]).toBeLessThan(
        api.start.mock.invocationCallOrder[0],
      );
    });

    it("starts the conversation with the approval mode the draft picked", async () => {
      stubApi(idle);
      mocks.createLiveContextSession.mockResolvedValue({ id: NEW_SESSION_ID });
      const wrapper = await mountPanel();
      useContentTabsStore().setDraftApprovalMode("session-3", "let-me-review");

      await wrapper.get("[data-testid=live-context-start]").trigger("click");
      await flushPromises();

      expect(mocks.createLiveContextSession).toHaveBeenCalledWith(
        PROJECT_ID,
        "let-me-review",
      );
    });

    it("creates only one conversation on a double click", async () => {
      stubApi(idle);
      let resolve: (value: { id: string }) => void = () => undefined;
      mocks.createLiveContextSession.mockReturnValue(
        new Promise((done) => (resolve = done)),
      );
      const wrapper = await mountPanel();
      const button = wrapper.get("[data-testid=live-context-start]");

      await button.trigger("click");
      await button.trigger("click");
      resolve({ id: NEW_SESSION_ID });
      await flushPromises();

      expect(mocks.createLiveContextSession).toHaveBeenCalledTimes(1);
    });

    it("starts nothing when the conversation cannot be created", async () => {
      const { api } = stubApi(idle);
      mocks.createLiveContextSession.mockRejectedValue(new Error("boom"));
      const wrapper = await mountPanel();

      await wrapper.get("[data-testid=live-context-start]").trigger("click");
      await flushPromises();

      expect(mocks.bindSession).not.toHaveBeenCalled();
      expect(api.start).not.toHaveBeenCalled();
      expect(
        wrapper.get("[data-testid=live-context-start]").attributes("disabled"),
      ).toBeUndefined();
    });
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

  it("offers speaker labels off by default and asks for them when turned on", async () => {
    const { api } = stubApi({ ...idle, speakersAvailable: true });
    const wrapper = await mountPanel();
    const toggle = wrapper.get("[data-testid=live-context-identify-speakers]");
    expect(toggle.attributes("aria-checked")).toBe("false");
    expect(wrapper.text()).toContain("Identify speakers");
    await toggle.trigger("click");
    await wrapper.get("[data-testid=live-context-start]").trigger("click");
    await flushPromises();
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({ speakers: true }),
    );
  });

  it("hides the speaker option when this build cannot label speakers", async () => {
    stubApi(idle);
    const wrapper = await mountPanel();
    expect(
      wrapper.find("[data-testid=live-context-identify-speakers]").exists(),
    ).toBe(false);
  });

  it("splits labeled segments by speaker, with names and merges applied", async () => {
    stubApi(idle, {
      segments: [
        {
          id: "a",
          source: "system",
          start: 0,
          end: 1,
          text: "大家好。好的。我补充。",
          final: true,
          turns: [
            { offset: 0, speaker: "system-1" },
            { offset: 4, speaker: "system-2" },
            { offset: 7, speaker: "system-3" },
          ],
        },
      ],
      speakers: {
        names: { "system-1": "Alice" },
        merges: { "system-3": "system-2" },
      },
    });
    const wrapper = await mountPanel();
    const chips = wrapper.findAll("[data-testid=live-context-speaker]");
    expect(
      chips.map((chip) => [chip.attributes("data-speaker"), chip.text()]),
    ).toEqual([
      ["system-1", "Alice"],
      ["system-2", "Speaker 2"],
    ]);
    expect(wrapper.text()).toContain("好的。我补充。");
  });

  it("shows unknown voices, people talking at once, echo and the aliases Pine made", async () => {
    stubApi(idle, {
      segments: [
        {
          id: "a",
          source: "system",
          start: 0,
          end: 1,
          text: "嗯。对对。",
          final: true,
          turns: [
            { offset: 0 },
            { offset: 2, speaker: "system-4", overlap: "system-1" },
          ],
        },
        {
          id: "b",
          source: "mic",
          start: 1,
          end: 2,
          text: "你好",
          final: true,
          echo: true,
          turns: [{ offset: 0, speaker: "mic-1" }],
        },
      ],
      speakers: {
        names: {},
        merges: {},
        aliases: { "system-4": "system-2" },
      },
    });
    const wrapper = await mountPanel();
    expect(
      wrapper.find("[data-testid=live-context-speaker-unknown]").text(),
    ).toBe("?");
    expect(
      wrapper
        .findAll("[data-testid=live-context-speaker]")
        .map((chip) => chip.attributes("data-speaker")),
    ).toEqual(["system-2", "system-1", "mic-1"]);
    expect(wrapper.get("[data-testid=live-context-echo]").text()).toContain(
      "Echo of system audio",
    );
  });

  it("says when speaker labels run lighter", async () => {
    stubApi({ ...listeningHere, speakersDegraded: "paused" });
    const wrapper = await mountPanel();
    expect(
      wrapper.get("[data-testid=live-context-speakers-degraded]").text(),
    ).toContain("Speaker labels are paused");
  });
});
