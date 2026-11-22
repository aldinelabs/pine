import { describe, expect, it } from "vitest";
import {
  artifactKey,
  artifactsOfCalls,
  artifactTree,
  collectArtifacts,
  legacyPresentedArtifactOfCall,
  normalizeArtifactFolder,
  submittedArtifactsOfCall,
} from "../artifacts";
import type { PineToolCall } from "../sessions";

function present(
  id: string,
  path: string,
  options: { artifact?: false; status?: PineToolCall["status"] } = {},
): PineToolCall {
  return {
    id,
    name: "ui_present_file",
    status: options.status ?? "complete",
    input: { path },
    output: {
      details: {
        path: `/abs/${path}`,
        display: "sidebar",
        ...(options.artifact === false ? { artifact: false } : {}),
      },
    },
  };
}

function submit(
  id: string,
  files: {
    path: string;
    title?: string;
    description?: string;
    folder?: string;
  }[],
  status: PineToolCall["status"] = "complete",
): PineToolCall {
  return {
    id,
    name: "ui_submit_artifact",
    status,
    input: { files },
    output:
      status === "complete"
        ? {
            details: {
              files: files.map((file) => ({
                ...file,
                path: `/abs/${file.path}`,
                requestedPath: file.path,
              })),
              rejected: [],
            },
          }
        : undefined,
  };
}

function collect(...messages: PineToolCall[][]) {
  return collectArtifacts(messages.map((calls) => artifactsOfCalls(calls)));
}

describe("session artifacts", () => {
  it("lists presentations of older sessions when nothing was submitted", () => {
    expect(
      collect([present("p1", "a.md")], [present("p2", "b.md")]).map(
        (artifact) => [artifact.toolCallId, artifact.path, artifact.submitted],
      ),
    ).toEqual([
      ["p2", "/abs/b.md", false],
      ["p1", "/abs/a.md", false],
    ]);
  });

  it("never lists a presentation marked artifact: false", () => {
    expect(collect([present("p1", "a.md", { artifact: false })])).toEqual([]);
    expect(
      legacyPresentedArtifactOfCall(present("p1", "a.md", { artifact: false })),
    ).toBeNull();
  });

  it("keeps legacy presentations until a submission completes", () => {
    expect(
      collect(
        [present("p1", "a.md")],
        [submit("s1", [{ path: "r.md" }], "running")],
      ).map((artifact) => artifact.path),
    ).toEqual(["/abs/a.md"]);
    expect(
      collect([present("p1", "a.md")], [submit("s1", [{ path: "r.md" }])]).map(
        (artifact) => artifact.path,
      ),
    ).toEqual(["/abs/r.md"]);
  });

  it("keeps legacy presentations when the only submission failed", () => {
    expect(
      collect([present("p1", "a.md")], [submit("s1", [], "error")]).map(
        (artifact) => artifact.path,
      ),
    ).toEqual(["/abs/a.md"]);
  });

  it("puts the newest batch first and keeps the order inside a batch", () => {
    const result = collect(
      [submit("s1", [{ path: "a.md" }, { path: "b.md" }])],
      [submit("s2", [{ path: "c.md" }, { path: "d.md" }])],
    );
    expect(result.map((artifact) => artifact.path)).toEqual([
      "/abs/c.md",
      "/abs/d.md",
      "/abs/a.md",
      "/abs/b.md",
    ]);
  });

  it("moves a resubmitted path to the top with its new labels", () => {
    const result = collect(
      [
        submit("s1", [
          { path: "a.md", title: "Old", description: "Before" },
          { path: "b.md" },
        ]),
      ],
      [submit("s2", [{ path: "a.md", title: "New" }])],
    );
    expect(result).toEqual([
      { toolCallId: "s2", path: "/abs/a.md", title: "New", submitted: true },
      { toolCallId: "s1", path: "/abs/b.md", submitted: true },
    ]);
  });

  it("ignores errored and unfinished calls", () => {
    expect(
      collect([
        present("p1", "a.md", { status: "error" }),
        present("p2", "b.md", { status: "running" }),
      ]),
    ).toEqual([]);
    expect(submittedArtifactsOfCall(submit("s1", [], "error"))).toEqual([]);
  });

  it("builds stable keys", () => {
    expect(artifactKey("call")).toBe("call");
    expect(artifactKey("call", "/abs/a.md")).toBe("call\n/abs/a.md");
    expect(artifactKey("call", "/abs/a.md")).toBe(
      artifactKey("call", "/abs/a.md"),
    );
  });
});

describe("artifact folders", () => {
  it("normalizes folder paths", () => {
    expect(normalizeArtifactFolder(" Reports / Week 1 ")).toBe(
      "Reports/Week 1",
    );
    expect(normalizeArtifactFolder("a\\b//./../c")).toBe("a/b/c");
    expect(normalizeArtifactFolder("/")).toBe("");
    expect(normalizeArtifactFolder("a/b/c/d/e/f")).toBe("a/b/c/d");
  });

  it("reads folders from the tool result, keeping an explicit top level", () => {
    expect(
      submittedArtifactsOfCall(
        submit("s1", [
          { path: "a.md", folder: "Reports/ Week 1" },
          { path: "b.md", folder: "" },
          { path: "c.md" },
        ]),
      ).map((artifact) => artifact.folder),
    ).toEqual(["Reports/Week 1", "", undefined]);
  });

  it("keeps a resubmission without a folder in its folder", () => {
    const result = collect(
      [
        submit("s1", [
          { path: "a.md", folder: "Reports" },
          { path: "b.md", folder: "Data" },
        ]),
      ],
      [submit("s2", [{ path: "a.md" }, { path: "b.md", folder: "" }])],
    );
    expect(result.map(({ path, folder }) => ({ path, folder }))).toEqual([
      { path: "/abs/a.md", folder: "Reports" },
      { path: "/abs/b.md", folder: "" },
    ]);
  });

  it("builds a tree with folders first, ordered by their newest file", () => {
    const tree = artifactTree([
      { name: "new", folder: "Reports/Week 2" },
      { name: "top" },
      { name: "data", folder: "Data" },
      { name: "old", folder: "Reports/Week 1" },
      { name: "summary", folder: "Reports" },
      { name: "root", folder: "" },
    ]);
    expect(tree.files.map((file) => file.name)).toEqual(["top", "root"]);
    expect(tree.folders.map((folder) => folder.path)).toEqual([
      "Reports",
      "Data",
    ]);
    const [reports] = tree.folders;
    expect(reports.files.map((file) => file.name)).toEqual(["summary"]);
    expect(reports.folders.map((folder) => [folder.name, folder.path])).toEqual(
      [
        ["Week 2", "Reports/Week 2"],
        ["Week 1", "Reports/Week 1"],
      ],
    );
  });
});
