/** Work that quitting would cut off, so the user is asked first. */
export interface QuitBlockers {
  /** Browser access (Remote Control) is serving connected browsers. */
  remoteControl: boolean;
  /** Sessions mid-run or still owning a running background task. */
  runningSessions: number;
}

export function hasQuitBlockers(blockers: QuitBlockers): boolean {
  return blockers.remoteControl || blockers.runningSessions > 0;
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
  return {
    title: chinese ? "退出 Pine" : "Quit Pine",
    message: chinese ? "确定要退出 Pine 吗？" : "Quit Pine?",
    detail: lines.join("\n"),
    buttons: chinese ? ["退出", "取消"] : ["Quit", "Cancel"],
  };
}
