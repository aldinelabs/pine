import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

interface EdgeOneConfig {
  headers: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
}

// The site-wide headers EdgeOne serves, so a local preview behaves the same.
const siteHeaders = Object.fromEntries(
  (
    JSON.parse(
      readFileSync(new URL("public/edgeone.json", import.meta.url), "utf8"),
    ) as EdgeOneConfig
  ).headers
    .filter((rule) => rule.source === "/*")
    .flatMap((rule) => rule.headers.map(({ key, value }) => [key, value])),
) as Record<string, string>;

// A static site: the page that pairs and connects, and a service worker that
// carries the desktop's own web interface over the connection. The worker
// must sit at /sw.js to control the whole origin.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
  },
  server: {
    port: 5180,
    // In development the worker is served from /src, so it needs this to
    // control "/".
    headers: { "Service-Worker-Allowed": "/" },
  },
  // The embedded Pine inherits this site's policy, so it stays narrow
  // enough not to block what Pine's own page needs.
  preview: { port: 5180, headers: siteHeaders },
  build: {
    target: "es2022",
    rollupOptions: {
      input: { main: "index.html", sw: "src/sw.ts" },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
