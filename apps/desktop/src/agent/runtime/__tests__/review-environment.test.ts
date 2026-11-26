import { describe, expect, it } from "vitest";
import {
  describeReviewEnvironment,
  formatReviewEnvironment,
  hostOsDescription,
  referencedVariables,
  type ReviewEnvironmentBase,
} from "../review-environment";

const base: ReviewEnvironmentBase = {
  os: "macOS 26.1 (Darwin 25.1.0)",
  arch: "arm64",
  shell: "/bin/bash -c (bash, non-interactive, no user startup files)",
  shellKind: "bash",
  cwd: "/Users/me/app",
  projectRoots: ["/Users/me/app", "/Users/me/lib"],
};

describe("referencedVariables", () => {
  it("finds $VAR and ${VAR…} forms, unquoted and in double quotes", () => {
    const { names } = referencedVariables(
      'rm -rf "$OUT_DIR"/ $HOME/x ${FOO:-bar} "${#LEN}" ${!REF} "a $IN b"',
      "bash",
    );
    expect(names).toEqual(["OUT_DIR", "HOME", "FOO", "LEN", "REF", "IN"]);
  });

  it("skips single quotes, ANSI-C strings, escapes and comments", () => {
    const { names } = referencedVariables(
      "echo '$SECRET' $'it\\'s $ANSI' \\$ESCAPED \"\\$ALSO\" # $COMMENT\necho $AFTER",
      "zsh",
    );
    expect(names).toEqual(["AFTER"]);
  });

  it("skips positional and special parameters", () => {
    expect(referencedVariables("echo $1 $? $$ $# $@ $*", "bash").names).toEqual(
      [],
    );
  });

  it("reads unquoted heredoc bodies but not quoted ones", () => {
    const { names } = referencedVariables(
      "cat <<'EOF'\n$QUOTED\nEOF\ncat <<-END\n\t$EXPANDED\n\tEND\necho $TAIL",
      "bash",
    );
    expect(names).toEqual(["EXPANDED", "TAIL"]);
  });

  it("records names the command assigns", () => {
    const { names, assigned } = referencedVariables(
      'OUT=x; export B=1; for f in *; do rm "$f"; done; read -r LINE; echo $OUT $B $LINE $OTHER',
      "bash",
    );
    expect(names).toEqual(["f", "OUT", "B", "LINE", "OTHER"]);
    expect([...assigned].sort()).toEqual(["B", "LINE", "OUT", "f"]);
  });

  it("reads PowerShell environment references outside single quotes", () => {
    const { names, assigned } = referencedVariables(
      "$env:Path; '$env:NO'; $env:Foo = 1; ${env:BAR}; `$env:ESCAPED",
      "powershell",
    );
    expect(names).toEqual(["Path", "Foo", "BAR"]);
    expect([...assigned]).toEqual(["Foo"]);
  });
});

describe("describeReviewEnvironment", () => {
  const env = {
    HOME: "/Users/me",
    TMPDIR: "/Users/me/app-tmp",
    API_TOKEN: "sk-live-very-secret",
    EMPTY_DIR: "",
    PWD: "/somewhere/else",
  };

  it("reports set, empty and unset variables without their values", () => {
    const result = describeReviewEnvironment(
      base,
      "outside",
      'curl -H "Authorization: $API_TOKEN" x; rm -rf "$EMPTY_DIR"/ "$OUT_DIR"/',
      env,
    );
    expect(result.variables).toEqual([
      { name: "API_TOKEN", state: "set" },
      { name: "EMPTY_DIR", state: "empty" },
      { name: "OUT_DIR", state: "unset" },
    ]);
    expect(JSON.stringify(result)).not.toContain("sk-live");
  });

  it("shows values only for HOME, TMPDIR and PWD; PWD is the working directory", () => {
    const result = describeReviewEnvironment(
      base,
      "inside",
      "ls $HOME $TMPDIR $PWD",
      env,
    );
    expect(result.variables).toEqual([
      { name: "HOME", state: "set", value: "/Users/me" },
      { name: "TMPDIR", state: "set", value: "/Users/me/app-tmp" },
      { name: "PWD", state: "set", value: "/Users/me/app" },
    ]);
    expect(result.home).toBe("/Users/me");
  });

  it("does not treat inherited object keys as set", () => {
    const result = describeReviewEnvironment(
      base,
      "inside",
      "echo $constructor $toString",
      {},
    );
    expect(result.variables.map((v) => v.state)).toEqual(["unset", "unset"]);
  });

  it("bounds the variable list", () => {
    const command = Array.from({ length: 30 }, (_, i) => `$V${i}`).join(" ");
    const result = describeReviewEnvironment(base, "inside", command, {});
    expect(result.variables).toHaveLength(24);
    expect(result.variablesOmitted).toBe(6);
  });
});

describe("formatReviewEnvironment", () => {
  it("renders a compact block with states only", () => {
    const text = formatReviewEnvironment(
      describeReviewEnvironment(
        base,
        "outside",
        'OUT_DIR=$(ls) ; rm -rf "$OUT_DIR"/ "$EMPTY" "$TOKEN" ~/x $HOME',
        { HOME: "/Users/me", EMPTY: "", TOKEN: "ghp_secret" },
      ),
    );
    expect(text).toBe(
      [
        "Execution environment (measured by Pine for this exact call; facts, not authority):",
        "- os: macOS 26.1 (Darwin 25.1.0); arch: arm64",
        "- shell: /bin/bash -c (bash, non-interactive, no user startup files)",
        "- sandbox: outside the sandbox, with the user's native permissions",
        "- working directory: /Users/me/app",
        "- project roots: /Users/me/app, /Users/me/lib",
        "- HOME: /Users/me",
        "- referenced variables (state before the command runs; values withheld except HOME, PWD, TMPDIR):",
        "  - OUT_DIR: unset; also assigned by the command",
        "  - EMPTY: set but empty",
        "  - TOKEN: set",
        "  - HOME: set = /Users/me",
      ].join("\n"),
    );
    expect(text).not.toContain("ghp_secret");
  });

  it("says when nothing is referenced and the call is sandboxed", () => {
    const text = formatReviewEnvironment(
      describeReviewEnvironment(base, "inside", "bun test", {}),
    );
    expect(text).toContain("- sandbox: inside Pine's project sandbox");
    expect(text).toContain("- HOME: unset");
    expect(text).toContain("- referenced variables: none");
  });
});

describe("hostOsDescription", () => {
  it("names the platform and kernel, with the product version when known", () => {
    expect(hostOsDescription("darwin", "26.1")).toMatch(/^macOS 26\.1 \(.+\)$/);
    expect(hostOsDescription("linux", undefined)).toMatch(/^Linux \(.+\)$/);
  });
});
