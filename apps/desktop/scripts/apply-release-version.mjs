import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.env.RELEASE_VERSION;
if (!version) throw new Error("RELEASE_VERSION is required");

const packagePath = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "package.json",
);
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
packageJson.version = version;
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`apps/desktop version set to ${version}`);
