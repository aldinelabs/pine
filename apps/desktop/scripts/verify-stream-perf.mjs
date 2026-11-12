/**
 * Real-browser trace of a streaming reply. A measurement, not a check: it has
 * no thresholds, and only before/after ratios on one machine mean anything.
 * Run with: node apps/desktop/scripts/verify-stream-perf.mjs [--shimmer]
 * Prints one JSON line per transcript size (10 and 120 mounted history
 * messages), with a thinking, a text and a settle phase each.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";
import { createServer } from "vite";

const HISTORY_SIZES = [10, 120];
/** Cumulative counters of `Performance.getMetrics`; durations are seconds. */
const DURATION_METRICS = [
  "ScriptDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "TaskDuration",
];
const COUNT_METRICS = ["LayoutCount", "RecalcStyleCount"];
const PHASES = [
  ["thinking", "stream-start", "thinking-end"],
  ["text", "thinking-end", "text-end"],
  ["settle", "text-end", "settle-end"],
];

const shimmer = process.argv.includes("--shimmer");

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PINE_PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  });
} catch (error) {
  const reason = String(error?.message ?? error).split("\n")[0];
  console.log(`skipped: no Chromium available (${reason})`);
  process.exit(0);
}

const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspace = path.resolve(desktop, "../..");
const require = createRequire(path.join(workspace, "package.json"));
const compiler = require("vue/compiler-sfc");
compiler.registerTS(() => require("typescript"));
const server = await createServer({
  configFile: false,
  root: path.join(
    desktop,
    "src/components/ui/message-scroller/__tests__/browser",
  ),
  plugins: [vue({ compiler }), tailwind()],
  resolve: { alias: { "@": path.join(desktop, "src") } },
  // Keep the output to the result lines, also when run by a coding agent.
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [workspace] },
    forwardConsole: false,
    // A file saved during a run must not hot-update the page being measured.
    watch: null,
  },
});

function metricDelta(from, to) {
  const delta = {};
  for (const name of DURATION_METRICS) {
    delta[`${name}Ms`] = Math.round((to[name] - from[name]) * 10_000) / 10;
  }
  for (const name of COUNT_METRICS) delta[name] = to[name] - from[name];
  return delta;
}

/** Streams one reply over `history` mounted messages and returns its numbers. */
async function trace(origin, history, options) {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
  });
  try {
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    const client = await page.context().newCDPSession(page);
    await client.send("Performance.enable");
    const marks = {};
    await page.exposeFunction("pineStreamPerfMark", async (name) => {
      const { metrics } = await client.send("Performance.getMetrics");
      marks[name] = Object.fromEntries(
        metrics.map((metric) => [metric.name, metric.value]),
      );
    });
    const query = new URLSearchParams({ w: String(history) });
    if (shimmer) query.set("shimmer", "1");
    await page.goto(`${origin}/perf.html?${query}`);
    await page.waitForFunction(() => !!window.pineStreamPerfTest);
    const result = await page.evaluate(
      (runOptions) => window.pineStreamPerfTest.run(runOptions),
      options,
    );
    for (const [phase, from, to] of PHASES) {
      assert(marks[from] && marks[to], `Missing metrics for ${phase}`);
      result.phases[phase].cdp = metricDelta(marks[from], marks[to]);
    }
    return result;
  } finally {
    await page.close();
  }
}

try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  // An unmeasured short pass first, so module transforms and lazily loaded
  // renderers are not charged to the first measured size.
  await trace(origin, 2, { phaseMs: 600 });
  for (const history of HISTORY_SIZES) {
    console.log(JSON.stringify(await trace(origin, history, {})));
  }
} finally {
  await browser.close();
  await server.close();
}
