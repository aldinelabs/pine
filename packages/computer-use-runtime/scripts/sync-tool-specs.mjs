import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const executable = path.join(
  packageRoot,
  "pine-computer-use",
  "bin",
  process.platform === "win32" ? "pine-computer-use.exe" : "pine-computer-use",
);
// The server answers tools/list only after the MCP initialize handshake.
const child = spawn(executable, [], {
  env: { ...process.env, COMPUTER_USE_BROWSER: "1" },
  stdio: ["pipe", "pipe", "inherit"],
});

let stdout = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});

for (const message of [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pine-sync-tool-specs", version: "0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
]) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}
child.stdin.end();

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
if (exitCode !== 0)
  throw new Error(`Pine Computer Use exited with ${exitCode}`);

const response = stdout
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
  .find((message) => message.id === 2);
if (!Array.isArray(response?.result?.tools)) {
  throw new Error("Pine Computer Use returned no tool definitions.");
}
/** The Swift server's dictionaries have no stable key order; sort so re-syncs diff cleanly. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

await writeFile(
  path.join(packageRoot, "tool-specs.json"),
  `${JSON.stringify(sortKeys(response.result.tools), null, 2)}\n`,
  "utf8",
);
console.log(
  `Wrote ${response.result.tools.length} Computer Use tool definitions.`,
);
