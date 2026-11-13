// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readServerCommand } from "../options";

const HOME = "/home/pine";

function run(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const command = readServerCommand(argv, env, HOME);
  if (command.kind !== "run") throw new Error("Expected a run command.");
  return command.options;
}

describe("readServerCommand", () => {
  it("serves only this machine with a password by default", () => {
    expect(run([])).toEqual({
      dataDirectory: path.join(HOME, ".local", "share", "pine-server"),
      web: {
        enabled: true,
        port: 9415,
        lan: false,
        rememberFor: "7d",
        requirePassword: true,
      },
      pair: false,
      wechatBind: false,
    });
  });

  it("leaves remote control alone unless asked", () => {
    expect(run([]).remote).toBeUndefined();
    expect(run(["--remote"]).remote).toBe(true);
    expect(run([], { PINE_REMOTE: "1" }).remote).toBe(true);
    expect(run([], { PINE_REMOTE: "0" }).remote).toBe(false);
  });

  it("turns remote control on when asked to pair", () => {
    expect(run(["--pair"])).toMatchObject({ pair: true, remote: true });
    expect(run([], { PINE_PAIR: "1", PINE_REMOTE: "0" })).toMatchObject({
      pair: true,
      remote: true,
    });
  });

  it("reads the device commands", () => {
    expect(readServerCommand(["remote", "list"], {}, HOME)).toEqual({
      kind: "remote",
      dataDirectory: path.join(HOME, ".local", "share", "pine-server"),
      action: { kind: "list" },
    });
    expect(
      readServerCommand(
        ["remote", "remove", "abc", "--data-dir", "/srv/pine"],
        {},
        HOME,
      ),
    ).toEqual({
      kind: "remote",
      dataDirectory: "/srv/pine",
      action: { kind: "remove", id: "abc" },
    });
    expect(() => readServerCommand(["remote", "remove"], {}, HOME)).toThrow(
      /remote list/,
    );
  });

  it("prefers arguments over the environment", () => {
    const options = run(["--port", "8080", "--data-dir", "/srv/pine"], {
      PINE_PORT: "9000",
      PINE_DATA_DIR: "/var/pine",
      XDG_DATA_HOME: "/data",
    });
    expect(options.web.port).toBe(8080);
    expect(options.dataDirectory).toBe(path.resolve("/srv/pine"));
  });

  it("reads LAN access, the proxy origin and passwords from the environment", () => {
    const options = run([], {
      PINE_LAN: "yes",
      PINE_PUBLIC_ORIGIN: "https://pine.example.com/",
      PINE_PASSWORD: "correct horse",
      PINE_PASSWORD_FILE: "/run/secrets/pine",
    });
    expect(options.web).toMatchObject({
      lan: true,
      publicOrigin: "https://pine.example.com",
    });
    expect(options.password).toBe("correct horse");
    expect(options.passwordFile).toBe(path.resolve("/run/secrets/pine"));
  });

  it("allows signing in elsewhere only on this machine", () => {
    expect(run(["--no-password"]).web.requirePassword).toBe(false);
    expect(() => run(["--no-password", "--lan"])).toThrow("--lan needs");
  });

  it("rejects settings the browser interface cannot use", () => {
    expect(() => run(["--port", "80"])).toThrow("--port");
    expect(() => run(["--remember-for", "forever"])).toThrow("--remember-for");
    expect(() => run(["--public-origin", "https://a.example/path"])).toThrow(
      "--public-origin",
    );
    expect(() => run([], { PINE_PASSWORD: "short" })).toThrow("PINE_PASSWORD");
  });

  it("never takes a password as an argument", () => {
    expect(() => run(["--password"])).toThrow("PINE_PASSWORD");
  });

  it("binds WeChat only when the flag is given, never from the environment", () => {
    expect(run(["--wechat-bind"]).wechatBind).toBe(true);
    expect(run([], { PINE_WECHAT_BIND: "1" }).wechatBind).toBe(false);
    expect(() => run(["--wechat-bind=yes"])).toThrow();
  });

  it("reads the WeChat status and unbind commands", () => {
    expect(readServerCommand(["wechat", "status"], {}, HOME)).toEqual({
      kind: "wechat",
      dataDirectory: path.join(HOME, ".local", "share", "pine-server"),
      action: { kind: "status" },
    });
    expect(
      readServerCommand(
        ["wechat", "unbind", "--data-dir", "/srv/pine"],
        {},
        HOME,
      ),
    ).toEqual({
      kind: "wechat",
      dataDirectory: "/srv/pine",
      action: { kind: "unbind" },
    });
    expect(() => readServerCommand(["wechat"], {}, HOME)).toThrow(
      /wechat status/,
    );
    expect(() => readServerCommand(["wechat", "bind"], {}, HOME)).toThrow(
      /wechat status/,
    );
    expect(() =>
      readServerCommand(["wechat", "status", "--pause"], {}, HOME),
    ).toThrow("--pause belongs to `wechat config`");
  });

  it("reads every WeChat config option", () => {
    const command = readServerCommand(
      [
        "wechat",
        "config",
        "--ceiling",
        "YOLO",
        "--default-mode",
        "autonomous",
        "--default-project",
        "project-1",
        "--allow-high-risk",
        "yes",
        "--allow-files",
        "no",
        "--language",
        "zh",
        "--resume",
      ],
      {},
      HOME,
    );
    expect(command).toEqual({
      kind: "wechat",
      dataDirectory: path.join(HOME, ".local", "share", "pine-server"),
      action: {
        kind: "config",
        patch: {
          ceilingMode: "YOLO",
          defaultMode: "autonomous",
          defaultProjectId: "project-1",
          allowHighRiskApprovals: true,
          allowFileSending: false,
        },
        language: "zh",
        paused: false,
      },
    });
  });

  it("clears the WeChat default project with none and pauses", () => {
    expect(
      readServerCommand(
        ["wechat", "config", "--default-project", "none", "--pause"],
        {},
        HOME,
      ),
    ).toMatchObject({
      action: {
        kind: "config",
        patch: { defaultProjectId: null },
        paused: true,
      },
    });
  });

  it("rejects bad WeChat config values", () => {
    const config =
      (...args: string[]) =>
      () =>
        readServerCommand(["wechat", "config", ...args], {}, HOME);
    expect(config()).toThrow("Nothing to change");
    expect(config("--ceiling", "full")).toThrow("--ceiling must be one of");
    expect(config("--default-mode", "")).toThrow("--default-mode");
    expect(config("--allow-files", "maybe")).toThrow(
      "--allow-files must be yes or no",
    );
    expect(config("--allow-high-risk", "1")).toThrow("--allow-high-risk");
    expect(config("--language", "fr")).toThrow("--language must be one of");
    expect(config("--default-project", " ")).toThrow("--default-project");
    expect(config("--pause", "--resume")).toThrow("not both");
    expect(config("--unknown")).toThrow();
    expect(config("--ceiling", "yolo", "extra")).toThrow(/wechat status/);
  });

  it("takes no WeChat setting from the environment", () => {
    expect(() =>
      readServerCommand(
        ["wechat", "config"],
        { PINE_WECHAT_CEILING: "yolo" },
        HOME,
      ),
    ).toThrow("Nothing to change");
  });

  it("asks for help", () => {
    expect(readServerCommand(["-h"], {}, HOME)).toEqual({ kind: "help" });
  });
});
