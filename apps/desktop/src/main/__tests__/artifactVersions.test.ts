import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import cacache from "cacache";
import { afterEach, describe, expect, it } from "vitest";
import { snapshotFile, submissionEntryKey } from "../../agent/artifactStore";
import type { SessionArtifact } from "../../shared/artifacts";
import {
  diffVersion,
  materializeVersion,
  pruneStore,
  readVersionHistory,
  removeSessionVersions,
  restoreVersion,
  type ArtifactHistoryInput,
} from "../artifactVersions";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-versions-"));
  roots.push(root);
  const store = path.join(root, "store");
  const file = path.join(root, "report.md");
  const submissions: SessionArtifact[] = [];
  let time = 1_000;
  /** Writes the file, then submits it as `toolCallId`. */
  async function submit(
    toolCallId: string,
    content: string,
    sessionId = "session-1",
  ) {
    await writeFile(file, content);
    time += 1_000;
    const snapshot = await snapshotFile(
      store,
      submissionEntryKey(sessionId, toolCallId, file),
      file,
      { kind: "submission", sessionId, path: file, time, toolCallId },
    );
    if (sessionId === "session-1")
      submissions.push({ toolCallId, path: file, submitted: true, snapshot });
    return snapshot;
  }
  const input = (): ArtifactHistoryInput => ({
    store,
    sessionId: "session-1",
    path: file,
    submissions,
    restorable: true,
  });
  return { root, store, file, submit, input };
}

describe("artifact versions", () => {
  it("lists submissions newest first and marks the current one", async () => {
    const { submit, input } = await setup();
    await submit("call-1", "one\n");
    await submit("call-2", "two\n");

    const history = await readVersionHistory(input());

    expect(history.versions.map((version) => version.ref)).toEqual([
      { kind: "submission", toolCallId: "call-2" },
      { kind: "submission", toolCallId: "call-1" },
    ]);
    expect(history.versions.map((version) => version.current)).toEqual([
      true,
      false,
    ]);
    expect(history.modified).toBe(false);
    expect(history.missing).toBe(false);
  });

  it("keeps each submission's title and description", async () => {
    const { submit, input } = await setup();
    await submit("call-1", "one\n");
    await submit("call-2", "two\n");
    const submissions = input().submissions as SessionArtifact[];
    Object.assign(submissions[0], {
      title: "Report",
      description: "First draft",
    });
    Object.assign(submissions[1], {
      title: "Report",
      description: "Adds a summary",
    });

    const history = await readVersionHistory(input());

    expect(
      history.versions.map(({ title, description }) => ({
        title,
        description,
      })),
    ).toEqual([
      { title: "Report", description: "Adds a summary" },
      { title: "Report", description: "First draft" },
    ]);
  });

  it("notices a file changed after its last submission", async () => {
    const { file, submit, input } = await setup();
    await submit("call-1", "one\n");
    await writeFile(file, "edited\n");

    const history = await readVersionHistory(input());

    expect(history.modified).toBe(true);
    expect(history.versions[0].current).toBe(false);
  });

  it("diffs a version against the current file", async () => {
    const { file, submit, input } = await setup();
    await submit("call-1", "a\nb\nc\n");
    await writeFile(file, "a\nB\nc\n");

    const diff = await diffVersion(input(), {
      kind: "submission",
      toolCallId: "call-1",
    });

    expect(diff).toEqual({
      status: "ok",
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          lines: [
            { type: "context", text: "a" },
            { type: "remove", text: "b" },
            { type: "add", text: "B" },
            { type: "context", text: "c" },
          ],
        },
      ],
      before: "a\nb\nc\n",
      after: "a\nB\nc\n",
    });
  });

  it("does not diff binary files", async () => {
    const { file, submit, input } = await setup();
    await submit("call-1", "a\0b");
    await writeFile(file, "a\0c");

    await expect(
      diffVersion(input(), { kind: "submission", toolCallId: "call-1" }),
    ).resolves.toEqual({ status: "unsupported", reason: "binary" });
  });

  it("restores a version and keeps the replaced content as a backup", async () => {
    const { file, submit, input } = await setup();
    await submit("call-1", "one\n");
    await writeFile(file, "unsaved edit\n");

    await restoreVersion(input(), { kind: "submission", toolCallId: "call-1" });

    expect(await readFile(file, "utf8")).toBe("one\n");
    const history = await readVersionHistory(input());
    const backup = history.versions.find(
      (version) => version.ref.kind === "backup",
    );
    expect(backup).toMatchObject({ state: "available", current: false });
    expect(history.versions.find((version) => version.current)?.ref).toEqual({
      kind: "submission",
      toolCallId: "call-1",
    });

    // The backup can be restored in turn.
    await restoreVersion(input(), backup!.ref);
    expect(await readFile(file, "utf8")).toBe("unsaved edit\n");
  });

  it("needs no backup when the current file is already a stored version", async () => {
    const { file, submit, input } = await setup();
    await submit("call-1", "one\n");
    await submit("call-2", "two\n");

    await restoreVersion(input(), { kind: "submission", toolCallId: "call-1" });

    expect(await readFile(file, "utf8")).toBe("one\n");
    const history = await readVersionHistory(input());
    expect(
      history.versions.some((version) => version.ref.kind === "backup"),
    ).toBe(false);
  });

  it("writes a version out for the preview", async () => {
    const { root, submit, input } = await setup();
    await submit("call-1", "one\n");
    await submit("call-2", "two\n");

    const copy = await materializeVersion(
      input(),
      { kind: "submission", toolCallId: "call-1" },
      path.join(root, "tmp"),
    );

    expect(path.basename(copy)).toBe("report.md");
    expect(await readFile(copy, "utf8")).toBe("one\n");
  });

  it("refuses a version this session never submitted", async () => {
    const { submit, input } = await setup();
    await submit("call-1", "one\n");
    await submit("other-call", "other\n", "session-2");

    await expect(
      restoreVersion(input(), { kind: "submission", toolCallId: "other-call" }),
    ).rejects.toThrow("no longer stored");
  });

  it("drops the oldest versions over the quota but keeps the newest", async () => {
    const { store, submit, input } = await setup();
    await submit("call-1", "x".repeat(100));
    await submit("call-2", "y".repeat(100));
    await submit("call-3", "z".repeat(100));

    await pruneStore(store, 150);

    const history = await readVersionHistory(input());
    expect(history.versions.map((version) => version.state)).toEqual([
      "available",
      "pruned",
      "pruned",
    ]);
  });

  it("forgets a deleted session's versions", async () => {
    const { store, submit, input } = await setup();
    const first = await submit("call-1", "one\n");
    await submit("other-call", "other\n", "session-2");

    await removeSessionVersions(store, "session-1");

    expect((await readVersionHistory(input())).versions[0].state).toBe(
      "pruned",
    );
    expect(
      await cacache.get.hasContent(
        store,
        (first as { integrity: string }).integrity,
      ),
    ).toBe(false);
    expect(Object.keys(await cacache.ls(store))).toEqual([
      submissionEntryKey(
        "session-2",
        "other-call",
        path.join(path.dirname(store), "report.md"),
      ),
    ]);
  });
});
