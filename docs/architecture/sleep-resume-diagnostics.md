# 睡眠恢复后项目与会话加载故障排查

## 当前结论

2026-09-29 的反馈是：睡眠恢复后，新项目的会话列表出现“加载会话失败”提示，也有人反馈无法添加上下文文件夹。排查时本机 Pine 0.6.4 已恢复，未捕获故障现场，因此尚不能确定根因或宣布修复。

“加载会话失败”来自 renderer 的异常处理，不能单凭该提示认定 Electron IPC 断开。具体链路是：

- 会话列表：preload invoke → `sessions:search` → `ProjectSessionService.search` → JSONL 文件扫描与 SQLite 查询，不依赖 agent utility process。
- 打开项目：`projects:open` → 旧 runtime 释放 → 创建新 runtime。释放旧的活动会话需要等待 agent 的 `session:dispose`。
- 保存上下文文件夹：`projects:update` → 更新项目元数据 → 重新打开 runtime，同样可能等待旧 agent 会话释放。
- 选择上下文文件夹：`projects:pick-folders` → Electron 原生目录选择窗口，本身不依赖 agent。

排查时主进程和 agent 均存活，短时原生调用栈未显示持续阻塞。代码中的 agent stdout/stderr 使用 `pipe`，却未消费，存在输出积累后阻塞的风险，现已开始持续排空。这是独立确认的缺陷，并非已证实的睡眠故障原因。

其他待核实路径：agent 请求没有超时；agent 退出后，主进程保存的活动会话状态不会同步失效；旧会话释放失败会中断项目 runtime 的重建。这些都需要故障日志才能判断是否与此次反馈有关。

## 复现时收集什么

诊断日志默认关闭，在全局「Pine 设置 → 通用 → 诊断日志」中开启，立即生效，重启后保留开关状态。开启后在 `app.getPath("logs")` 下写入 `runtime-diagnostics.jsonl`。macOS 默认位置为 `~/Library/Logs/Pine/runtime-diagnostics.jsonl`。日志超过 1 MiB 时轮换为 `.1`，保留当前和上一份，总量最多约 2 MiB。这是按容量滚动保留，不按天过期。关闭后停止记录，已有日志保留。

日志记录应用版本、睡眠与恢复、锁屏与解锁、renderer 或 utility process 退出、preload 错误，以及项目和会话相关 IPC 的开始、完成、异常与耗时。超过 15 秒尚未完成的请求会写一条 `ipc:pending`；它是观测记录，不会取消请求，目录选择窗口等用户操作可以正常继续。

不记录 IPC 参数、会话正文、搜索内容或成功返回的数据。错误消息和调用栈可能包含本机文件路径。日志仅保存在本机，不自动上传。

请反馈者先开启诊断日志，再复现；故障出现后提供：

1. 故障发生时间，以及关闭并重新打开 Pine 是否恢复。
2. 两份诊断日志（如果 `.1` 存在，一并保留）。
3. 添加文件夹时，目录选择窗口是否出现；如果出现，是选中目录后失败还是保存项目后失败。

分析时按 `requestId` 匹配 `ipc:start` 与 `ipc:error` / `ipc:complete`，并与 `power:resume` 和进程退出记录对齐：

- `sessions:search` 有 `ipc:error`：查看异常与调用栈，区分 runtime 不存在、文件读取失败和 SQLite 错误。
- 有开始但只有 `ipc:pending`：请求进入主进程但未完成，需要结合调用栈继续定位等待点。
- 故障操作附近没有对应 IPC 开始记录：继续检查 preload、renderer 及 Electron 消息传递。
- agent 退出后项目操作失败：检查主进程中的会话状态和释放路径。

不要在根因未确认时对每次 resume 强制重启 agent 或重载窗口；这会中断运行中的任务，也可能掩盖实际错误。
