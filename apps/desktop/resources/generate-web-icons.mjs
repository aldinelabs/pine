// Run: bun apps/desktop/resources/generate-web-icons.mjs
// Renders the browser and home-screen icons from the same logo and colours as
// the native app icon. Run generate-icons.mjs first when the logo changes.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const resources = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(resources, "../public/web");
const logo = readFileSync(
  path.join(resources, "../src/assets/pine-logo.svg"),
  "utf8",
);
const BACKGROUND = "#fbfbf9";
const FOREGROUND = "#1d1d16";

// Home screens draw their own rounded mask, so the artwork fills the square.
// `scale` matches the native icon's composition; a maskable icon keeps the
// logo inside the central safe zone that launchers may crop to a circle.
const icons = [
  { name: "apple-touch-icon.png", size: 180, scale: 1.3 },
  { name: "icon-192.png", size: 192, scale: 1.3 },
  { name: "icon-512.png", size: 512, scale: 1.3 },
  { name: "icon-maskable-512.png", size: 512, scale: 1.05 },
];

mkdirSync(output, { recursive: true });
// Installed Chrome avoids downloading Playwright's own browser for a one-off render.
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const { name, size, scale } of icons) {
    // A small CSS viewport with a matching pixel ratio renders every size in
    // full. Chrome's window could not open a 512 px tall viewport, so the
    // 512 px icon was captured short and its top repeated along the bottom.
    const page = await browser.newPage({
      viewport: { width: 128, height: 128 },
      deviceScaleFactor: size / 128,
    });
    await page.setContent(`<!doctype html>
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: ${BACKGROUND}; }
  body { display: grid; place-items: center; overflow: hidden; }
  svg { width: ${scale * 100}%; height: ${scale * 100}%; flex: none; }
  svg path { fill: ${FOREGROUND}; }
</style>
${logo.replace(/^<\?xml[^>]*>\s*<!DOCTYPE[^>]*>/s, "")}`);
    await page.screenshot({ path: path.join(output, name) });
    await page.close();
  }
} finally {
  await browser.close();
}
// Browser tabs show the native icon, whose rounded square reads as an app.
copyFileSync(
  path.join(resources, "icon.png"),
  path.join(output, "favicon.png"),
);
