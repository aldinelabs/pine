/** Real-layout regression checks. Run with: bun apps/desktop/scripts/verify-transcript-scroll.mjs */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";
import { createServer } from "vite";

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
  server: { host: "127.0.0.1", port: 0, fs: { allow: [workspace] } },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== "string");
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PINE_PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  });
  for (const scenario of [
    { width: 760, follow: false, interrupt: false },
    { width: 400, follow: false, interrupt: false },
    { width: 760, follow: true, interrupt: false },
    { width: 760, follow: true, interrupt: true },
    { width: 760, follow: false, interrupt: false, separateMessages: true },
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 800 },
    });
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(() => !!window.pineTranscriptScrollTest);
    const result = await page.evaluate(
      (options) => window.pineTranscriptScrollTest.run(options),
      scenario,
    );
    const label = JSON.stringify(scenario);
    console.log(`Measured ${label}: ${JSON.stringify(result)}`);
    assert.equal(result.final.minHeight, "", `Stale content height: ${label}`);
    assert.equal(
      result.final.spacerHidden,
      true,
      `Stale tail spacer: ${label}`,
    );
    assert.equal(result.final.spacerHeight, 0, `Stale tail space: ${label}`);
    if (scenario.interrupt) {
      assert.equal(
        result.final.following,
        false,
        `Reader lost control: ${label}`,
      );
      assert(
        Math.abs(result.final.top - result.interruptedTop) <= 1,
        `Scroll moved after user input: ${label}`,
      );
    } else {
      assert.equal(
        result.hadFollowing,
        true,
        `Never entered follow mode: ${label}`,
      );
      assert.equal(result.final.following, true, `Lost follow mode: ${label}`);
      assert(
        result.final.distanceToEnd <= 1,
        `Left behind the live end: ${label}`,
      );
      assert(
        result.maxExtraBlank <= 2,
        `Extra blank area: ${label}: ${result.maxExtraBlank}px`,
      );
      assert.deepEqual(result.jumps, [], `Scroll jumps: ${label}`);
    }
    console.log(`Passed ${label}`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
