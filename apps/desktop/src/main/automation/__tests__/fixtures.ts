import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AutomationSpec } from "../../../shared/automation";
import type { PineProject } from "../../../shared/projects";
import type { TinyFishSafeStorage } from "../../tinyfishCredentials";

export const PROJECT_ID = "6b0f3f3e-8a0a-4d3c-9f43-2a5b1d1c0e11";

/** Reversible stand-in for the OS credential store. */
export const fakeStorage: TinyFishSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${text}`, "utf8"),
  decryptString: (buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
};

export async function temporaryProject(): Promise<{
  root: string;
  docs: string;
  project: PineProject;
}> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "pine-automation-")),
  );
  const docs = path.join(root, "docs");
  await mkdir(docs, { recursive: true });
  const now = new Date().toISOString();
  return {
    root,
    docs,
    project: {
      id: PROJECT_ID,
      name: "Test project",
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      defaultFolderId: "docs",
      folders: [
        {
          id: "docs",
          name: "Docs",
          path: docs,
          access: "read-write",
          isAvailable: true,
        },
      ],
    },
  };
}

export function manualSpec(
  overrides: Partial<AutomationSpec> = {},
): AutomationSpec {
  return {
    version: 1,
    name: "Daily summary",
    enabled: true,
    triggers: [{ kind: "manual" }],
    action: {
      kind: "agent",
      instructions: "Summarize the new files into reports/summary.md.",
      session: "new",
      permissions: {
        read: [{ folderId: "docs" }],
        write: [{ folderId: "docs", path: "reports" }],
        network: [],
        tools: ["read", "write"],
      },
    },
    delivery: { notify: "on-findings" },
    ...overrides,
  };
}
