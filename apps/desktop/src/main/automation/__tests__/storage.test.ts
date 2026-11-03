import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { redactJson, redactText } from "../../../shared/automationRedaction";
import { diffFolder, scanFolder, signatureKey } from "../folder";
import { AutomationSecretStore } from "../secrets";
import {
  AutomationStore,
  newRunId,
  type AutomationRunRecord,
  type StoredAutomation,
} from "../store";
import { toStoredSpec } from "../validate";
import {
  PROJECT_ID,
  fakeStorage,
  manualSpec,
  temporaryProject,
} from "./fixtures";

let root: string;
let docs: string;

beforeEach(async () => {
  ({ root, docs } = await temporaryProject());
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function record(): StoredAutomation {
  const now = new Date().toISOString();
  return {
    id: "a1",
    projectId: PROJECT_ID,
    revision: 1,
    spec: toStoredSpec(manualSpec()),
    createdAt: now,
    updatedAt: now,
  };
}

function run(id: string, startedAt: Date, kept = false): AutomationRunRecord {
  return {
    id,
    automationId: "a1",
    projectId: PROJECT_ID,
    revision: 1,
    automationName: "Daily summary",
    status: "nothing",
    trigger: "manual",
    startedAt: startedAt.toISOString(),
    events: [],
    eventCount: 0,
    payload: null,
    read: true,
    kept,
  };
}

describe("AutomationStore", () => {
  it("keeps every revision", async () => {
    const store = new AutomationStore(path.join(root, "projects"));
    const first = record();
    await store.write(first, true);
    await store.write(
      { ...first, revision: 2, spec: { ...first.spec, name: "Renamed" } },
      true,
    );
    expect((await store.read(PROJECT_ID, "a1"))?.spec.name).toBe("Renamed");
    expect((await store.readRevision(PROJECT_ID, "a1", 1))?.spec.name).toBe(
      "Daily summary",
    );
    expect(await store.list(PROJECT_ID)).toHaveLength(1);
  });

  it("prunes old runs but keeps the ones the user kept", async () => {
    const store = new AutomationStore(path.join(root, "projects"));
    await store.write(record(), true);
    const old = new Date(Date.now() - 120 * 86_400_000);
    await store.writeRun(run(newRunId(old.getTime()), old));
    await store.writeRun(run(newRunId(old.getTime()), old, true));
    await store.writeRun(run(newRunId(), new Date()));
    await store.pruneRuns(PROJECT_ID, "a1");
    const runs = await store.listRuns(PROJECT_ID, "a1");
    expect(runs).toHaveLength(2);
    expect(runs.some((entry) => entry.kept)).toBe(true);
  });

  it("rejects ids that could leave its directory", () => {
    const store = new AutomationStore(path.join(root, "projects"));
    expect(() => store.directory(PROJECT_ID, "../x")).toThrow();
    expect(() => store.projectRoot("..")).toThrow();
  });
});

describe("AutomationSecretStore", () => {
  it("encrypts values and never lists them", async () => {
    const file = path.join(root, "secrets.json");
    const secrets = new AutomationSecretStore(() => file, fakeStorage);
    await secrets.set(PROJECT_ID, "erp-token", "ERP", "s3cret-value");
    await secrets.set(PROJECT_ID, "empty", undefined, undefined);
    expect(await readFile(file, "utf8")).not.toContain("s3cret-value");
    expect(await secrets.list(PROJECT_ID)).toMatchObject([
      { name: "erp-token", description: "ERP", hasValue: true },
      { name: "empty", hasValue: false },
    ]);
    expect(await secrets.resolve(PROJECT_ID, ["erp-token", "empty"])).toEqual([
      { name: "erp-token", value: "s3cret-value" },
    ]);
    await secrets.delete(PROJECT_ID, "erp-token");
    expect(await secrets.resolve(PROJECT_ID, ["erp-token"])).toEqual([]);
  });

  it("rejects invalid names", async () => {
    const secrets = new AutomationSecretStore(
      () => path.join(root, "s.json"),
      fakeStorage,
    );
    await expect(
      secrets.set(PROJECT_ID, "Bad Name", undefined, "value"),
    ).rejects.toThrow();
  });
});

describe("redaction", () => {
  const secrets = [
    { name: "token", value: "abcdef123" },
    { name: "long", value: "abcdef123-extra" },
    { name: "pin", value: "1234" },
  ];

  it("replaces longer values first and skips short ones", () => {
    expect(redactText("x abcdef123-extra y abcdef123 1234", secrets)).toBe(
      "x [secret:long] y [secret:token] 1234",
    );
  });

  it("redacts keys and nested values", () => {
    expect(redactJson({ abcdef123: ["abcdef123"], n: 1 }, secrets)).toEqual({
      "[secret:token]": ["[secret:token]"],
      n: 1,
    });
  });
});

describe("folder scanning", () => {
  it("applies globs and reports what changed", async () => {
    await mkdir(path.join(docs, "inbox"), { recursive: true });
    await writeFile(path.join(docs, "inbox", "a.pdf"), "a");
    await writeFile(path.join(docs, "inbox", "b.txt"), "b");
    await writeFile(path.join(docs, "inbox", "c.pdf.crdownload"), "c");
    const first = await scanFolder({ root: docs, include: ["**/*.pdf"] });
    expect([...first.files.keys()]).toEqual(["inbox/a.pdf"]);

    const processed = Object.fromEntries(
      [...first.files].map(([file, signature]) => [
        file,
        signatureKey(signature),
      ]),
    );
    await writeFile(path.join(docs, "inbox", "d.pdf"), "d");
    const later = new Date(Date.now() + 5_000);
    await writeFile(path.join(docs, "inbox", "a.pdf"), "changed");
    await utimes(path.join(docs, "inbox", "a.pdf"), later, later);
    const second = await scanFolder({ root: docs, include: ["**/*.pdf"] });
    const changes = diffFolder(processed, second.files);
    expect(
      changes.map((change) => [change.path, change.change]).sort(),
    ).toEqual([
      ["inbox/a.pdf", "changed"],
      ["inbox/d.pdf", "added"],
    ]);
    await rm(path.join(docs, "inbox", "d.pdf"));
    const third = await scanFolder({ root: docs, include: ["**/*.pdf"] });
    expect(
      diffFolder(
        Object.fromEntries(
          [...second.files].map(([file, signature]) => [
            file,
            signatureKey(signature),
          ]),
        ),
        third.files,
      ),
    ).toMatchObject([{ path: "inbox/d.pdf", change: "removed" }]);
  });
});
