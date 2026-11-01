import { describe, expect, it, vi } from "vitest";
import {
  createWebChannels,
  webChannel,
  webRequestProjects,
} from "../webRequestPolicy";

const projectId = "7f48c81c-f1dc-4be6-a8ee-55729ef647ba";
const sessionId = "0198e338-fb55-7e18-a23e-a7028500f123";
const lookup = {
  sessionProject: () => projectId,
  interactionProject: () => projectId,
};
const services = {
  allowAttachment: vi.fn(() => false),
  authorizePresented: vi.fn(() => Promise.resolve()),
  watchDirectories: vi.fn(() => Promise.resolve()),
  watchPreview: vi.fn(() => Promise.resolve()),
  respondWorkbench: vi.fn(),
  exportSession: vi.fn(() => Promise.resolve()),
};
const channels = createWebChannels(services);
const projectsOf = (name: string, request: unknown) =>
  webRequestProjects(webChannel(channels, name), request, lookup);

describe("browser request policy", () => {
  it("requires explicit exposure rather than exposing all registered IPC methods", () => {
    for (const channel of [
      "window:close",
      "web-control:set",
      "attachments:pick",
      "unknown",
    ])
      expect(() => webChannel(channels, channel)).toThrow("unavailable");
  });

  it("resolves resource scope for project, session and interaction operations", () => {
    expect(
      projectsOf("sessions:prompt", { target: { projectId }, message: "" }),
    ).toEqual([projectId]);
    expect(projectsOf("sessions:abort", { sessionId })).toEqual([projectId]);
    expect(
      projectsOf("sessions:approval-response", { requestId: sessionId }),
    ).toEqual([projectId]);
    expect(
      projectsOf("project-files:set-watched-directories", {
        folders: [{ projectId }, { projectId }],
      }),
    ).toEqual([projectId]);
    expect(() => projectsOf("sessions:abort", {})).toThrow();
  });

  it("keeps receipts for commands but not for queries", () => {
    expect(webChannel(channels, "sessions:prompt").repeatable).toBe(false);
    expect(webChannel(channels, "models:catalog").repeatable).toBe(true);
  });

  it("leaves file actions the browser performs itself to the browser", async () => {
    const operate = webChannel(channels, "project-files:operate");
    await expect(
      operate.prepare!({ action: "reveal", target: { projectId } }),
    ).rejects.toThrow("belongs to the browser");
    await expect(
      operate.prepare!({ action: "rename", target: { projectId } }),
    ).resolves.toBeTruthy();
  });
});
