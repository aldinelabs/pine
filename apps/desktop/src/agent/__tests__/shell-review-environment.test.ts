import { describe, expect, it } from "vitest";
import { createShellReviewEnvironment } from "../shell-review-environment";

describe("createShellReviewEnvironment", () => {
  const options = {
    cwd: "/work/app",
    projectRoots: ["/work/app", "/work/lib"],
    temporaryDirectory: "/work/tmp",
    loginPath: "/usr/bin:/bin",
    extraEnv: { AUTOMATION_SECRET: "s3cr3t" },
    platform: "darwin" as const,
    hostEnv: { HOME: "/Users/me", AWS_SECRET_ACCESS_KEY: "aws-secret" },
  };

  it("describes a sandboxed call with the sandbox shell and environment", () => {
    const result = createShellReviewEnvironment(options)(
      "rm -rf $TMPDIR/x $AWS_SECRET_ACCESS_KEY $AUTOMATION_SECRET $GIT_PAGER",
      "inside",
    );
    expect(result.sandbox).toBe("inside");
    expect(result.shell).toContain("/bin/zsh -f");
    expect(result.projectRoots).toEqual(["/work/app", "/work/lib"]);
    expect(result.variables).toEqual([
      { name: "TMPDIR", state: "set", value: "/work/tmp" },
      // The sandbox environment drops host secrets.
      { name: "AWS_SECRET_ACCESS_KEY", state: "unset" },
      { name: "AUTOMATION_SECRET", state: "set" },
      { name: "GIT_PAGER", state: "set" },
    ]);
  });

  it("describes a native call with the inherited host environment", () => {
    const result = createShellReviewEnvironment(options)(
      "echo $AWS_SECRET_ACCESS_KEY $TMPDIR",
      "outside",
    );
    expect(result.sandbox).toBe("outside");
    expect(result.shell).toMatch(/ -c \(.+, non-interactive/);
    expect(result.variables).toEqual([
      { name: "AWS_SECRET_ACCESS_KEY", state: "set" },
      { name: "TMPDIR", state: "unset" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/aws-secret|s3cr3t/);
  });
});
