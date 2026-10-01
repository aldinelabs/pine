// @vitest-environment node
import {
  BACKGROUND_CONTEXT,
  JsonlSessionRepo,
} from "@earendil-works/pi-agent-core";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PineSessionFileSystem } from "../sessionFileSystem";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(records: unknown[], suffix = "\n") {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-session-fs-"));
  directories.push(root);
  const sessionsRoot = path.join(root, "sessions");
  const directory = path.join(sessionsRoot, "legacy");
  await mkdir(directory, { recursive: true });
  const sessionFile = path.join(directory, "legacy_test.jsonl");
  const text =
    records
      .map((record) =>
        typeof record === "string" ? record : JSON.stringify(record),
      )
      .join("\n") + suffix;
  await writeFile(sessionFile, text, "utf8");
  const environment = new PineSessionFileSystem({ cwd: root });
  const repository = new JsonlSessionRepo({
    fileSystem: environment,
    sessionsRoot,
  });
  return { environment, repository, sessionFile, text };
}

const header = {
  type: "session",
  version: 3,
  id: "legacy-session",
  cwd: "/source",
  timestamp: "2026-01-01T00:00:00.000Z",
};

function record(
  type: string,
  id: string,
  parentId: string | null,
  fields: Record<string, unknown> = {},
) {
  return {
    type,
    id,
    parentId,
    timestamp: "2026-01-01T00:00:01.000Z",
    ...fields,
  };
}

describe("PineSessionFileSystem", () => {
  it("preserves unknown metadata and references through replay, compaction, and branching", async () => {
    const edit = record("context_edit", "edit", "user", {
      targetId: "user",
      replacement: null,
    });
    const future = record("future_metadata", "future", "edit", {
      nested: { keep: [1, 2] },
    });
    const { environment, repository, sessionFile, text } = await fixture([
      header,
      record("message", "user", null, {
        message: { role: "user", content: "Original message", timestamp: 1 },
      }),
      edit,
      future,
      record("message", "next", "future", {
        message: { role: "user", content: "After metadata", timestamp: 2 },
      }),
      record("compaction", "compact", "next", {
        firstKeptEntryId: "edit",
        summary: "Summary",
        tokensBefore: 100,
      }),
      record("branch_summary", "branch", "user", {
        fromId: "future",
        summary: "Other branch",
      }),
    ]);

    try {
      const [metadata] = await repository.list(undefined, BACKGROUND_CONTEXT);
      const session = await repository.open(metadata, BACKGROUND_CONTEXT);
      try {
        const entries = (
          await session.findEntries(undefined, BACKGROUND_CONTEXT)
        ).reverse();
        expect(entries).toHaveLength(6);
        expect(entries[1]).toMatchObject({
          type: "custom",
          customType: "pine.legacy.v3.context_edit",
          data: edit,
          parentId: entries[0].id,
        });
        expect(entries[2]).toMatchObject({
          type: "custom",
          customType: "pine.legacy.v3.future_metadata",
          data: future,
          parentId: entries[1].id,
        });
        expect(entries[3].parentId).toBe(entries[2].id);
        expect(entries[4]).toMatchObject({
          type: "compaction",
          retainedTail: [{ role: "user", content: "After metadata" }],
        });
        expect(entries[5]).toMatchObject({
          type: "branch_summary",
          parentId: entries[0].id,
          fromId: entries[2].id,
        });
        expect(
          await session.findEntries(undefined, BACKGROUND_CONTEXT),
        ).toEqual([...entries].reverse());
        expect(await readFile(sessionFile, "utf8")).toBe(text);
      } finally {
        await session.close(BACKGROUND_CONTEXT);
      }
    } finally {
      await repository.close(BACKGROUND_CONTEXT);
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it.each([
    ["malformed JSON", "{broken json}"],
    [
      "missing parent",
      record("context_edit", "edit", "missing", {
        targetId: "user",
        replacement: null,
      }),
    ],
    ["forward parent", record("future_metadata", "future", "next")],
    ["duplicate id", record("future_metadata", "user", "user")],
    ["invalid metadata", { type: "future_metadata", id: "future" }],
  ])(
    "leaves %s failures visible without rewriting the source",
    async (_label, invalid) => {
      const { environment, repository, sessionFile, text } = await fixture([
        header,
        record("message", "user", null, {
          message: { role: "user", content: "Keep me", timestamp: 1 },
        }),
        invalid,
      ]);
      try {
        const [metadata] = await repository.list(undefined, BACKGROUND_CONTEXT);
        await expect(
          repository.open(metadata, BACKGROUND_CONTEXT),
        ).rejects.toThrow();
        expect(await readFile(sessionFile, "utf8")).toBe(text);
      } finally {
        await repository.close(BACKGROUND_CONTEXT);
        await environment.cleanup(BACKGROUND_CONTEXT);
      }
    },
  );

  it("leaves a torn legacy final record to upstream recovery", async () => {
    const { environment, repository, sessionFile, text } = await fixture(
      [
        header,
        record("message", "user", null, {
          message: { role: "user", content: "Complete message", timestamp: 1 },
        }),
        '{"type":"context_edit","id":"torn',
      ],
      "",
    );
    try {
      const [metadata] = await repository.list(undefined, BACKGROUND_CONTEXT);
      const session = await repository.open(metadata, BACKGROUND_CONTEXT);
      try {
        expect(
          await session.findEntries(undefined, BACKGROUND_CONTEXT),
        ).toMatchObject([
          { type: "message", message: { content: "Complete message" } },
        ]);
        expect(await readFile(sessionFile, "utf8")).toBe(text);
      } finally {
        await session.close(BACKGROUND_CONTEXT);
      }
    } finally {
      await repository.close(BACKGROUND_CONTEXT);
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it.each([
    ["v4", { v: 4, kind: "header" }],
    ["v2", { ...header, version: 2 }],
  ])(
    "does not translate %s records or torn trailing lines",
    async (_label, otherHeader) => {
      const records = [
        otherHeader,
        record("context_edit", "edit", null),
        record("future_metadata", "torn", "edit"),
      ];
      const { environment, repository, sessionFile, text } = await fixture(
        records,
        "",
      );
      try {
        const result = await environment.openTextLineReader(
          sessionFile,
          BACKGROUND_CONTEXT,
        );
        if (!result.ok) throw result.error;
        try {
          for (const [index, expected] of text.split("\n").entries()) {
            expect(await result.value.readLine(BACKGROUND_CONTEXT)).toEqual({
              ok: true,
              value: { text: expected, terminated: index < 2 },
            });
          }
          expect(await result.value.readLine(BACKGROUND_CONTEXT)).toEqual({
            ok: true,
            value: undefined,
          });
        } finally {
          await result.value.close(BACKGROUND_CONTEXT);
        }
      } finally {
        await repository.close(BACKGROUND_CONTEXT);
        await environment.cleanup(BACKGROUND_CONTEXT);
      }
    },
  );
});
