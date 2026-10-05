import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBashEnvironment,
  createNativeBashEnvironment,
  resolveLoginPath,
  resolveUserBunPath,
} from "../bash-env";

describe("createBashEnvironment", () => {
  it("uses the host-specific Bun executable name", () => {
    expect(path.basename(resolveUserBunPath("/home/pine", "win32"))).toBe(
      "bun.exe",
    );
    expect(path.basename(resolveUserBunPath("/Users/pine", "darwin"))).toBe(
      "bun",
    );
  });

  it("prepends the project bin directory to the login PATH", () => {
    const environment = createBashEnvironment(
      { HOME: "/Users/dev", LANG: "en_US.UTF-8" },
      "/pine/tmp",
      "/opt/homebrew/bin:/usr/bin:/bin",
      "/project",
    );

    expect(environment.PATH).toBe(
      "/project/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin",
    );
  });

  it("keeps the real HOME and redirects tool caches into the temporary directory", () => {
    const environment = createBashEnvironment(
      { HOME: "/Users/dev", LC_ALL: "zh_CN.UTF-8" },
      "/pine/tmp",
      "/usr/bin:/bin",
      "/project",
    );

    expect(environment.HOME).toBe("/Users/dev");
    expect(environment.TMPDIR).toBe("/pine/tmp");
    expect(environment.TMPPREFIX).toBe("/pine/tmp/zsh");
    expect(environment.npm_config_cache).toBe("/pine/tmp/npm-cache");
    expect(environment.BUN_INSTALL_CACHE_DIR).toBe("/pine/tmp/bun-cache");
    expect(environment.XDG_CACHE_HOME).toBe("/pine/tmp/xdg-cache");
    expect(environment.LC_ALL).toBe("zh_CN.UTF-8");
  });

  it("keeps tools from waiting for interactive input", () => {
    const environment = createBashEnvironment(
      { GIT_SSH_COMMAND: "ssh -i key" },
      "/pine/tmp",
      "/usr/bin:/bin",
      "/project",
    );

    expect(environment).toMatchObject({
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
      GIT_PAGER: "cat",
      PIP_NO_INPUT: "1",
      npm_config_yes: "true",
      HOMEBREW_NO_AUTO_UPDATE: "1",
    });
  });

  it("falls back to a temporary home when the source has none", () => {
    const environment = createBashEnvironment(
      {},
      "/pine/tmp",
      "/usr/bin:/bin",
      "/project",
    );

    expect(environment.HOME).toBe("/pine/tmp/home");
  });
});

describe("resolveLoginPath", () => {
  it("resolves a non-empty PATH", async () => {
    const loginPath = await resolveLoginPath();
    expect(loginPath.length).toBeGreaterThan(0);
    expect(loginPath).toContain("/bin");
  });
});

describe("native execution environment", () => {
  it("preserves native temp, credentials and proxy settings without mutating the source", () => {
    const source = {
      TMPDIR: "/native/tmp",
      HTTPS_PROXY: "http://localhost:1234",
      TEST_TOKEN: "fixture",
      XDG_CACHE_HOME: "/native/cache",
    };
    const result = createNativeBashEnvironment(source, "/usr/bin", "/project");
    expect(result).toMatchObject(source);
    expect(result.PATH).toBe("/project/node_modules/.bin:/usr/bin");
    expect(source).not.toHaveProperty("PATH");
  });

  it("adds non-interactive defaults without overriding the user's values", () => {
    const result = createNativeBashEnvironment(
      { GIT_SSH_COMMAND: "ssh -i ~/.ssh/work", PAGER: "less" },
      "/usr/bin",
      "/project",
    );
    expect(result.GIT_SSH_COMMAND).toBe("ssh -i ~/.ssh/work");
    expect(result.PAGER).toBe("less");
    expect(result.GIT_TERMINAL_PROMPT).toBe("0");
    expect(result.HOMEBREW_NO_AUTO_UPDATE).toBe("1");
  });
});
