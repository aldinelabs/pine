/** Work that quitting would cut off, so the user is asked first. */
export interface QuitBlockers {
  /** Browser access (Remote Control) is serving connected browsers. */
  remoteControl: boolean;
  /** Sessions mid-run or still owning a running background task. */
  runningSessions: number;
  /** WeChat remote is bound and not paused. */
  wechat: boolean;
  /** WeChat remote lost its login and needs a new scan. */
  wechatNeedsScan: boolean;
}

/** Listening for tasks from WeChat; a lost login receives nothing anyway. */
function wechatReceiving(blockers: QuitBlockers): boolean {
  return blockers.wechat && !blockers.wechatNeedsScan;
}

export function hasQuitBlockers(blockers: QuitBlockers): boolean {
  return (
    blockers.remoteControl ||
    blockers.runningSessions > 0 ||
    wechatReceiving(blockers)
  );
}

export interface QuitConfirmationText {
  title: string;
  message: string;
  detail: string;
  /** Quit first, Cancel second. */
  buttons: [string, string];
}

export function quitConfirmationText(
  blockers: QuitBlockers,
  chinese: boolean,
): QuitConfirmationText {
  return {
    title: chinese ? "退出 Pine" : "Quit Pine",
    message: chinese ? "确定要退出 Pine 吗？" : "Quit Pine?",
    detail: blockerLines(blockers, chinese).join("\n"),
    buttons: chinese ? ["退出", "取消"] : ["Quit", "Cancel"],
  };
}

/** Switching users restarts Pine, which cuts off the same work as quitting. */
export function switchUserConfirmationText(
  blockers: QuitBlockers,
  chinese: boolean,
  name: string,
): QuitConfirmationText {
  return {
    title: chinese ? "切换用户" : "Switch User",
    message: chinese
      ? `要重新打开 Pine 并切换到“${name}”吗？`
      : `Restart Pine as ${name}?`,
    detail: blockerLines(blockers, chinese)
      .map((line) =>
        chinese
          ? line.replaceAll("退出", "切换")
          : line
              .replaceAll("Quitting", "Switching")
              .replace("after you quit", "after you switch"),
      )
      .join("\n"),
    buttons: chinese ? ["切换", "取消"] : ["Switch", "Cancel"],
  };
}

function blockerLines(blockers: QuitBlockers, chinese: boolean): string[] {
  const lines: string[] = [];
  const count = blockers.runningSessions;
  if (count > 0)
    lines.push(
      chinese
        ? `有 ${count} 个会话仍在运行，退出会中止它们和它们的后台任务。`
        : count === 1
          ? "A session is still running. Quitting stops it and its background tasks."
          : `${count} sessions are still running. Quitting stops them and their background tasks.`,
    );
  if (blockers.remoteControl)
    lines.push(
      chinese
        ? "远程控制正在运行，退出后已连接的浏览器会断开。"
        : "Remote Control is on. Browsers connected to Pine will be disconnected.",
    );
  if (wechatReceiving(blockers))
    lines.push(
      chinese
        ? "微信远程已开启，退出后将收不到从微信发来的任务。"
        : "WeChat remote is on. Tasks sent from WeChat will not arrive after you quit.",
    );
  return lines;
}
