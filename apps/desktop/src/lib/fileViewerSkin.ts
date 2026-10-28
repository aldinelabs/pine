/**
 * Reskins file-viewer's renderers with Pine's design tokens.
 *
 * Each renderer injects its own stylesheet with fixed palettes (slate,
 * GitHub dark, a teal accent) and does not read theme variables. Rewriting
 * those stylesheets as they arrive maps the neutral chrome colors to Pine's
 * tokens by role: backgrounds by lightness, text by contrast, borders to the
 * border token, the teal accent to the primary color. Document content is
 * left alone: pure white and black (paper and body text), colorful values
 * (syntax highlighting, charts) and SVG paint keep their colors.
 */

type Role = "background" | "text" | "border";

interface Color {
  lightness: number;
  chroma: number;
  hue: number;
  alpha: number;
}

/** Below this OKLCH chroma a color reads as a neutral gray. */
const NEUTRAL_CHROMA = 0.045;

const COLOR =
  /#[0-9a-f]{3,8}\b|rgba?\(\s*[\d.]+%?(?:\s*[,\s]\s*[\d.]+%?){2}(?:\s*[,/]\s*[\d.]+%?)?\s*\)/gi;
const DECLARATION = /([{;\s])(--[\w-]+|[a-z-]+)(\s*:\s*)([^;{}]+)/gi;

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB to OKLCH, enough to classify a color. */
function toOklch(r: number, g: number, b: number, alpha: number): Color {
  const [lr, lg, lb] = [channel(r), channel(g), channel(b)];
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(B, A) * 180) / Math.PI;
  return {
    lightness: L,
    chroma: Math.hypot(A, B),
    hue: hue < 0 ? hue + 360 : hue,
    alpha,
  };
}

function parseColor(literal: string): Color | undefined {
  if (literal.startsWith("#")) {
    let hex = literal.slice(1);
    if (hex.length === 3 || hex.length === 4)
      hex = [...hex].map((digit) => digit + digit).join("");
    if (hex.length !== 6 && hex.length !== 8) return undefined;
    const value = (offset: number) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16);
    return toOklch(
      value(0),
      value(2),
      value(4),
      hex.length === 8 ? value(6) / 255 : 1,
    );
  }
  const parts = literal
    .slice(literal.indexOf("(") + 1, -1)
    .split(/[\s,/]+/)
    .filter(Boolean);
  const number = (part: string | undefined, scale: number): number =>
    part?.endsWith("%")
      ? (Number.parseFloat(part) / 100) * scale
      : Number.parseFloat(part ?? "");
  const [r, g, b] = parts.slice(0, 3).map((part) => number(part, 255));
  const alpha = parts[3] === undefined ? 1 : number(parts[3], 1);
  return [r, g, b, alpha].every(Number.isFinite)
    ? toOklch(r, g, b, alpha)
    : undefined;
}

function roleOf(property: string): Role | undefined {
  const name = property.toLowerCase();
  if (name.startsWith("--")) {
    if (/bg|background|surface|panel|canvas|fill-bg/.test(name))
      return "background";
    if (/border|divider|line|separator|outline/.test(name)) return "border";
    if (/(^|-)(fg|text|color|foreground|muted|title|default)(-|$)/.test(name))
      return "text";
    return undefined;
  }
  if (name === "background" || name === "background-color") return "background";
  if (name === "color" || name === "caret-color") return "text";
  if (
    /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?$/.test(
      name,
    ) ||
    name === "outline" ||
    name === "outline-color" ||
    name === "column-rule-color" ||
    name === "text-decoration-color"
  )
    return "border";
  return undefined;
}

function neutralToken(role: Role, { lightness }: Color): string {
  if (role === "border") return "--border";
  if (role === "text")
    return lightness < 0.4 || lightness > 0.85
      ? "--foreground"
      : "--muted-foreground";
  // Steps of the renderers' slate and GitHub palettes: the page, raised
  // panels, hovered or selected rows, then stronger fills.
  if (lightness >= 0.6) {
    if (lightness >= 0.975) return "--background";
    return lightness >= 0.94 ? "--muted" : "--accent";
  }
  if (lightness < 0.215) return "--background";
  if (lightness < 0.26) return "--card";
  return lightness < 0.35 ? "--muted" : "--accent";
}

/** file-viewer's teal and spreadsheet-green accents, light and dark. */
function isAccent({ chroma, hue }: Color): boolean {
  return chroma >= NEUTRAL_CHROMA && hue >= 140 && hue <= 205;
}

/**
 * Pine tokens as the preview host exposes them: `--pine-fv-*` follow the app
 * theme and are pre-inverted while the host inverts pages.
 */
function tokenColor(token: string, alpha: number): string {
  const value = `var(--pine-fv-${token.slice(2)})`;
  return alpha >= 0.995
    ? value
    : `color-mix(in oklch, ${value} ${Math.round(alpha * 100)}%, transparent)`;
}

function mapColor(literal: string, role: Role): string {
  const color = parseColor(literal);
  if (!color) return literal;
  if (isAccent(color)) return tokenColor("--primary", color.alpha);
  if (color.chroma >= NEUTRAL_CHROMA) return literal;
  return tokenColor(neutralToken(role, color), color.alpha);
}

const SANS =
  /(^|,)\s*(-apple-system|system-ui|blinkmacsystemfont|"?inter"?|"?segoe ui"?|"?helvetica neue"?|"?pingfang sc"?|sans-serif)\s*(,|$)/i;
const MONO =
  /(^|,)\s*("?sf mono"?|"?jetbrains mono"?|"?cascadia code"?|"?fira code"?|menlo|consolas|monospace)\s*(,|$)/i;

function mapFont(value: string): string {
  if (/var\(/.test(value)) return value;
  if (MONO.test(value)) return " var(--font-mono)";
  if (SANS.test(value)) return " var(--font-sans)";
  return value;
}

/**
 * Selectors that style the document itself rather than the viewer around it:
 * their white and black stay, so pages and slides keep reading as paper.
 */
const PAPER =
  /page|paper|slide|canvas|svg|img|image|thumb|frame|docx|document|mxgraph|cell|chart|katex|markdown-body|epub-view/i;

const WHITE =
  /^(#fff(f(ff)?)?|white|rgba?\(\s*255\s*[, ]\s*255\s*[, ]\s*255\s*(?:[,/]\s*1(?:\.0+)?\s*)?\))$/i;
const BLACK =
  /^(#000(0(00)?)?|black|rgba?\(\s*0\s*[, ]\s*0\s*[, ]\s*0\s*(?:[,/]\s*1(?:\.0+)?\s*)?\))$/i;
const KEYWORD = /\b(white|black)\b/gi;

interface RuleContext {
  paper: boolean;
  /** The rule paints the stage the document sits on, which is Pine's page. */
  surface: boolean;
  /** The rule styles a layer floating over the viewer (drawers, lightboxes). */
  floating: boolean;
  /** The rule paints an accent background, so its text sits on the primary color. */
  onAccent: boolean;
}

function mapLiteral(literal: string, role: Role, rule: RuleContext): string {
  const solidWhite = WHITE.test(literal);
  const solidBlack = BLACK.test(literal);
  if (rule.surface && role === "background" && !(rule.paper && solidWhite)) {
    const color = solidWhite || solidBlack ? undefined : parseColor(literal);
    if (!color || color.chroma < NEUTRAL_CHROMA)
      return tokenColor("--background", color?.alpha ?? 1);
  }
  if (solidWhite || solidBlack) {
    if (rule.paper) return literal;
    if (role === "border") return tokenColor("--border", 1);
    if (role === "text")
      return tokenColor(
        rule.onAccent && solidWhite ? "--primary-foreground" : "--foreground",
        1,
      );
    return tokenColor(solidWhite ? "--card" : "--background", 1);
  }
  if (role === "text" && rule.onAccent) {
    const color = parseColor(literal);
    if (color && color.chroma < NEUTRAL_CHROMA)
      return tokenColor("--primary-foreground", color.alpha);
  }
  return mapColor(literal, role);
}

function hasAccentBackground(body: string): boolean {
  for (const [, property, value] of body.matchAll(
    /(?:^|;)\s*(background(?:-color)?)\s*:\s*([^;]+)/gi,
  )) {
    if (!property) continue;
    for (const literal of value.match(COLOR) ?? []) {
      const color = parseColor(literal);
      if (color && isAccent(color) && color.alpha > 0.6) return true;
    }
  }
  return false;
}

/**
 * The containers a renderer lays its document on: shells, stages, viewers.
 * Their light grays would otherwise map to raised tokens and read as a gray
 * panel instead of Pine's page.
 */
const SURFACE =
  /(^|[-_])(shell|stage|viewer|root|wrapper|workspace|container|viewport|frame|body|surface|main)$/i;

/** Every selector in the list targets a surface container itself. */
function isSurface(selector: string): boolean {
  return selector.split(",").every((part) => {
    const subject =
      part
        .trim()
        .split(/\s*[\s>+~]\s*/)
        .pop() ?? "";
    if (!/^(\.[\w-]+|\[[^\]]*\])+$/.test(subject)) return false;
    const classes = subject.match(/\.[\w-]+/g);
    return Boolean(classes?.some((name) => SURFACE.test(name.slice(1))));
  });
}

/** Selectors for layers that float over the viewer and keep a shadow. */
const FLOATING =
  /toc|lightbox|popover|menu|tooltip|toolbar|maplibregl-ctrl|sidebar/i;

/** A drop shadow whose blur is large enough to lift its element as a card. */
function isCardShadow(value: string): boolean {
  if (/\binset\b|var\(/i.test(value)) return false;
  return value
    .replace(/\([^()]*\)/g, "")
    .split(",")
    .some((layer) => {
      const lengths = layer.match(/-?[\d.]+px|\b0\b/g) ?? [];
      return Number.parseFloat(lengths[2] ?? "0") >= 8;
    });
}

/**
 * Renderers lift panels, states and pages off the stage with large soft
 * shadows, which reads as cards nested in Pine's preview card. Panels go
 * flat, pages keep a hairline edge and floating layers a light shadow.
 */
function mapShadow(value: string, rule: RuleContext): string {
  if (!isCardShadow(value)) return value;
  if (rule.floating)
    return " 0 4px 12px color-mix(in oklch, var(--pine-fv-foreground) 10%, transparent)";
  if (rule.paper) return " 0 0 0 1px var(--pine-fv-border)";
  return " none";
}

function skinDeclarations(body: string, rule: RuleContext): string {
  return body.replace(
    DECLARATION,
    (match, lead: string, property: string, colon: string, value: string) => {
      if (property.toLowerCase() === "font-family")
        return `${lead}${property}${colon.trimEnd()}${mapFont(value)}`;
      if (property.toLowerCase() === "box-shadow") {
        const mapped = mapShadow(value, rule);
        return mapped === value
          ? match
          : `${lead}${property}${colon.trimEnd()}${mapped}`;
      }
      const role = roleOf(property);
      if (!role) return match;
      const mapped = value
        .replace(COLOR, (literal) => mapLiteral(literal, role, rule))
        .replace(KEYWORD, (keyword) => mapLiteral(keyword, role, rule));
      return mapped === value ? match : `${lead}${property}${colon}${mapped}`;
    },
  );
}

const cache = new Map<string, string>();

/** Rewrites one renderer stylesheet onto Pine's tokens. */
export function skinFileViewerCss(css: string): string {
  const cached = cache.get(css);
  if (cached !== undefined) return cached;
  // Innermost blocks are rules, including those nested in at-rules.
  const result = css.replace(
    /([^{}]*)\{([^{}]*)\}/g,
    (match, selector: string, body: string) => {
      if (/^\s*@(font-face|keyframes|page)/i.test(selector)) return match;
      const rule = {
        paper: PAPER.test(selector),
        surface: isSurface(selector),
        floating: FLOATING.test(selector),
        onAccent: hasAccentBackground(body),
      };
      const next = skinDeclarations(`;${body}`, rule).slice(1);
      return next === body ? match : `${selector}{${next}}`;
    },
  );
  if (cache.size > 200) cache.clear();
  cache.set(css, result);
  return result;
}

const skinned = new WeakMap<HTMLStyleElement, string>();

function skinStyle(style: HTMLStyleElement): void {
  const text = style.textContent ?? "";
  if (skinned.get(style) === text) return;
  const next = skinFileViewerCss(text);
  skinned.set(style, next);
  if (next !== text) style.textContent = next;
}

/**
 * Keeps every stylesheet a renderer adds under `root` on Pine's tokens. The
 * observer runs before the next paint, so the original palette never shows.
 */
export function skinFileViewerStyles(root: HTMLElement): () => void {
  const sweep = (node: Node): void => {
    if (node instanceof HTMLStyleElement) skinStyle(node);
    else if (node instanceof Element)
      for (const style of node.querySelectorAll("style")) skinStyle(style);
  };
  sweep(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") {
        const parent = record.target.parentNode;
        if (parent instanceof HTMLStyleElement) skinStyle(parent);
      } else {
        if (record.target instanceof HTMLStyleElement) skinStyle(record.target);
        record.addedNodes.forEach(sweep);
      }
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => observer.disconnect();
}
