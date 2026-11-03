import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PineProject } from "../../../shared/projects";
import {
  buildWarnings,
  fromStoredSpec,
  grantCovers,
  removedToolsOf,
  toStoredSpec,
  validateAutomationSpec,
} from "../validate";
import { manualSpec, temporaryProject } from "./fixtures";

let root: string;
let project: PineProject;

beforeEach(async () => {
  ({ root, project } = await temporaryProject());
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function environment(secrets: { name: string; hasValue: boolean }[] = []) {
  return {
    project,
    secrets,
    systemEvents: new Set(["app-start", "resume", "unlock", "idle"]),
  };
}

describe("validateAutomationSpec", () => {
  it("accepts a complete definition and returns its facts", async () => {
    const result = await validateAutomationSpec(manualSpec(), environment());
    expect(result.errors).toEqual([]);
    expect(result.facts?.write).toEqual([
      { folderId: "docs", folderName: "Docs", path: "reports" },
    ]);
  });

  it("rejects unknown fields structurally", async () => {
    const result = await validateAutomationSpec(
      { ...manualSpec(), extra: true },
      environment(),
    );
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports semantic problems in one pass", async () => {
    const spec = manualSpec({
      triggers: [
        { kind: "schedule", rrule: "FREQ=MINUTELY;INTERVAL=1" },
        { kind: "system", event: "idle" },
      ],
      delivery: { notify: "always", outputs: [{ folderId: "docs" }] },
      secrets: [{ name: "erp-token" }],
    });
    spec.action.permissions.tools.push("ask_user_question");
    spec.action.permissions.read.push({ folderId: "gone" });
    const errors = (
      await validateAutomationSpec(spec, environment())
    ).errors.join("\n");
    expect(errors).toMatch(/more often than every 5 minutes/);
    expect(errors).toMatch(/idleMinutes is required/);
    expect(errors).toMatch(/unknown or unavailable tools ask_user_question/);
    expect(errors).toMatch(/gone/);
    expect(errors).toMatch(/outside action\.permissions\.write/);
    expect(errors).toMatch(/"erp-token" does not exist/);
  });

  it("requires secrets to have values", async () => {
    const spec = manualSpec({ secrets: [{ name: "erp-token" }] });
    const { errors } = await validateAutomationSpec(
      spec,
      environment([{ name: "erp-token", hasValue: false }]),
    );
    expect(errors.join()).toMatch(/has no value yet/);
  });

  it("checks script syntax and interval", async () => {
    const spec = manualSpec({
      triggers: [
        {
          kind: "script",
          every: "PT1M",
          source: "function poll() {}",
          capabilities: { network: [], read: [] },
        },
      ],
    });
    const errors = (
      await validateAutomationSpec(spec, environment())
    ).errors.join("\n");
    expect(errors).toMatch(/at least PT5M/);
    expect(errors).toMatch(/export default/);
  });
});

describe("stored definitions", () => {
  it("stores tools by id and restores their names", () => {
    const stored = toStoredSpec(manualSpec());
    expect(stored.action.permissions.tools).not.toContain("read");
    expect(fromStoredSpec(stored).action.permissions.tools).toEqual([
      "read",
      "write",
    ]);
  });

  it("names tools a stored definition can no longer use", () => {
    const stored = toStoredSpec(manualSpec());
    stored.action.permissions.tools.push(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(removedToolsOf(stored)).toHaveLength(1);
  });
});

describe("grants and warnings", () => {
  it("treats a parent grant as covering its subfolders", () => {
    expect(
      grantCovers([{ folderId: "docs" }], { folderId: "docs", path: "a/b" }),
    ).toBe(true);
    expect(
      grantCovers([{ folderId: "docs", path: "a" }], {
        folderId: "docs",
        path: "ab",
      }),
    ).toBe(false);
  });

  it("warns when a watched folder is also written", () => {
    const spec = manualSpec({
      triggers: [{ kind: "folder", folderId: "docs", events: ["added"] }],
    });
    expect(
      buildWarnings(spec, project).map((warning) => warning.code),
    ).toContain("folder-overlaps-write");
  });
});
