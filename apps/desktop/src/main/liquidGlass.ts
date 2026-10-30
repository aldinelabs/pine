import type { BrowserWindow } from "electron";
import { createRequire } from "node:module";

/** The parts of electron-liquid-glass Pine uses. */
interface LiquidGlassAddon {
  isGlassSupported(): boolean;
  addView(
    handle: Buffer,
    options: { cornerRadius?: number; tintColor?: string; opaque?: boolean },
  ): number;
}

export interface LiquidGlassOptions {
  cornerRadius?: number;
}

let addon: LiquidGlassAddon | null | undefined;

/**
 * Loads the addon on first use. It is an optional, macOS-only dependency, and
 * Liquid Glass needs macOS 26; anywhere else this is null and callers keep
 * their previous look.
 */
function liquidGlass(): LiquidGlassAddon | null {
  if (addon !== undefined) return addon;
  addon = null;
  if (process.platform !== "darwin") return addon;
  try {
    const loaded = createRequire(__filename)("electron-liquid-glass") as
      LiquidGlassAddon | { default: LiquidGlassAddon };
    const glass = "default" in loaded ? loaded.default : loaded;
    if (glass.isGlassSupported()) addon = glass;
  } catch {
    // Missing or incompatible addon: no glass.
  }
  return addon;
}

export function isLiquidGlassSupported(): boolean {
  return liquidGlass() !== null;
}

/**
 * Puts Liquid Glass behind the whole page of a window, replacing any glass it
 * had. The page shows it only where it paints no background. Returns false
 * when unsupported.
 */
export function applyLiquidGlass(
  window: BrowserWindow,
  { cornerRadius = 0 }: LiquidGlassOptions = {},
): boolean {
  const glass = liquidGlass();
  if (!glass || window.isDestroyed()) return false;
  return glass.addView(window.getNativeWindowHandle(), { cornerRadius }) >= 0;
}
