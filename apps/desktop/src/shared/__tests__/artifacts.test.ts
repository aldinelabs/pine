import { describe, expect, it } from "vitest";
import {
  artifactKey,
  artifactsOfCalls,
  collectArtifacts,
  legacyPresentedArtifactOfCall,
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
  files: { path: string; title?: string; description?: string }[],
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

  it("ignores legacy presentations once any submission exists, even a running one", () => {
    expect(
      collect([present("p1", "a.md")], [submit("s1", [], "running")]),
    ).toEqual([]);
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
