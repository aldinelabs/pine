import path from "node:path";
import { parseArgs } from "node:util";
import {
  DEFAULT_WEB_SERVER_SETTINGS,
  MIN_WEB_PASSWORD_LENGTH,
  WEB_REMEMBER_FOR,
  isWebServerSettings,
  normalizeWebOrigin,
  type WebRememberFor,
  type WebServerSettings,
} from "../shared/webControl";

export const SERVER_USAGE = `Usage: pine-server [options]

Runs Pine without a window and serves its browser interface.

Options:
  --data-dir <dir>       Where Pine keeps projects, sessions and settings
                         (PINE_DATA_DIR; default $XDG_DATA_HOME/pine-server)
  --port <port>          Port to listen on (PINE_PORT; default ${DEFAULT_WEB_SERVER_SETTINGS.port})
  --lan                  Listen on every network interface instead of only
                         this machine (PINE_LAN=1); requires a password
  --public-origin <url>  The origin a reverse proxy serves Pine at, such as
                         https://pine.example.com (PINE_PUBLIC_ORIGIN)
  --remember-for <time>  How long a browser stays signed in: ${WEB_REMEMBER_FOR.join(", ")}
                         (PINE_REMEMBER_FOR; default ${DEFAULT_WEB_SERVER_SETTINGS.rememberFor})
  --password-file <file> Read the sign-in password from a file
                         (PINE_PASSWORD_FILE, or PINE_PASSWORD with the value)
  --no-password          Sign-in happens in front of Pine, such as Cloudflare
                         Access (PINE_REQUIRE_PASSWORD=0); not with --lan
  -h, --help             Show this help
`;

export interface ServerOptions {
  dataDirectory: string;
  web: WebServerSettings;
  /** Given directly, from PINE_PASSWORD. */
  password?: string;
  passwordFile?: string;
}

export type ServerCommand =
  { kind: "help" } | { kind: "run"; options: ServerOptions };

function defaultDataDirectory(
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): string {
  const dataHome =
    env.XDG_DATA_HOME?.trim() || path.join(homeDirectory, ".local", "share");
  return path.join(dataHome, "pine-server");
}

function flag(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
  if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  throw new Error(`Expected a yes or no value, got "${value}".`);
}

/**
 * Reads the server's options from its arguments and environment; arguments
 * win. Passwords never come from arguments, which other users can list.
 */
export function readServerCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): ServerCommand {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      "data-dir": { type: "string" },
      port: { type: "string" },
      lan: { type: "boolean" },
      "public-origin": { type: "string" },
      "remember-for": { type: "string" },
      "password-file": { type: "string" },
      password: { type: "boolean" },
      "no-password": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return { kind: "help" };
  if (values.password)
    throw new Error(
      "Pass the password with PINE_PASSWORD or --password-file, not as an argument.",
    );

  const portText = values.port ?? env.PINE_PORT;
  const port = portText ? Number(portText) : DEFAULT_WEB_SERVER_SETTINGS.port;
  const originText = values["public-origin"] ?? env.PINE_PUBLIC_ORIGIN;
  const publicOrigin = originText ? normalizeWebOrigin(originText) : undefined;
  if (originText && !publicOrigin)
    throw new Error(
      `--public-origin must be a bare http(s) origin, got "${originText}".`,
    );
  const rememberFor = (values["remember-for"] ??
    env.PINE_REMEMBER_FOR ??
    DEFAULT_WEB_SERVER_SETTINGS.rememberFor) as WebRememberFor;
  const lan = values.lan ?? flag(env.PINE_LAN) ?? false;
  const requirePassword = values["no-password"]
    ? false
    : (flag(env.PINE_REQUIRE_PASSWORD) ?? true);

  const web: WebServerSettings = {
    enabled: true,
    port,
    lan,
    rememberFor,
    requirePassword,
    ...(publicOrigin ? { publicOrigin } : {}),
  };
  if (!isWebServerSettings(web)) {
    if (!WEB_REMEMBER_FOR.includes(rememberFor))
      throw new Error(
        `--remember-for must be one of ${WEB_REMEMBER_FOR.join(", ")}.`,
      );
    throw new Error(
      `--port must be a whole number from 1024 to 65535, got "${portText}".`,
    );
  }
  if (lan && !requirePassword)
    throw new Error("--lan needs a password; drop --no-password.");

  const password = env.PINE_PASSWORD;
  if (password !== undefined && password.length < MIN_WEB_PASSWORD_LENGTH)
    throw new Error(
      `PINE_PASSWORD must be at least ${MIN_WEB_PASSWORD_LENGTH} characters.`,
    );
  const passwordFile = values["password-file"] ?? env.PINE_PASSWORD_FILE;
  const dataDirectory = path.resolve(
    values["data-dir"] ??
      env.PINE_DATA_DIR ??
      defaultDataDirectory(env, homeDirectory),
  );
  return {
    kind: "run",
    options: {
      dataDirectory,
      web,
      ...(password !== undefined ? { password } : {}),
      ...(passwordFile ? { passwordFile: path.resolve(passwordFile) } : {}),
    },
  };
}
