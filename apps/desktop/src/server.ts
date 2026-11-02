import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_LANGUAGES_ENV } from "./agent/network-region";
import type { PineHost } from "./main/core/host";
import { PineCore } from "./main/core/pineCore";
import { forkAgentProcess } from "./server/agentProcess";
import { fileCredentialStorage } from "./server/credentialStorage";
import { linuxSandboxProblems } from "./server/sandboxCheck";
import { formatPairing, runRemoteAction } from "./server/remoteCli";
import { serverFileActions } from "./server/fileActions";
import {
  readServerCommand,
  SERVER_USAGE,
  type ServerOptions,
} from "./server/options";

/** Pine's version, written in by the server build. */
declare const PINE_SERVER_VERSION: string;

/** The server, the agent worker and the renderer are built side by side. */
const buildDirectory = path.dirname(fileURLToPath(import.meta.url));

function serverHost(
  options: ServerOptions,
  remote: { fingerprint: (print: string) => void },
): PineHost {
  return {
    dataDirectory: options.dataDirectory,
    logsDirectory: path.join(options.dataDirectory, "logs"),
    geoipDatabasePath: path.join(buildDirectory, "dbip-city-lite.mmdb.gz"),
    version: PINE_SERVER_VERSION,
    runtime: { node: process.versions.node },
    fetch: (url, init) => fetch(url, init),
    createAgentProcess: () =>
      forkAgentProcess(path.join(buildDirectory, "agent.mjs"), {
        ...process.env,
        [SYSTEM_LANGUAGES_ENV]: Intl.DateTimeFormat().resolvedOptions().locale,
      }),
    credentialStorage: fileCredentialStorage,
    renderer: {
      root:
        process.env.PINE_RENDERER_DIR ?? path.join(buildDirectory, "renderer"),
    },
    fileActions: serverFileActions(path.join(options.dataDirectory, "trash")),
    // Only the browser interface connects; there are no desktop windows.
    sendToClient: () => false,
    focusClient: () => false,
    libraryChanged: () => undefined,
    // Only someone with the terminal can start pairing, and only they see the
    // link, so a device that presents it is the one they meant to add.
    approveRemotePairing: ({ fingerprint }) => {
      remote.fingerprint(fingerprint);
      return Promise.resolve(true);
    },
  };
}

async function readPassword(
  options: ServerOptions,
): Promise<string | undefined> {
  if (options.password !== undefined) return options.password;
  if (!options.passwordFile) return undefined;
  return (await readFile(options.passwordFile, "utf8")).trim();
}

async function main(): Promise<void> {
  const command = readServerCommand(
    process.argv.slice(2),
    process.env,
    os.homedir(),
  );
  if (command.kind === "help") {
    process.stdout.write(SERVER_USAGE);
    return;
  }
  if (command.kind === "remote") {
    console.log(await runRemoteAction(command.dataDirectory, command.action));
    return;
  }
  const { options } = command;
  if (process.platform === "win32")
    throw new Error("The Pine server does not run on Windows.");

  // Credentials and sessions live here, so only this user may read it.
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
  const password = await readPassword(options);
  const core = await PineCore.create(
    serverHost(options, {
      fingerprint: (print) =>
        console.log(`Pairing a new device (fingerprint ${print}).`),
    }),
  );
  if (password) await core.web.ensurePassword(password);
  if (options.web.requirePassword && !core.web.server.status().hasPassword)
    throw new Error(
      "Set a sign-in password with PINE_PASSWORD or --password-file.",
    );

  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`Received ${signal}; stopping Pine.`);
    void core.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const status = await core.web.configure(options.web);
  if (status.error) throw new Error(status.error);
  console.log(`Pine ${core.host.version} is serving ${options.dataDirectory}`);
  for (const address of status.addresses ?? []) console.log(`  ${address}`);
  if (process.platform === "linux")
    for (const problem of linuxSandboxProblems()) console.warn(problem);

  if (options.remote === false) await core.remote.disable();
  else if (options.remote) await core.remote.enable();
  const pair = async (): Promise<void> => {
    try {
      await core.remote.startPairing();
      const pairing = core.remote.status().pairing;
      if (pairing) console.log(`\n${formatPairing(pairing)}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  };
  if (options.pair) await pair();
  else if (core.remote.status().enabled)
    console.log("Remote control is on. Pair a device with SIGUSR2 or --pair.");
  // Pairing lasts a few minutes; this asks for a fresh link without a restart.
  process.on("SIGUSR2", () => void pair());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
