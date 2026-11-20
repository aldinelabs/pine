// Run on macOS: bun apps/desktop/resources/generate-installer-art.mjs
// Renders the DMG window background (1x and @2x) and the Windows installer's
// loading GIF from the Pine logo, Inter and the app's olive neutrals, using the
// installed Google Chrome through Playwright (as generate-web-icons.mjs does).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { encodeGif } from "./installer/gif-encoder.mjs";

const resources = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(resources, "installer");
const require = createRequire(import.meta.url);
// Inline, because a page set with setContent cannot load file: URLs.
const inter = `data:font/woff2;base64,${readFileSync(
  require.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
).toString("base64")}`;
const logo = readFileSync(
  path.join(resources, "../src/assets/pine-logo.svg"),
  "utf8",
).replace(/^<\?xml[^>]*>\s*<!DOCTYPE[^>]*>/s, "");
// Aldine's own artwork, drawn in its brand charcoal.
const aldine = `data:image/svg+xml;base64,${readFileSync(
  path.join(resources, "../src/assets/aldine/aldine-horizontal-on-light.svg"),
).toString("base64")}`;
// Measured in the Aldine SVG's 409.15 x 133.95 viewBox: the capitals run from
// y 33.13 to the baseline at 96.31, the mark spans 1.12 cap heights with a
// 0.30 cap-height gap to the "A", and the artwork starts at x 31.6 and ends at
// x 377.54.
const ALDINE = {
  width: 409.15,
  height: 133.95,
  capTop: 33.13,
  baseline: 96.31,
  left: 31.6,
  right: 377.54,
};

// Pine's olive neutrals (src/index.css): muted surface, border, muted and
// primary foregrounds. The DMG background is one fixed image for both Finder
// appearances; Finder picks dark icon labels on a light background in either.
const COLORS = {
  surface: "oklch(0.966 0.005 106.5)",
  border: "oklch(0.93 0.007 106.5)",
  muted: "oklch(0.58 0.031 107.3)",
  foreground: "oklch(0.228 0.013 107.4)",
};
// Shared with MakerDMG in forge.config.ts: window size, icon size and the
// icon centres, in points.
const DMG = JSON.parse(
  readFileSync(path.join(output, "dmg-layout.json"), "utf8"),
);

const base = `<!doctype html>
<style>
  @font-face { font-family: Inter; src: url("${inter}") format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; width: 100%; height: 100%; }
  body {
    position: relative; overflow: hidden;
    font-family: Inter, sans-serif; -webkit-font-smoothing: antialiased;
    color: ${COLORS.foreground};
  }
  .lockup {
    display: flex; align-items: center;
    font-weight: 500; letter-spacing: -0.01em; line-height: normal;
  }
  .lockup svg { display: block; flex: none; }
  .lockup path { fill: currentColor; }
  .cobrand { display: flex; align-items: center; }
  .cobrand img { display: block; flex: none; position: relative; }
  .cobrand .by { color: ${COLORS.muted}; font-weight: 400; line-height: normal; }
</style>`;

/**
 * Pine's mark beside its name, proportioned like the Aldine lockup: the star
 * stands 1.12 times Inter's cap height, centred on the capitals, with a gap of
 * 0.30 cap heights. The logo's glyph fills 59.7% of its 1024 box vertically
 * and leaves 21.6% of padding on each side.
 */
function lockup(capHeight) {
  const box = (1.12 * capHeight) / 0.597;
  const padding = 0.216 * box;
  const gap = 0.3 * capHeight;
  const mark = logo.replace(
    "<svg ",
    `<svg style="width:${box}px;height:${box}px;margin:0 ${gap - padding}px 0 ${-padding}px" `,
  );
  // Inter's capitals are 0.727 em tall and centred in its normal line box.
  return `<div class="lockup" style="font-size:${capHeight / 0.727}px">${mark}<span>Pine</span></div>`;
}

/**
 * "Pine by Aldine": both lockups at one cap height, so they read as one family,
 * joined by a quiet "by" set at Pine's size and baseline.
 */
function cobrand(capHeight) {
  const scale = capHeight / (ALDINE.baseline - ALDINE.capTop);
  const height = ALDINE.height * scale;
  // Nudge the artwork so its capitals, not its box, centre on the row.
  const offset =
    (ALDINE.height / 2 - (ALDINE.capTop + ALDINE.baseline) / 2) * scale;
  const space = 0.5 * capHeight;
  const image = `<img src="${aldine}" alt="Aldine" style="height:${height}px;top:${offset}px;margin:0 ${-(ALDINE.width - ALDINE.right) * scale}px 0 ${space - ALDINE.left * scale}px">`;
  return `<div class="cobrand">${lockup(capHeight)}<span class="by" style="font-size:${capHeight / 0.727}px;margin-left:${space}px">by</span>${image}</div>`;
}

// Finder's path and status bars, when a user shows them, cover about the bottom
// 66 pt of the window, so nothing is drawn there.
function dmgBackground() {
  const { width, height, app, applications } = DMG;
  // A short arrow centred between the two icons.
  const middle = (app.x + applications.x) / 2;
  return `${base}
<style>
  body { background: ${COLORS.surface}; }
  .top {
    position: absolute; top: 44px; left: 0; right: 0;
    display: flex; flex-direction: column; align-items: center; gap: 12px;
  }
  .hint { color: ${COLORS.muted}; font-size: 12px; font-weight: 450; }
  svg.arrow { position: absolute; left: 0; top: 0; }
</style>
<div class="top">${cobrand(16)}<div class="hint">Drag Pine to Applications to install</div></div>
<svg class="arrow" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g fill="none" stroke="${COLORS.muted}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${middle - 8} ${app.y}H${middle + 8}" />
    <path d="M${middle + 3.5} ${app.y - 4.5}L${middle + 8} ${app.y}L${middle + 3.5} ${app.y + 4.5}" />
  </g>
</svg>`;
}

// Squirrel shows the GIF in a borderless window while it installs; an
// indeterminate bar eased like the app's --ease-out-expo stands in for progress.
const GIF = { width: 360, height: 220, frames: 48, delay: 3 };

function loadingFrame() {
  return `${base}
<style>
  body {
    background: ${COLORS.surface};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    box-shadow: inset 0 0 0 1px ${COLORS.border};
  }
  .caption { margin-top: 12px; color: ${COLORS.muted}; font-size: 12px; font-weight: 450; }
  .track {
    position: relative; overflow: hidden; margin-top: 22px;
    width: 120px; height: 3px; border-radius: 999px; background: ${COLORS.border};
  }
  .bar {
    position: absolute; top: 0; bottom: 0; width: 40px; border-radius: 999px;
    background: ${COLORS.foreground};
  }
</style>
${cobrand(16)}
<div class="caption">Installing…</div>
<div class="track"><div class="bar"></div></div>`;
}

function easeOutExpo(t) {
  // cubic-bezier(0.16, 1, 0.3, 1), solved for x = t.
  const curve = (a, b, s) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    if (curve(0.16, 0.3, middle) < t) low = middle;
    else high = middle;
  }
  return curve(1, 1, (low + high) / 2);
}

mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const scale of [1, 2]) {
    const page = await browser.newPage({
      viewport: { width: DMG.width, height: DMG.height },
      deviceScaleFactor: scale,
    });
    await page.setContent(dmgBackground());
    await page.evaluate(async () => {
      await document.fonts.load("600 15px Inter");
      await document.fonts.ready;
    });
    await page.screenshot({
      path: path.join(
        output,
        scale === 1 ? "dmg-background.png" : "dmg-background@2x.png",
      ),
    });
    await page.close();
  }

  const page = await browser.newPage({
    viewport: { width: GIF.width, height: GIF.height },
  });
  await page.setContent(loadingFrame());
  await page.evaluate(async () => {
    await document.fonts.load("600 15px Inter");
    await document.fonts.ready;
  });
  const frames = [];
  for (let index = 0; index < GIF.frames; index += 1) {
    // The bar sweeps the track, then the loop rests briefly off-track.
    const travel = Math.min(1, index / (GIF.frames * 0.8));
    const left = -40 + easeOutExpo(travel) * 160;
    await page.evaluate((x) => {
      document.querySelector(".bar").style.left = `${x}px`;
    }, left);
    const png = await page.screenshot();
    const pixels = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return Array.from(
        context.getImageData(0, 0, image.width, image.height).data,
      );
    }, png.toString("base64"));
    frames.push(Uint8Array.from(pixels));
  }
  await page.close();
  writeFileSync(
    path.join(output, "windows-loading.gif"),
    encodeGif(GIF.width, GIF.height, frames, GIF.delay),
  );
} finally {
  await browser.close();
}
