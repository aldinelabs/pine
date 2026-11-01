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
    });
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

  it("asks for help", () => {
    expect(readServerCommand(["-h"], {}, HOME)).toEqual({ kind: "help" });
  });
});
