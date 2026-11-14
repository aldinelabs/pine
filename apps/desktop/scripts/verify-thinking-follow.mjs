/**
 * Real-browser trace of a live thinking panel inside the transcript. Streams
 * a few turns and prints, per scenario, where the open panel sat relative to
 * the transcript's bottom edge and whether the transcript kept following.
 * Run with: node apps/desktop/scripts/verify-thinking-follow.mjs [--frames]
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";
import { createServer } from "vite";

const printFrames = process.argv.includes("--frames");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

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
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [workspace] },
    forwardConsole: false,
    watch: null,
  },
});

const SCENARIOS = [
  {
    name: "first-short",
    vh: 420,
    w: 0,
    options: { promptLength: 80, thinkingMs: 8_000, textMs: 4_000 },
  },
  {
    name: "first-mid",
    vh: 520,
    w: 0,
    options: { promptLength: 300, thinkingMs: 8_000, textMs: 4_000 },
  },
  { name: "fresh", vh: 650, options: { promptLength: 80 } },
  {
    name: "first",
    vh: 650,
    w: 0,
    options: { promptLength: 80, thinkingMs: 10_000, textMs: 6_000 },
  },
  { name: "tall-prompt", vh: 650, options: { promptLength: 900 } },
  { name: "short-view", vh: 420, options: { promptLength: 80 } },
  { name: "after-text", vh: 650, options: { textFirst: true } },
  {
    name: "wheel-panel",
    vh: 650,
    options: { textFirst: true },
    wheel: "panel",
  },
  {
    name: "first-wheel-down",
    vh: 650,
    w: 0,
    options: { thinkingMs: 8_000, textMs: 6_000 },
    wheel: "main",
    delta: 40,
    wheelAfter: 1_000,
  },
  {
    name: "first-wheel-up",
    vh: 650,
    w: 0,
    options: { thinkingMs: 8_000, textMs: 6_000 },
    wheel: "main",
    delta: -40,
    wheelAfter: 1_000,
  },
];

/** Summary of one phase: worst panel gap, frames not following, jumps. */
function summarize(frames) {
  const phases = {};
  let previous;
  for (const frame of frames) {
    const p = (phases[frame.phase] ??= {
      frames: 0,
      notFollowing: 0,
      minPanelGap: null,
      minLastGap: null,
      maxLastGap: null,
      upMoves: 0,
      spacerMax: 0,
    });
    p.frames++;
    if (!frame.following) p.notFollowing++;
    if (frame.panelOpen && frame.panelGap !== null)
      p.minPanelGap =
        p.minPanelGap === null
          ? frame.panelGap
          : Math.min(p.minPanelGap, frame.panelGap);
    p.minLastGap =
      p.minLastGap === null
        ? frame.lastGap
        : Math.min(p.minLastGap, frame.lastGap);
    p.maxLastGap =
      p.maxLastGap === null
        ? frame.lastGap
        : Math.max(p.maxLastGap, frame.lastGap);
    if (previous && frame.scrollTop < previous.scrollTop - 1) p.upMoves++;
    p.spacerMax = Math.max(p.spacerMax, frame.spacer);
    previous = frame;
  }
  return phases;
}

async function trace(origin, scenario) {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1000 },
  });
  try {
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    page.on("pageerror", (error) => console.log("pageerror", error.message));
    await page.goto(
      `${origin}/follow.html?vh=${scenario.vh}&w=${scenario.w ?? 6}`,
    );
    await page.waitForFunction(() => !!window.pineThinkingFollow);
    const result = page.evaluate(
      (options) => window.pineThinkingFollow.run(options),
      scenario.options,
    );
    if (scenario.wheel) {
      await page.waitForFunction(
        () => window.pineThinkingFollow.phase() === "thinking",
      );
      await page.waitForTimeout(scenario.wheelAfter ?? 3_000);
      const box = await page
        .locator(
          scenario.wheel === "panel"
            ? "[data-thinking-content]"
            : '[data-message-id="prompt"]',
        )
        .last()
        .boundingBox();
      assert(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, scenario.delta ?? -120);
    }
    const frames = await result;
    return frames;
  } finally {
    await page.close();
  }
}

try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  for (const scenario of SCENARIOS) {
    if (only && scenario.name !== only) continue;
    const frames = await trace(origin, scenario);
    console.log(scenario.name, JSON.stringify(summarize(frames)));
    if (printFrames)
      for (const f of frames)
        console.log(
          [
            f.t,
            f.phase,
            f.scrollTop,
            f.maxScrollTop,
            f.following ? "F" : "-",
            f.spacer,
            f.panelOpen ? "open" : "shut",
            f.panelGap,
            f.lastGap,
            f.panelScrollTop,
            f.panelRange,
          ].join("\t"),
        );
  }
} finally {
  await browser.close();
  await server.close();
}
