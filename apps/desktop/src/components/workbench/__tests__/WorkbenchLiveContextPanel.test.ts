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
    openSession: vi.fn(),
    ensureOpen: vi.fn(),
  });
});

vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    get activeSession() {
      return mocks.activeSession;
    },
    projectOf: () => PROJECT_ID,
    allRecentSessions: [
      { id: "session-2", name: "Design review", projectId: PROJECT_ID },
    ],
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
      openSession: mocks.openSession,
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
    skipSpeakers: vi.fn().mockResolvedValue(listeningHere),
    openPrivacySettings: vi.fn().mockResolvedValue(undefined),
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
    attachTo: document.body,
    global: { plugins: [createAppI18n("en-US")] },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const mounted: { unmount(): void }[] = [];

describe("WorkbenchLiveContextPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mocks.activeSession = { id: "session-1" };
    mocks.activeSessionTab = null;
    mocks.createLiveContextSession.mockReset();
    mocks.bindSession.mockReset();
    mocks.openSession.mockReset();
    mocks.ensureOpen.mockReset();
    mocks.ensureOpen.mockResolvedValue({ opened: true });
  });
  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("explains why it is unavailable", async () => {
    stubApi({ ...idle, available: false, unavailableReason: "platform" });
    const wrapper = await mountPanel();
    const unavailable = wrapper.get("[data-testid=live-context-unavailable]");
    expect(unavailable.text()).toContain("Live context needs macOS 26");
    expect(unavailable.text()).toContain(
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
    expect(items[0]?.get("p").attributes("data-final")).toBe("true");
    expect(items[1]?.get("p").attributes("data-final")).toBeUndefined();

    await wrapper.get("[data-testid=live-context-stop]").trigger("click");
    await flushPromises();
    expect(api.stop).toHaveBeenCalled();
  });

  it("names a capture in another session, opens it and offers to stop it", async () => {
    const { api } = stubApi({ ...listeningHere, sessionId: "session-2" });
    const wrapper = await mountPanel();
    const notice = wrapper.get("[data-testid=live-context-elsewhere]");
    expect(notice.text()).toContain(
      "Another conversation is capturing live context.",
    );
    expect(notice.text()).toContain("Design review");
    expect(wrapper.find("[data-testid=live-context-start]").exists()).toBe(
      false,
    );
    const show = notice
      .findAll("button")
      .find((button) => button.text() === "Show");
    await show?.trigger("click");
    expect(mocks.openSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-2" }),
      PROJECT_ID,
    );
    await wrapper.get("[data-testid=live-context-stop]").trigger("click");
    await flushPromises();
    expect(api.stop).toHaveBeenCalled();
  });

  it("offers speaker labels as a toggle in the row, off by default", async () => {
    const { api } = stubApi({ ...idle, speakersAvailable: true });
    const wrapper = await mountPanel();
    const toggle = wrapper.get("[data-testid=live-context-identify-speakers]");
    expect(toggle.attributes("aria-pressed")).toBe("false");
    expect(toggle.attributes("aria-label")).toBe("Identify speakers");
    expect(toggle.attributes("title")).toContain("30 MB");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-pressed")).toBe("true");
    await wrapper.get("[data-testid=live-context-start]").trigger("click");
    await flushPromises();
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({ speakers: true }),
    );
  });

  it("leaves speakers out when this build cannot label them, and out of the language menu", async () => {
    stubApi({ ...idle, speakersAvailable: true });
    const wrapper = await mountPanel();
    await wrapper.get("[data-testid=live-context-options]").trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("Language");
    expect(
      document.querySelector(
        "[role=menu] [data-testid=live-context-identify-speakers]",
      ),
    ).toBeNull();
    wrapper.unmount();

    stubApi(idle);
    const without = await mountPanel();
    expect(
      without.find("[data-testid=live-context-identify-speakers]").exists(),
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

  it("invites a first capture when there is no transcript yet", async () => {
    stubApi(idle, { segments: [], speakers: { names: {}, merges: {} } });
    const wrapper = await mountPanel();
    expect(wrapper.get("[data-testid=live-context-empty]").text()).toContain(
      "Audio is never saved",
    );
    expect(wrapper.get("[data-testid=live-context-start]").text()).toBe(
      "Start",
    );
  });

  it("continues an existing transcript", async () => {
    stubApi(idle);
    const wrapper = await mountPanel();
    expect(wrapper.get("[data-testid=live-context-start]").text()).toBe(
      "Continue",
    );
  });

  it("keeps at least one source on", async () => {
    const { api } = stubApi(idle);
    const wrapper = await mountPanel();
    const mic = wrapper.get("[data-source=mic]");
    const system = wrapper.get("[data-source=system]");
    await mic.trigger("click");
    expect(mic.attributes("aria-pressed")).toBe("false");
    await system.trigger("click");
    expect(system.attributes("aria-pressed")).toBe("true");
    await wrapper.get("[data-testid=live-context-start]").trigger("click");
    await flushPromises();
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["system"] }),
    );
  });

  it("waits for the first words while listening", async () => {
    stubApi(listeningHere, {
      segments: [],
      speakers: { names: {}, merges: {} },
    });
    const wrapper = await mountPanel();
    expect(wrapper.get("[data-testid=live-context-state]").text()).toBe(
      "Listening",
    );
    expect(wrapper.get("[data-testid=live-context-waiting]").text()).toContain(
      "Listening for the first words",
    );
  });

  it("draws the input level of both sources while listening and holds it when paused", async () => {
    const { emit } = stubApi(listeningHere);
    const wrapper = await mountPanel();
    const waveform = wrapper.get("[data-testid=live-context-waveform]");
    expect(waveform.attributes("aria-label")).toBe(
      "Input level: microphone in the text colour, system audio in grey",
    );
    expect(waveform.attributes("data-paused")).toBeUndefined();
    emit({ kind: "status", status: { ...listeningHere, state: "paused" } });
    await flushPromises();
    expect(
      wrapper
        .get("[data-testid=live-context-waveform]")
        .attributes("data-paused"),
    ).toBe("true");
  });

  it("picks the spoken language from the language menu", async () => {
    const { api } = stubApi(idle);
    const wrapper = await mountPanel();
    await wrapper.get("[data-testid=live-context-options]").trigger("click");
    await flushPromises();
    const item = document.querySelector<HTMLElement>("[data-locale=ja-JP]");
    // The menu names the language in full; the button shows its short code.
    expect(item?.textContent).toContain("Japanese (Japan)");
    item?.click();
    await flushPromises();
    const button = wrapper.get("[data-testid=live-context-options]");
    expect(button.get("[data-testid=live-context-language]").text()).toBe(
      "JA (JP)",
    );
    expect(button.attributes("title")).toBe("Japanese (Japan)");
    expect(button.attributes("aria-label")).toContain("Japanese (Japan)");
    await wrapper.get("[data-testid=live-context-start]").trigger("click");
    await flushPromises();
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "ja-JP" }),
    );
  });

  it("pauses and resumes from the status bar", async () => {
    const { api } = stubApi(listeningHere);
    const wrapper = await mountPanel();
    await wrapper.get("[data-testid=live-context-pause]").trigger("click");
    await flushPromises();
    expect(api.pause).toHaveBeenCalled();
    expect(wrapper.get("[data-testid=live-context-state]").text()).toBe(
      "Paused",
    );
    await wrapper.get("[data-testid=live-context-resume]").trigger("click");
    await flushPromises();
    expect(api.resume).toHaveBeenCalled();
  });

  it("shows how much of the speaker models has come, in the row, and can skip them", async () => {
    const { api } = stubApi({
      ...listeningHere,
      state: "downloading",
      download: "speakers",
      downloadProgress: 0.42,
      downloadBytes: { received: 12_600_000, total: 29_821_670 },
    });
    const wrapper = await mountPanel();
    const bar = wrapper.get("[data-testid=live-context-status]");
    expect(bar.text()).toContain("Speaker models");
    expect(wrapper.get("[data-testid=live-context-download]").text()).toBe(
      "12 / 30 MB",
    );
    expect(
      wrapper
        .get("[data-testid=live-context-progress-ring]")
        .attributes("aria-valuenow"),
    ).toBe("42");
    // No waveform and no separate bar: one row, like when listening.
    expect(bar.find("[role=progressbar]:not(svg)").exists()).toBe(false);
    await wrapper
      .get("[data-testid=live-context-skip-speakers]")
      .trigger("click");
    await flushPromises();
    expect(api.skipSpeakers).toHaveBeenCalled();
  });

  it("can skip or stop while Start waits for the speaker models", async () => {
    const { api, emit } = stubApi(idle);
    // Start resolves only once the models are in (or given up).
    api.start.mockReturnValue(new Promise(() => undefined));
    const wrapper = await mountPanel();
    await wrapper.get("[data-testid=live-context-start]").trigger("click");
    const downloading = async () => {
      emit({
        kind: "status",
        status: {
          ...listeningHere,
          state: "downloading",
          download: "speakers",
          downloadProgress: 0.1,
          downloadBytes: { received: 3_000_000, total: 30_000_000 },
        },
      });
      await flushPromises();
    };
    await downloading();
    const skip = wrapper.get("[data-testid=live-context-skip-speakers]");
    expect(skip.attributes("disabled")).toBeUndefined();
    await skip.trigger("click");
    await flushPromises();
    expect(api.skipSpeakers).toHaveBeenCalled();

    await downloading();
    const stop = wrapper.get("[data-testid=live-context-stop]");
    expect(stop.attributes("disabled")).toBeUndefined();
    await stop.trigger("click");
    await flushPromises();
    expect(api.stop).toHaveBeenCalled();
  });

  it("shows the speech model download as a percent", async () => {
    stubApi({
      ...listeningHere,
      state: "downloading",
      download: "speech",
      downloadProgress: 0.42,
    });
    const wrapper = await mountPanel();
    expect(wrapper.get("[data-testid=live-context-download]").text()).toBe(
      "42%",
    );
    expect(
      wrapper.find("[data-testid=live-context-skip-speakers]").exists(),
    ).toBe(false);
  });

  it("retries speaker labels by restarting this capture with them", async () => {
    const { api } = stubApi({
      ...listeningHere,
      locale: "zh-CN",
      lastError: {
        code: "speaker_models_failed",
        message: "offline",
        reason: "network",
      },
    });
    const wrapper = await mountPanel();
    expect(
      wrapper.get("[data-testid=live-context-error]").attributes("data-tone"),
    ).toBe("neutral");
    await wrapper
      .get("[data-testid=live-context-retry-speakers]")
      .trigger("click");
    await flushPromises();
    expect(api.stop).toHaveBeenCalled();
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        sources: ["mic", "system"],
        locale: "zh-CN",
      }),
    );
    expect(wrapper.find("[data-testid=live-context-error]").exists()).toBe(
      false,
    );
  });

  it("asks for microphone access, opens its settings and can be dismissed", async () => {
    const { api } = stubApi({
      ...idle,
      lastError: {
        code: "permission_denied",
        message: "Microphone access is off for Pine.",
        source: "mic",
      },
    });
    const wrapper = await mountPanel();
    const notice = wrapper.get("[data-testid=live-context-error]");
    expect(notice.text()).toContain("Microphone access is off");
    await wrapper
      .get("[data-testid=live-context-open-settings]")
      .trigger("click");
    await flushPromises();
    expect(api.openPrivacySettings).toHaveBeenCalledWith("mic");
    await wrapper
      .get("[data-testid=live-context-dismiss-error]")
      .trigger("click");
    expect(wrapper.find("[data-testid=live-context-error]").exists()).toBe(
      false,
    );
  });

  it("says in plain words why speaker labels are off, not the raw error", async () => {
    stubApi({
      ...listeningHere,
      lastError: {
        code: "speaker_models_failed",
        message:
          "https://huggingface.co/…: more than the pinned 28281164 bytes",
        reason: "size",
      },
    });
    const wrapper = await mountPanel();
    const notice = wrapper.get("[data-testid=live-context-error]");
    expect(notice.text()).toContain("Speaker labels are off for this capture");
    expect(notice.text()).toContain("wasn't the expected size");
    expect(notice.text()).not.toContain("pinned");
  });

  it("explains other errors with the helper's message", async () => {
    stubApi({
      ...idle,
      lastError: { code: "helper_exited", message: "The helper stopped (1)." },
    });
    const wrapper = await mountPanel();
    const notice = wrapper.get("[data-testid=live-context-error]");
    expect(notice.text()).toContain("Live context ran into a problem");
    expect(notice.text()).toContain("The helper stopped (1).");
    expect(
      wrapper.find("[data-testid=live-context-open-settings]").exists(),
    ).toBe(false);
  });

  it("points to the system audio setting when nothing is heard", async () => {
    const { api } = stubApi({ ...listeningHere, systemSilent: true });
    const wrapper = await mountPanel();
    expect(
      wrapper.get("[data-testid=live-context-system-silent]").text(),
    ).toContain("No system audio yet");
    await wrapper
      .get("[data-testid=live-context-open-settings]")
      .trigger("click");
    await flushPromises();
    expect(api.openPrivacySettings).toHaveBeenCalledWith("system");
  });

  it("keeps one speaker's consecutive lines under one label", async () => {
    stubApi(idle, {
      segments: [
        {
          id: "a",
          source: "system",
          start: 0,
          end: 1,
          text: "一",
          final: true,
        },
        {
          id: "b",
          source: "system",
          start: 2,
          end: 3,
          text: "二",
          final: true,
        },
        { id: "c", source: "mic", start: 4, end: 5, text: "三", final: true },
        {
          id: "d",
          source: "mic",
          start: 10 * 60 * 1000,
          end: 10 * 60 * 1000 + 1,
          text: "四",
          final: true,
        },
      ],
      speakers: { names: {}, merges: {} },
    });
    const wrapper = await mountPanel();
    const items = wrapper.findAll("[data-testid=live-context-transcript] li");
    expect(items.map((item) => item.findAll("p").map((p) => p.text()))).toEqual(
      [["一", "二"], ["三"], ["四"]],
    );
  });

  it("holds the transcript's place while it loads", async () => {
    const { api } = stubApi(idle);
    api.transcript.mockReturnValue(new Promise(() => undefined));
    const wrapper = await mountPanel();
    expect(
      wrapper.find("[data-testid=live-context-transcript-loading]").exists(),
    ).toBe(true);
  });
});
