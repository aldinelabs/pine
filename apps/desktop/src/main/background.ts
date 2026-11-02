import { type QuitBlockers } from "./quitGuard";

/** What the tray menu reflects when it opens. */
export interface TrayState extends QuitBlockers {
  quickComposerEnabled: boolean;
}

export type TrayAction = "open" | "quick-composer" | "quit";

export type TrayMenuEntry =
  | { type: "separator" }
  | { type: "action"; action: TrayAction; label: string }
  | { type: "status"; label: string };

export type TrayGlyph = "trayTemplate" | "trayLight" | "trayDark";

/**
 * Closing hides the last visible window instead of destroying it, so work
 * stays attached to it and Pine reopens instantly. A quit in progress, or
 * another window still open, closes normally.
 */
export function shouldHideOnClose(input: {
  active: boolean;
  quitting: boolean;
  visibleAppWindows: number;
}): boolean {
  return input.active && !input.quitting && input.visibleAppWindows <= 1;
}

/**
 * The macOS menu bar tints a template image itself. The Windows tray follows
 * the system theme, not Pine's, so it needs a glyph for each.
 */
export function trayGlyph(platform: string, systemDark: boolean): TrayGlyph {
  if (platform === "darwin") return "trayTemplate";
  return systemDark ? "trayDark" : "trayLight";
}

export function trayMenu(state: TrayState, chinese: boolean): TrayMenuEntry[] {
  const entries: TrayMenuEntry[] = [
    {
      type: "action",
      action: "open",
      label: chinese ? "打开 Pine" : "Open Pine",
    },
  ];
  if (state.quickComposerEnabled)
    entries.push({
      type: "action",
      action: "quick-composer",
      label: chinese ? "快速输入" : "Quick composer",
    });
  entries.push({ type: "separator" });
  entries.push({
    type: "status",
    label: chinese
      ? `远程控制：${state.remoteControl ? "已开启" : "已关闭"}`
      : `Remote Control: ${state.remoteControl ? "On" : "Off"}`,
  });
  if (state.runningSessions > 0)
    entries.push({
      type: "status",
      label: chinese
        ? `${state.runningSessions} 个会话正在运行`
        : state.runningSessions === 1
          ? "1 session running"
          : `${state.runningSessions} sessions running`,
    });
  entries.push({ type: "separator" });
  entries.push({
    type: "action",
    action: "quit",
    label: chinese ? "退出 Pine" : "Quit Pine",
  });
  return entries;
}
