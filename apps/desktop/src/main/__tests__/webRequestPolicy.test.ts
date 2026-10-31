import { describe, expect, it } from "vitest";
import { webRequestProjects } from "../webRequestPolicy";

const projectId = "7f48c81c-f1dc-4be6-a8ee-55729ef647ba";
const sessionId = "0198e338-fb55-7e18-a23e-a7028500f123";
const lookup = {
  sessionProject: () => projectId,
  interactionProject: () => projectId,
};

describe("browser request policy", () => {
  it("requires explicit exposure rather than exposing all registered IPC methods", () => {
    for (const channel of [
      "window:close",
      "web-control:set",
      "attachments:pick",
      "unknown",
    ])
      expect(() => webRequestProjects(channel, {}, lookup)).toThrow(
        "unavailable",
      );
  });
  it("resolves resource scope for project, session and interaction operations", () => {
    expect(
      webRequestProjects("sessions:prompt", { target: { projectId } }, lookup),
    ).toEqual([projectId]);
    expect(webRequestProjects("sessions:abort", { sessionId }, lookup)).toEqual(
      [projectId],
    );
    expect(
      webRequestProjects(
        "sessions:approval-response",
        { requestId: sessionId },
        lookup,
      ),
    ).toEqual([projectId]);
    expect(
      webRequestProjects(
        "project-files:set-watched-directories",
        { folders: [{ projectId }, { projectId }] },
        lookup,
      ),
    ).toEqual([projectId]);
    expect(() => webRequestProjects("sessions:abort", {}, lookup)).toThrow();
  });
});
