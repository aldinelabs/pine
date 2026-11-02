// Run: bun apps/desktop/resources/generate-tray-icons.mjs
// Renders the tray glyphs from the logo: a macOS template image (the system
// tints it for the menu bar) and one Windows glyph per taskbar theme, since
// the tray follows the system theme rather than Pine's.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const resources = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(resources, "tray");
const logo = readFileSync(
  path.join(resources, "../src/assets/pine-logo.svg"),
  "utf8",
)
  .replace(/^<\?xml[^>]*>\s*<!DOCTYPE[^>]*>/s, "")
  // Crop the logo's transparent padding so the glyph fills a 16px tray slot.
  .replace(/viewBox="[^"]*"/, 'viewBox="192 186 640 640"');

// `Template` in the name makes Electron treat the image as a template.
const glyphs = [
  { name: "trayTemplate", color: "#000000" },
  { name: "trayLight", color: "#1d1d16" },
  { name: "trayDark", color: "#fafafa" },
];
const scales = [
  { suffix: "", size: 16 },
  { suffix: "@2x", size: 32 },
];

mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  for (const { name, color } of glyphs) {
    for (const { suffix, size } of scales) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<!doctype html>
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; }
  svg { display: block; width: 100%; height: 100%; }
  svg path { fill: ${color}; }
</style>
${logo}`);
      await page.screenshot({
        path: path.join(output, `${name}${suffix}.png`),
        omitBackground: true,
      });
    }
  }
} finally {
  await browser.close();
}
