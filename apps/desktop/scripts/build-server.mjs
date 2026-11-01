#!/usr/bin/env node
/**
 * Builds the headless Pine server into .vite/server: the renderer the browser
 * interface serves, the agent worker, and the server entry, side by side.
 *
 * Usage: bun run build:server, then node .vite/server/server.mjs --help
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".vite", "server");

process.chdir(root);
rmSync(output, { force: true, recursive: true });
mkdirSync(output, { recursive: true });

// Matches what Electron Forge builds for the desktop window.
await build({
  configFile: path.join(root, "vite.renderer.config.ts"),
  base: "./",
  build: {
    copyPublicDir: true,
    emptyOutDir: true,
    outDir: path.join(output, "renderer"),
  },
  resolve: { preserveSymlinks: true },
});

process.env.PINE_AGENT_OUT_DIR = output;
await build({
  configFile: path.join(root, "vite.agent.config.ts"),
  mode: "production",
  build: { emptyOutDir: false },
});

await build({ configFile: path.join(root, "vite.server.config.ts") });

// Optional: without it Pine simply cannot estimate the user's location.
const geoip = path.join(root, "resources", "geoip", "dbip-city-lite.mmdb.gz");
if (existsSync(geoip)) cpSync(geoip, path.join(output, path.basename(geoip)));

console.log(`Pine server built in ${path.relative(process.cwd(), output)}`);
