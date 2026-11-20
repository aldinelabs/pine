import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import cacache from "cacache";
import { afterEach, describe, expect, it } from "vitest";
import type { PineApprovalMode } from "../../shared/agent";
import {
  createSubmitArtifactToolDefinition,
  type SubmitArtifactDetails,
} from "../submitArtifactTool";
import { submissionEntryKey } from "../artifactStore";
import { PineToolAccessPolicy } from "../tool-access-policy";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup(
  approvalMode: PineApprovalMode = "auto-approve",
  versions: { snapshotLimit?: number } | false = false,
) {
  const root = await realpath(
    await mkdtemp(
      path.join(
        process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
        "pine-submit-",
      ),
    ),
  );
  roots.push(root);
  const readWrite = path.join(root, "workspace");
  const readOnly = path.join(root, "context");
  const outside = path.join(root, "private");
  await Promise.all([mkdir(readWrite), mkdir(readOnly), mkdir(outside)]);
  const policy = await PineToolAccessPolicy.create(readWrite, [
    { access: "read-write", path: readWrite },
    { access: "read-only", path: readOnly },
  ]);
  const tool = createSubmitArtifactToolDefinition({
    cwd: readWrite,
    policy,
    permissivePolicy: PineToolAccessPolicy.permissive(readWrite),
    getApprovalMode: () => approvalMode,
    ...(versions
      ? { versionStore: path.join(root, "store"), ...versions }
      : {}),
  });
  const context = {
    sessionManager: { getSessionId: () => "session-1" },
  } as never;
  const submit = (
    files: { path: string; title?: string; description?: string }[],
  ) => tool.execute("submit-call", { files }, undefined, undefined, context);
  return {
    outside,
    readOnly,
    readWrite,
    store: path.join(root, "store"),
    submit,
    tool,
  };
}

function detailsOf(result: { details?: unknown }): SubmitArtifactDetails {
  return result.details as SubmitArtifactDetails;
}

function textOf(result: { content: { type: string; text?: string }[] }) {
  return result.content.map((block) => block.text ?? "").join("");
}

describe("ui_submit_artifact", () => {
  it("takes a batch of files with optional labels", async () => {
    const { tool } = await setup();
    const files = (
      tool.parameters as unknown as {
        properties: {
          files: {
            minItems: number;
            maxItems: number;
            items: { required?: string[] };
          };
        };
      }
    ).properties.files;
    expect(files.minItems).toBe(1);
    expect(files.maxItems).toBe(50);
    expect(files.items.required).toEqual(["path"]);
  });

  it("tells the agent to batch deliverables and present one in parallel", async () => {
    const { tool } = await setup();
    expect(tool.description).toContain("one call");
    expect(tool.description).toContain("ui_present_file");
    expect(tool.description).toContain("in parallel");
  });

  it("accepts files in shared folders by canonical path, in the given order", async () => {
    const { readOnly, readWrite, submit } = await setup();
    await writeFile(path.join(readWrite, "report.md"), "# Report");
    await writeFile(path.join(readOnly, "data.csv"), "a,b");

    const result = await submit([
      { path: "report.md", title: " Report ", description: "Summary" },
      { path: path.join(readOnly, "data.csv") },
    ]);

    expect(detailsOf(result)).toEqual({
      files: [
        {
          path: path.join(readWrite, "report.md"),
          requestedPath: "report.md",
          title: "Report",
          description: "Summary",
        },
        {
          path: path.join(readOnly, "data.csv"),
          requestedPath: path.join(readOnly, "data.csv"),
        },
      ],
      rejected: [],
    });
    const text = textOf(result);
    expect(text).toContain("Submitted 2 file(s)");
    expect(text).toContain(`- ${path.join(readWrite, "report.md")} — Report`);
    expect(text).toContain("present the most significant file");
  });

  it("rejects directories, missing and outside files one by one", async () => {
    const { outside, readWrite, submit } = await setup();
    await writeFile(path.join(readWrite, "ok.txt"), "ok");
    await mkdir(path.join(readWrite, "folder"));
    await writeFile(path.join(outside, "secret.txt"), "secret");

    const result = await submit([
      { path: "folder" },
      { path: "missing.txt" },
      { path: path.join(outside, "secret.txt") },
      { path: "ok.txt" },
    ]);

    const details = detailsOf(result);
    expect(details.files.map((file) => file.requestedPath)).toEqual(["ok.txt"]);
    expect(details.rejected.map((file) => file.path)).toEqual([
      "folder",
      "missing.txt",
      path.join(outside, "secret.txt"),
    ]);
    expect(details.rejected[0]?.reason).toBe("not a regular file");
    expect(details.rejected[1]?.reason).toBe("file not found");
    expect(details.rejected[2]?.reason).toBeTruthy();
    expect(textOf(result)).toContain("Rejected 3:");
  });

  it("accepts an outside file in YOLO mode", async () => {
    const { outside, submit } = await setup("YOLO");
    await writeFile(path.join(outside, "notes.txt"), "notes");

    const result = await submit([{ path: path.join(outside, "notes.txt") }]);

    expect(detailsOf(result).files[0]?.path).toBe(
      path.join(outside, "notes.txt"),
    );
  });

  it("fails with the reasons when no file is accepted", async () => {
    const { submit } = await setup();
    await expect(
      submit([{ path: "missing.txt" }, { path: "  " }]),
    ).rejects.toThrow(
      /No file was submitted\.[\s\S]*missing\.txt: file not found[\s\S]*empty path/,
    );
  });

  it("collapses a path given twice to its first position with the last labels", async () => {
    const { readWrite, submit } = await setup();
    await writeFile(path.join(readWrite, "a.md"), "a");
    await writeFile(path.join(readWrite, "b.md"), "b");

    const result = await submit([
      { path: "a.md", title: "First" },
      { path: "b.md", title: "  ", description: "" },
      { path: "./a.md", title: "Second", description: "Final" },
    ]);

    expect(detailsOf(result).files).toEqual([
      {
        path: path.join(readWrite, "a.md"),
        requestedPath: "a.md",
        title: "Second",
        description: "Final",
      },
      { path: path.join(readWrite, "b.md"), requestedPath: "b.md" },
    ]);
  });

  it("tells the agent to submit again after each revision", async () => {
    const { tool } = await setup();
    expect(tool.description).toContain("finish revising a deliverable");
    expect(tool.description).toContain("restore");
  });

  it("keeps a copy of each submitted file in the version store", async () => {
    const { readWrite, store, submit } = await setup("auto-approve", {});
    const report = path.join(readWrite, "report.md");
    await writeFile(report, "# Draft 1");

    const [file] = detailsOf(await submit([{ path: "report.md" }])).files;

    expect(file.snapshot).toMatchObject({ status: "stored", size: 9 });
    const snapshot = file.snapshot as { integrity: string };
    const stored = await cacache.get(
      store,
      submissionEntryKey("session-1", "submit-call", report),
    );
    expect(stored.integrity).toBe(snapshot.integrity);
    expect(stored.data.toString()).toBe("# Draft 1");
    expect(stored.metadata).toMatchObject({
      kind: "submission",
      sessionId: "session-1",
      path: report,
      toolCallId: "submit-call",
    });
  });

  it("records a file too large to copy without failing the submission", async () => {
    const { readWrite, submit } = await setup("auto-approve", {
      snapshotLimit: 4,
    });
    await writeFile(path.join(readWrite, "big.bin"), "12345678");

    const [file] = detailsOf(await submit([{ path: "big.bin" }])).files;

    expect(file.snapshot).toMatchObject({
      status: "skipped",
      reason: "too-large",
      size: 8,
    });
  });

  it("keeps no copies without a version store", async () => {
    const { readWrite, submit } = await setup();
    await writeFile(path.join(readWrite, "report.md"), "# Report");

    const [file] = detailsOf(await submit([{ path: "report.md" }])).files;

    expect(file.snapshot).toBeUndefined();
  });
});
