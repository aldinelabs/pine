import { describe, expect, it, vi } from "vitest";
import type { LiveContextStatus } from "../../shared/liveContext";
import type { LiveContextCaptureSettings } from "../../shared/liveContextAgent";
import type { LiveContextService } from "../liveContext";
import {
  answerLiveContextCapture,
  defaultCaptureLocale,
} from "../liveContextCapture";

const HERE = { projectId: "project-1", sessionId: "session-1" };

const IDLE: LiveContextStatus = {
  available: true,
  state: "idle",
  sources: [],
  speakersAvailable: true,
};

/** A Live Context that walks through the given statuses as it is asked. */
function fakeService(
  statuses: LiveContextStatus[],
  last: Partial<LiveContextCaptureSettings> = {},
) {
  let index = 0;
  const current = () => statuses[Math.min(index, statuses.length - 1)];
  const service = {
    status: vi.fn(() => {
      const status = current();
      index += 1;
      return status;
    }),
    lastCaptureSettings: vi.fn(() => last),
    start: vi.fn(() => Promise.resolve(current())),
    pause: vi.fn(() =>
      Promise.resolve({ ...current(), state: "paused" as const }),
    ),
    resume: vi.fn(() =>
      Promise.resolve({ ...current(), state: "listening" as const }),
    ),
    stop: vi.fn(() => Promise.resolve(IDLE)),
  };
  return service as typeof service & LiveContextService;
}

const options = { uiLocale: () => "de", sleep: () => Promise.resolve() };

function capturing(extra: Partial<LiveContextStatus> = {}): LiveContextStatus {
  return {
    ...IDLE,
    state: "listening",
    ...HERE,
    sources: ["mic"],
    locale: "en-US",
    speakers: false,
    ...extra,
  };
}

describe("answerLiveContextCapture", () => {
  it("plans a start with the user's last settings, else both sources and the UI language", async () => {
    expect(
      await answerLiveContextCapture(
        fakeService([IDLE]),
        HERE,
        { op: "plan-start" },
        options,
      ),
    ).toEqual({
      outcome: "ready",
      settings: {
        sources: ["mic", "system"],
        locale: "de-DE",
        speakers: false,
      },
    });
    expect(
      await answerLiveContextCapture(
        fakeService([IDLE], {
          sources: ["system"],
          locale: "ja-JP",
          speakers: true,
        }),
        HERE,
        { op: "plan-start" },
        options,
      ),
    ).toEqual({
      outcome: "ready",
      settings: { sources: ["system"], locale: "ja-JP", speakers: true },
    });
    // What the agent asked for wins; speaker labels only where supported.
    expect(
      await answerLiveContextCapture(
        fakeService([{ ...IDLE, speakersAvailable: false }]),
        HERE,
        {
          op: "plan-start",
          sources: ["mic", "mic"],
          locale: "fr-FR",
          speakers: true,
        },
        options,
      ),
    ).toEqual({
      outcome: "ready",
      settings: { sources: ["mic"], locale: "fr-FR", speakers: false },
    });
  });

  it("maps the interface language onto a capture language", () => {
    expect(defaultCaptureLocale("zh-CN")).toBe("zh-CN");
    expect(defaultCaptureLocale("ko")).toBe("ko-KR");
    expect(defaultCaptureLocale("pt-BR")).toBe("en-US");
  });

  it("rejects arguments main does not support", async () => {
    const service = fakeService([IDLE]);
    await expect(
      answerLiveContextCapture(
        service,
        HERE,
        { op: "plan-start", locale: "xx-XX" },
        options,
      ),
    ).rejects.toThrow();
    await expect(
      answerLiveContextCapture(
        service,
        HERE,
        {
          op: "start",
          settings: { sources: ["camera"], locale: "en-US", speakers: false },
        },
        options,
      ),
    ).rejects.toThrow();
    expect(service.start).not.toHaveBeenCalled();
  });

  it("leaves another conversation's capture alone", async () => {
    for (const op of ["plan-start", "pause", "resume", "stop"] as const) {
      const service = fakeService([capturing({ sessionId: "other" })]);
      expect(
        await answerLiveContextCapture(service, HERE, { op }, options),
      ).toEqual({ outcome: "elsewhere" });
      expect(service.pause).not.toHaveBeenCalled();
      expect(service.stop).not.toHaveBeenCalled();
    }
  });

  it("says why Live Context is unavailable", async () => {
    expect(
      await answerLiveContextCapture(
        fakeService([
          { ...IDLE, available: false, unavailableReason: "helper-missing" },
        ]),
        HERE,
        { op: "plan-start" },
        options,
      ),
    ).toEqual({ outcome: "unavailable", reason: "helper-missing" });
  });

  it("reports the current capture instead of starting a second one", async () => {
    const service = fakeService([capturing()]);
    expect(
      await answerLiveContextCapture(
        service,
        HERE,
        { op: "plan-start" },
        options,
      ),
    ).toMatchObject({ outcome: "status", state: "listening" });
    expect(service.start).not.toHaveBeenCalled();
  });

  it("starts with the approved settings and waits until it settles", async () => {
    const service = fakeService([
      IDLE,
      capturing({ state: "preparing" }),
      capturing({ state: "preparing" }),
      capturing({ sources: ["mic", "system"], locale: "zh-CN" }),
    ]);
    const settings = {
      sources: ["mic", "system"] as const,
      locale: "zh-CN",
      speakers: false,
    };
    const result = await answerLiveContextCapture(
      service,
      HERE,
      {
        op: "start",
        settings: { ...settings, sources: [...settings.sources] },
      },
      options,
    );
    expect(service.start).toHaveBeenCalledWith({
      ...HERE,
      sources: ["mic", "system"],
      locale: "zh-CN",
      speakers: false,
    });
    expect(result).toEqual({
      outcome: "status",
      state: "listening",
      sources: ["mic", "system"],
      locale: "zh-CN",
      speakers: false,
    });
  });

  it("returns a missing permission so the agent can say so", async () => {
    const result = await answerLiveContextCapture(
      fakeService([
        IDLE,
        {
          ...IDLE,
          lastError: {
            code: "permission_denied",
            message: "denied",
            source: "system",
          },
        },
      ]),
      HERE,
      {
        op: "start",
        settings: { sources: ["system"], locale: "en-US", speakers: false },
      },
      options,
    );
    expect(result).toMatchObject({
      outcome: "status",
      state: "idle",
      error: { code: "permission_denied", source: "system" },
    });
  });

  it("pauses, resumes and stops only this conversation's capture", async () => {
    const idle = fakeService([IDLE]);
    expect(
      await answerLiveContextCapture(idle, HERE, { op: "stop" }, options),
    ).toEqual({ outcome: "idle" });
    expect(idle.stop).not.toHaveBeenCalled();

    const here = fakeService([capturing()]);
    expect(
      await answerLiveContextCapture(here, HERE, { op: "pause" }, options),
    ).toMatchObject({ outcome: "status", state: "paused" });
    expect(
      await answerLiveContextCapture(here, HERE, { op: "stop" }, options),
    ).toMatchObject({ outcome: "status", state: "idle" });
    expect(here.pause).toHaveBeenCalledOnce();
    expect(here.stop).toHaveBeenCalledOnce();
  });
});
