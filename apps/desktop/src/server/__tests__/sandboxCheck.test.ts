import { describe, expect, it } from "vitest";
import { linuxSandboxProblems } from "../sandboxCheck";

describe("linuxSandboxProblems", () => {
  it("names missing tools and how to install them", () => {
    const problems = linuxSandboxProblems({
      missingDependencies: () => ["bubblewrap (bwrap) not installed"],
      namespaceError: () => {
        throw new Error("not probed without bubblewrap");
      },
    });
    expect(problems[0]).toContain("bubblewrap (bwrap) not installed");
    expect(problems[1]).toContain("apt install bubblewrap socat ripgrep");
  });

  it("explains a host that blocks user namespaces", () => {
    const problems = linuxSandboxProblems({
      missingDependencies: () => [],
      namespaceError: () => "No permissions to create new namespace",
    });
    expect(problems[0]).toContain("No permissions to create new namespace");
    expect(problems[1]).toContain("--security-opt");
  });

  it("stays quiet when the sandbox works", () => {
    expect(
      linuxSandboxProblems({
        missingDependencies: () => [],
        namespaceError: () => undefined,
      }),
    ).toEqual([]);
  });
});
