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
import type { PineApprovalMode } from "../shared/agent";
import type { WeChatSettingsPatch } from "../shared/wechatRemote";

/** The approval-mode words the WeChat flags take, from the most supervised. */
export const WECHAT_MODE_WORDS = [
  "let-me-review",
  "auto-approve",
  "autonomous",
  "yolo",
] as const;

const WECHAT_MODES: Record<
  (typeof WECHAT_MODE_WORDS)[number],
  PineApprovalMode
> = {
  "let-me-review": "let-me-review",
  "auto-approve": "auto-approve",
  autonomous: "autonomous",
  yolo: "YOLO",
};

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
  --remote               Turn on remote control through Aldine and keep it on
                         (PINE_REMOTE=1; PINE_REMOTE=0 turns it off)
  --pair                 Print a pairing link and QR code to add a device
                         (PINE_PAIR=1); turns remote control on
  --wechat-bind          Connect a WeChat account: shows a QR code here and
                         asks for the codes WeChat sends; needs a terminal
  -h, --help             Show this help

Paired devices (stop the server first; ids come from the list):
  pine-server remote list   [--data-dir <dir>]
  pine-server remote remove <id> [--data-dir <dir>]

WeChat remote:
  pine-server wechat status [--data-dir <dir>]
  pine-server wechat unbind [--data-dir <dir>]
  pine-server wechat config [--data-dir <dir>] [options]
    --ceiling <mode>          Least supervised mode WeChat may use:
                              ${WECHAT_MODE_WORDS.join(" | ")}
    --default-mode <mode>     Mode of sessions started from WeChat (never
                              above the ceiling)
    --default-project <id|none>  Where .new starts a session; none is the
                              temporary workspace
    --allow-high-risk <yes|no>   Approve privileged and destructive requests
                              from WeChat
    --allow-files <yes|no>    Send files the agent presented to WeChat
    --language <zh|en|auto>   Language of the replies in WeChat
    --pause                   Stop acting on WeChat messages
    --resume                  Act on WeChat messages again
  A running server applies a change when it receives SIGHUP
  (kill -HUP <pid>) or when it restarts.
`;

export const WECHAT_LANGUAGES = ["zh", "en", "auto"] as const;
export type WeChatLanguageSetting = (typeof WECHAT_LANGUAGES)[number];

export type WeChatAction =
  | { kind: "status" }
  | { kind: "unbind" }
  | {
      kind: "config";
      /** Settings to change; absent keys stay as they are. */
      patch: WeChatSettingsPatch;
      language?: WeChatLanguageSetting;
      /** true for --pause, false for --resume. */
      paused?: boolean;
    };

export interface ServerOptions {
  dataDirectory: string;
  web: WebServerSettings;
  /** Given directly, from PINE_PASSWORD. */
  password?: string;
  passwordFile?: string;
  /** Turn remote control on or off at start; left as it was when absent. */
  remote?: boolean;
  /** Show a pairing link for one new device once the server is up. */
  pair: boolean;
  /** Connect a WeChat account from this terminal once the server is up. */
  wechatBind: boolean;
}

export type RemoteAction = { kind: "list" } | { kind: "remove"; id: string };

export type ServerCommand =
  | { kind: "help" }
  | { kind: "run"; options: ServerOptions }
  | { kind: "remote"; dataDirectory: string; action: RemoteAction }
  | { kind: "wechat"; dataDirectory: string; action: WeChatAction };

function defaultDataDirectory(
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): string {
  const dataHome =
    env.XDG_DATA_HOME?.trim() || path.join(homeDirectory, ".local", "share");
  return path.join(dataHome, "pine-server");
}

function resolveDataDirectory(
  value: string | undefined,
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): string {
  return path.resolve(
    value ?? env.PINE_DATA_DIR ?? defaultDataDirectory(env, homeDirectory),
  );
}

function readRemoteCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): ServerCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: true,
    options: { "data-dir": { type: "string" } },
  });
  const dataDirectory = resolveDataDirectory(
    values["data-dir"],
    env,
    homeDirectory,
  );
  const [verb, id, ...rest] = positionals;
  if (verb === "list" && id === undefined)
    return { kind: "remote", dataDirectory, action: { kind: "list" } };
  if (verb === "remove" && id && rest.length === 0)
    return { kind: "remote", dataDirectory, action: { kind: "remove", id } };
  throw new Error("Use `remote list` or `remote remove <id>`.");
}

function wechatMode(option: string, value: string): PineApprovalMode {
  const word = value.trim().toLowerCase();
  const mode = (WECHAT_MODE_WORDS as readonly string[]).includes(word)
    ? WECHAT_MODES[word as (typeof WECHAT_MODE_WORDS)[number]]
    : undefined;
  if (!mode)
    throw new Error(
      `${option} must be one of ${WECHAT_MODE_WORDS.join(", ")}, got "${value}".`,
    );
  return mode;
}

function yesNo(option: string, value: string): boolean {
  const word = value.trim().toLowerCase();
  if (word === "yes") return true;
  if (word === "no") return false;
  throw new Error(`${option} must be yes or no, got "${value}".`);
}

const WECHAT_CONFIG_OPTIONS = [
  "ceiling",
  "default-mode",
  "default-project",
  "allow-high-risk",
  "allow-files",
  "language",
  "pause",
  "resume",
] as const;

function readWeChatCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): ServerCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: true,
    options: {
      "data-dir": { type: "string" },
      ceiling: { type: "string" },
      "default-mode": { type: "string" },
      "default-project": { type: "string" },
      "allow-high-risk": { type: "string" },
      "allow-files": { type: "string" },
      language: { type: "string" },
      pause: { type: "boolean" },
      resume: { type: "boolean" },
    },
  });
  const dataDirectory = resolveDataDirectory(
    values["data-dir"],
    env,
    homeDirectory,
  );
  const [verb, ...rest] = positionals;
  const given = WECHAT_CONFIG_OPTIONS.filter(
    (name) => values[name] !== undefined,
  );
  const usage =
    "Use `wechat status`, `wechat unbind` or `wechat config <options>`.";
  if (rest.length > 0) throw new Error(usage);
  if (verb === "status" || verb === "unbind") {
    if (given.length > 0)
      throw new Error(`--${given[0]} belongs to \`wechat config\`.`);
    return { kind: "wechat", dataDirectory, action: { kind: verb } };
  }
  if (verb !== "config") throw new Error(usage);
  if (given.length === 0)
    throw new Error(
      "Nothing to change. See `pine-server --help` for the `wechat config` options.",
    );
  if (values.pause && values.resume)
    throw new Error("Use either --pause or --resume, not both.");

  const patch: WeChatSettingsPatch = {};
  if (values.ceiling !== undefined)
    patch.ceilingMode = wechatMode("--ceiling", values.ceiling);
  if (values["default-mode"] !== undefined)
    patch.defaultMode = wechatMode("--default-mode", values["default-mode"]);
  const project = values["default-project"];
  if (project !== undefined) {
    const id = project.trim();
    if (!id) throw new Error("--default-project needs a project id, or none.");
    patch.defaultProjectId = id.toLowerCase() === "none" ? null : id;
  }
  if (values["allow-high-risk"] !== undefined)
    patch.allowHighRiskApprovals = yesNo(
      "--allow-high-risk",
      values["allow-high-risk"],
    );
  if (values["allow-files"] !== undefined)
    patch.allowFileSending = yesNo("--allow-files", values["allow-files"]);

  const action: WeChatAction = { kind: "config", patch };
  if (values.language !== undefined) {
    const language = values.language.trim().toLowerCase();
    if (!(WECHAT_LANGUAGES as readonly string[]).includes(language))
      throw new Error(
        `--language must be one of ${WECHAT_LANGUAGES.join(", ")}, got "${values.language}".`,
      );
    action.language = language as WeChatLanguageSetting;
  }
  if (values.pause) action.paused = true;
  if (values.resume) action.paused = false;
  return { kind: "wechat", dataDirectory, action };
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
  if (argv[0] === "remote")
    return readRemoteCommand(argv.slice(1), env, homeDirectory);
  if (argv[0] === "wechat")
    return readWeChatCommand(argv.slice(1), env, homeDirectory);
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
      remote: { type: "boolean" },
      pair: { type: "boolean" },
      // Interactive only, so there is deliberately no environment variable.
      "wechat-bind": { type: "boolean" },
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
  const dataDirectory = resolveDataDirectory(
    values["data-dir"],
    env,
    homeDirectory,
  );
  const pair = values.pair ?? flag(env.PINE_PAIR) ?? false;
  const remote = pair ? true : (values.remote ?? flag(env.PINE_REMOTE));
  return {
    kind: "run",
    options: {
      dataDirectory,
      web,
      pair,
      wechatBind: values["wechat-bind"] ?? false,
      ...(remote !== undefined ? { remote } : {}),
      ...(password !== undefined ? { password } : {}),
      ...(passwordFile ? { passwordFile: path.resolve(passwordFile) } : {}),
    },
  };
}
