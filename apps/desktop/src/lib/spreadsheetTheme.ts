/**
 * Paints file-viewer's spreadsheet grid with Pine's tokens.
 *
 * The grid is drawn on a canvas from a config the renderer fills with fixed
 * colors, and the table lets that config win over its own CSS variables.
 * Through the table that Pine's patch exposes, every config the renderer
 * loads (again on zoom and resize) gets Pine's colors merged in.
 */

interface ThemedTable {
  loadConfig?: (config: Record<string, unknown>) => void;
  ctx?: { config?: Record<string, unknown>; emit?: (event: string) => void };
}

interface SpreadsheetHost extends HTMLElement {
  pineSpreadsheet?: { table: () => ThemedTable | undefined };
}

/** Grid colors and the tokens they take, as CSS color expressions. */
const GRID_COLORS: Record<string, string> = {
  BORDER_COLOR: "var(--pine-fv-border)",
  HEADER_BG_COLOR: "var(--pine-fv-muted)",
  HEADER_TEXT_COLOR: "var(--pine-fv-muted-foreground)",
  BODY_BG_COLOR: "var(--pine-fv-background)",
  BODY_TEXT_COLOR: "var(--pine-fv-foreground)",
  READONLY_COLOR: "var(--pine-fv-background)",
  READONLY_TEXT_COLOR: "var(--pine-fv-foreground)",
  EDIT_BG_COLOR: "var(--pine-fv-background)",
  PLACEHOLDER_COLOR: "var(--pine-fv-muted-foreground)",
  SCROLLER_COLOR:
    "color-mix(in oklch, var(--pine-fv-muted-foreground) 35%, transparent)",
  SCROLLER_FOCUS_COLOR:
    "color-mix(in oklch, var(--pine-fv-muted-foreground) 60%, transparent)",
  SCROLLER_TRACK_COLOR: "transparent",
  SELECT_ROW_COL_BG_COLOR:
    "color-mix(in oklch, var(--pine-fv-primary) 12%, transparent)",
  SELECT_AREA_COLOR:
    "color-mix(in oklch, var(--pine-fv-primary) 14%, transparent)",
  SELECT_BORDER_COLOR: "var(--pine-fv-primary)",
  AUTOFILL_POINT_BORDER_COLOR: "var(--pine-fv-primary)",
  RESIZE_COLUMN_LINE_COLOR: "var(--pine-fv-primary)",
  RESIZE_COLUMN_TEXT_BG_COLOR: "var(--pine-fv-primary)",
  RESIZE_ROW_LINE_COLOR: "var(--pine-fv-primary)",
};

/**
 * Fixed colors the renderer returns from its per-cell style methods for the
 * row index column and cells still loading, in its light and dark variants.
 */
const CELL_COLORS: Record<string, { key: string; property: string }> = {
  "#f3f3f3": { key: "HEADER_BG_COLOR", property: "backgroundColor" },
  "#1f2937": { key: "HEADER_BG_COLOR", property: "backgroundColor" },
  "#f4f7f9": { key: "HEADER_BG_COLOR", property: "backgroundColor" },
  "#18212f": { key: "HEADER_BG_COLOR", property: "backgroundColor" },
  "#5f6368": { key: "HEADER_TEXT_COLOR", property: "color" },
  "#cbd5e1": { key: "HEADER_TEXT_COLOR", property: "color" },
  "#73808d": { key: "PLACEHOLDER_COLOR", property: "color" },
  "#94a3b8": { key: "PLACEHOLDER_COLOR", property: "color" },
};
const STYLE_METHODS = ["BODY_CELL_STYLE_METHOD", "HEADER_CELL_STYLE_METHOD"];

type StyleMethod = (...args: unknown[]) => unknown;
const wrappedMethods = new WeakSet<StyleMethod>();

/** Swaps the renderer's chrome colors in a cell style for Pine's. */
function themeCellStyle(
  style: unknown,
  colors: Record<string, string>,
): unknown {
  if (!style || typeof style !== "object") return style;
  let next: Record<string, unknown> | undefined;
  for (const [property, value] of Object.entries(style)) {
    const match =
      typeof value === "string" ? CELL_COLORS[value.toLowerCase()] : undefined;
    if (match?.property !== property || !colors[match.key]) continue;
    next ??= { ...(style as Record<string, unknown>) };
    next[property] = colors[match.key];
  }
  return next ?? style;
}

function wrapStyleMethods(
  config: Record<string, unknown>,
  colors: () => Record<string, string>,
): Record<string, unknown> {
  const next = { ...config };
  for (const name of STYLE_METHODS) {
    const method = next[name];
    if (
      typeof method !== "function" ||
      wrappedMethods.has(method as StyleMethod)
    )
      continue;
    const wrapped: StyleMethod = (...args) =>
      themeCellStyle((method as StyleMethod)(...args), colors());
    wrappedMethods.add(wrapped);
    next[name] = wrapped;
  }
  return next;
}

/** Resolves token expressions to colors a canvas accepts. */
function resolveColors(root: HTMLElement): Record<string, string> {
  const probe = root.ownerDocument.createElement("span");
  probe.style.display = "none";
  root.append(probe);
  const colors: Record<string, string> = {};
  try {
    for (const [key, expression] of Object.entries(GRID_COLORS)) {
      probe.style.color = "";
      probe.style.color = expression;
      colors[key] = getComputedStyle(probe).color;
    }
  } finally {
    probe.remove();
  }
  return colors;
}

const themed = new WeakMap<ThemedTable, Record<string, string>>();

function applyTheme(table: ThemedTable, colors: Record<string, string>): void {
  const previous = themed.get(table);
  themed.set(table, colors);
  const current = () => themed.get(table) ?? {};
  if (!previous && table.loadConfig) {
    const load = table.loadConfig.bind(table);
    table.loadConfig = (config) =>
      load({ ...wrapStyleMethods(config, current), ...current() });
  }
  const config = table.ctx?.config;
  if (!config) return;
  Object.assign(config, wrapStyleMethods(config, current), colors);
  const own = config._config;
  if (own && typeof own === "object")
    Object.assign(
      own,
      wrapStyleMethods(own as Record<string, unknown>, current),
      colors,
    );
  table.ctx?.emit?.("draw");
}

/** Themes every spreadsheet table under `root`; cheap to call repeatedly. */
export function themeSpreadsheets(root: HTMLElement): void {
  const hosts = root.querySelectorAll<SpreadsheetHost>(
    "[data-pine-spreadsheet]",
  );
  if (!hosts.length) return;
  const colors = resolveColors(root);
  for (const host of hosts) {
    const table = host.pineSpreadsheet?.table();
    if (!table) continue;
    const current = themed.get(table);
    if (
      current &&
      Object.keys(colors).every((key) => current[key] === colors[key])
    )
      continue;
    applyTheme(table, colors);
  }
}
