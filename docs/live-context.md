# Pine Live Context（实时上下文）

> 状态：设计 + Phase 0 spike（实验开关后）  
> 范围：桌面端会议/课堂实时转写、转写持久化、工作台卡片、向会话注入上下文

## 1. 目标

用户开会或上课时，Pine 在本机实时转写麦克风和系统音频，转写文本作为当前会话的上下文，用户可以随时问“刚才老师说的期末范围是什么”“对方最后提的三个需求是什么”。

- 绑定单个会话，不是项目级。全应用同时只有一个采集。
- 来源：麦克风（我）和系统音频（会议软件、网课播放器里的其他人），v1 两者都支持。
- 平台：先只做 macOS 26+；其他平台隐藏或禁用入口并说明原因。
- 只保存文本，永不保存音频。
- 转写在本机完成（`SpeechAnalyzer` + `SpeechTranscriber`），音频不离开电脑。

非目标（v1 不做）：说话人分离（diarization）、云端 ASR、Windows/Linux、录音导出、会议纪要模板。

## 2. 已定决策

| 决策          | 结论                                                   |
| ------------- | ------------------------------------------------------ |
| 绑定范围      | 单会话；子会话与侧边对话默认不继承                     |
| 并发          | 全应用一个采集；其他会话的卡片显示“另一个对话正在记录” |
| 来源          | 麦克风 + 系统音频，各自独立转写                        |
| 说话人        | v1 以声道代替：mic = 我，system = 其他人               |
| 平台          | macOS 26+                                              |
| 存储          | 仅文本 JSONL，随会话删除                               |
| 采集/ASR 进程 | 随应用签名的 Swift 可执行 helper，不做 N-API addon     |

## 3. 架构

```text
Renderer (Vue)                Main process                       pine-live-context (Swift)
──────────────                ────────────                       ─────────────────────────
Live Context 卡片  ──IPC──▶  LiveContextService  ──stdin JSONL──▶  Controller
useLiveContextStore ◀─event─  ├─ 状态机 / 单采集                     ├─ MicrophoneCapture (AVAudioEngine)
                              ├─ volatile 节流 (150ms)              ├─ SystemAudioCapture (Core Audio process tap)
                              └─ 追加 final 段落到 JSONL ◀─stdout─   └─ SourcePipeline ×2 (SpeechAnalyzer)

Agent process (v1)  ◀── before_agent_start 拉取 live_context 增量
```

### 3.1 Swift helper：`apps/desktop/native/live-context`

SwiftPM 可执行包 `pine-live-context`，由 `scripts/build-native.mjs` 以 universal（arm64 + x86_64）构建到 `native/live-context/build/pine-live-context`。

- **麦克风**：`AVAudioEngine.inputNode` tap，原生格式经 `AVAudioConverter` 转成 `SpeechAnalyzer.bestAvailableAudioFormat`。
- **系统音频**：选 **Core Audio process tap**（`CATapDescription` + 私有 aggregate device，macOS 14.2+），不选 ScreenCaptureKit。理由：
  - 只需要“仅系统录音”（System Audio Recording Only）权限，不需要“屏幕录制”；用户看到的是录音提示而不是“录制你的屏幕”，心理负担小得多。
  - 不需要 SCShareableContent / 选窗口，没有屏幕录制的周期性再授权提醒。
  - 直接拿 PCM，延迟低。
  - 代价：macOS 没有公开 API 查询该权限；未授权时 tap 照常创建但只给静音。helper 用“系统源连续 10 秒峰值为 0”发出 `silent` 提示，由 UI 引导用户去设置检查。
- **转写**：每个来源一套 `SpeechAnalyzer` + `SpeechTranscriber`（`reportingOptions: [.volatileResults, .fastResults]`，`attributeOptions: [.audioTimeRange]`），因此声道天然区分“我/其他人”。启动前用 `SpeechTranscriber.supportedLocale(equivalentTo:)` 解析语言，用 `AssetInventory.assetInstallationRequest` 下载缺失的模型并上报进度。
- **时间轴**：分析器看到的是无间隙的音频时间（按整帧计数生成 `bufferStartTime`）；暂停造成的墙钟间隙记成偏移表，输出时映射回“距采集开始的毫秒”。两个来源共用同一时间轴。
- **生命周期**：一次采集一个 helper 进程；stdin 关闭即停止并退出，Pine 崩溃时 helper 不会继续收音。

#### 协议（JSON Lines）

stdin 命令：

```jsonc
{"type":"start","sources":["mic","system"],"locale":"zh-CN"}
{"type":"pause"}   {"type":"resume"}   {"type":"stop"}   {"type":"check"}
```

stdout 事件：

```jsonc
{"type":"ready","protocol":1,"pid":123}
{"type":"status","state":"preparing"}
{"type":"status","state":"downloading","progress":0.42}
{"type":"status","state":"listening","startedAt":1795037277822,"sources":["system"],"locale":"zh-CN"}
{"type":"status","state":"paused"} / {"type":"status","state":"stopped"}
{"type":"status","state":"silent","source":"system","seconds":10}
{"type":"permission","kind":"microphone","status":"prompting|granted|denied|restricted"}
{"type":"segment","id":"system-3","source":"system","t0":16014,"t1":26874,"text":"…","final":true,"at":1795037372391}
{"type":"error","code":"permission_denied|unsupported_locale|assets_failed|system_audio_failed|transcription_failed|…","message":"…","source":"mic"}
{"type":"capabilities","available":true,"supportedLocales":[…],"installedLocales":[…],"microphone":"undetermined","systemAudio":"unknown"}
```

`id` 在同一段 volatile 更新与其 final 版本间保持不变；`t0/t1` 是距采集开始的毫秒；`at` 是发出时的 Unix 毫秒，用于测延迟。

终端自测：

```sh
apps/desktop/native/live-context/build/pine-live-context --check
apps/desktop/native/live-context/build/pine-live-context --start --sources system --locale zh-CN --seconds 30
```

#### 签名、TCC 与 Info.plist

- 打包时复制到 `Pine.app/Contents/Resources/pine-live-context`，在 `signMacPackage` 中先单独签名（identifier `com.electron.pine.live-context`），再签整个 app。
- helper 是 Pine 的子进程，TCC 按“responsible process”把权限记在 **Pine** 名下，弹窗文案取 Pine 的 Info.plist。因此 `forge.config.ts` 的 `extendInfo` 写入 Pine 自己的 `NSMicrophoneUsageDescription` 与 `NSAudioCaptureUsageDescription`（Electron 默认文案是通用英文句子）。
- helper 自己也通过 `-sectcreate __TEXT __info_plist` 嵌入同样的用法说明，供独立运行时使用。
- 实测 `SpeechTranscriber` 不需要“语音识别”权限（不需要 `NSSpeechRecognitionUsageDescription`）。
- 目前 Pine 用 ad-hoc 签名、未开 hardened runtime，所以无需额外 entitlement。将来开启 hardened runtime 时需要 `com.apple.security.device.audio-input`（helper 与 app 都要）。
- **开发模式**：`bun run dev` 时 responsible process 是启动它的终端（或 Claude 桌面端），权限弹窗和系统设置里显示的是那个应用而不是 Pine。真实的 Pine 权限体验只能在打包后的 `Pine.app` 里验证。

### 3.2 Main process：`LiveContextService`

文件：`src/main/liveContext.ts`（与 Electron 无关、可单测），`src/main/desktop/liveContext.ts`（helper 路径、可用性、`ipcMain` 注册）。

- 状态机：`idle → preparing → (downloading) → listening ⇄ paused → stopping → idle`。helper 意外退出回到 `idle` 并带 `lastError: helper_exited`。
- 单采集：已有采集时 `start` 另一个会话会被拒绝；同一会话处于 `paused` 时 `start` 等同 `resume`。
- volatile 段落按来源节流（150 ms，只保留最新一条）后广播；final 段落立即广播并追加写入转写文件。
- `stop` 发送 `stop` 并关闭 stdin，最多等 5 秒让 helper 冲刷最后的 final，超时 kill。退出 Pine 时 `dispose` 直接结束 helper。
- 可用性：`PINE_EXPERIMENTAL_LIVE_CONTEXT=1`、macOS ≥ 26（`process.getSystemVersion()`）、helper 存在，三者缺一则 `available: false` 并给出 `unavailableReason`（`disabled | platform | helper-missing`）。

### 3.3 Renderer

- `src/stores/liveContext.ts`（Pinia）：全局状态、每个会话的 final 段落、采集会话的 volatile 段落；订阅 preload 事件，按 id 去重。
- `src/components/workbench/WorkbenchLiveContextPanel.vue`：工作台卡片 `live-context`。和侧边对话一样只由用户打开，不进入 agent 的 `ui_workbench_*` 工具，也暂不随布局保存。
- Renderer 不接触 Node、文件系统或 helper；一切经 preload 暴露的最小 API。

## 4. 数据模型

转写文件：

```text
<userData>/projects/<project-id>/live-context/<session-id>.jsonl
```

和 `side-chats/<session-id>/` 一样放在 Project 数据目录下按会话分文件，`ProjectRuntime.deleteSession` 删除会话时一并删除。

> 与最初设想的差异：没有放进 `sessions/` 目录。`ProjectSessionService` 会扫描 `sessions/*/` 下所有 `.jsonl` 当作会话文件，并清理“没有用户消息”的会话文件，转写文件放进去会被误读甚至误删。

每行一个 final 段落：

```jsonc
{
  "v": 1,
  "id": "mi3k2x-system-3",
  "source": "system",
  "start": 1795037361531,
  "end": 1795037372391,
  "text": "下一步我们需要在周四之前完成 API 的设计评审…",
}
```

- `id` = 采集 id（启动时间 base36）+ helper 段落 id，跨多次采集唯一。
- `start/end` 是 Unix 毫秒（`startedAt + t0/t1`）。
- 只存 final，不存 volatile，不存音频。
- v2 的滚动摘要另存 `live-context/<session-id>.summary.json`（见 §7）。

## 5. IPC API

只注册在 `ipcMain`，不进共享 router：浏览器访问和配对手机都无法启动本机麦克风。

```ts
window.pine.liveContext?: {
  status(): Promise<LiveContextStatus>;
  start(req: { projectId; sessionId; sources: ("mic" | "system")[]; locale }): Promise<LiveContextStatus>;
  pause(): Promise<LiveContextStatus>;
  resume(): Promise<LiveContextStatus>;
  stop(): Promise<LiveContextStatus>;            // 等待最后的 final 落盘
  transcript({ projectId, sessionId }): Promise<LiveContextSegment[]>;
  subscribe(listener: (event: LiveContextEvent) => void): () => void;
}
// LiveContextEvent = { kind: "status", status } | { kind: "segment", sessionId, segment }
```

参数在 main 用 zod 校验（projectId 为 uuid，sessionId 同侧边对话的安全字符集，locale 为 BCP 47）。类型定义见 `src/shared/liveContext.ts`。

## 6. 权限体验

| 权限     | 何时询问                                                         | 状态可读 | 拒绝后                                                                                                            |
| -------- | ---------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| 麦克风   | 首次以 mic 来源开始时，helper 调 `AVCaptureDevice.requestAccess` | 可以     | helper 报 `permission_denied`（source: mic），其余来源照常；卡片显示错误并引导到 系统设置 › 隐私与安全性 › 麦克风 |
| 系统录音 | 首次创建 process tap 并开始 IO 时由系统弹出                      | 不可以   | 只收到静音；10 秒无声后卡片提示到 系统设置 › 隐私与安全性 › 录屏与系统录音 中允许 Pine                            |
| 语音识别 | 不需要                                                           | —        | —                                                                                                                 |
| 模型下载 | 语言模型未安装时自动下载，卡片显示进度                           | —        | `assets_failed`                                                                                                   |

v1 待补：开始前的说明页（告诉用户将弹两个系统提示、音频不离开本机），“打开系统设置”按钮（用 `x-apple.systempreferences:` URL 经 main 打开，不自动改任何设置）。

## 7. 上下文注入设计（v1，本阶段未实现）

### 7.1 `live_context` 通知

沿用 `pine-context-notices` 扩展的 `before_agent_start` 钩子（`src/agent/runtime.ts`、`src/agent/runtime/context-notices.ts`），但语义不同于现有通知：

- 现有通知是“整体替换”（同一 key 的新内容覆盖旧内容）。直播转写若每轮整体替换，会在每个回合重复一大段文本，浪费 token。
- 因此 `live_context` 设计为**追加型**：每回合只附带“上次通知之后新 final 的段落”，并带上游标（最后一个段落 id）。从会话消息里回放所有 `live_context` 通知即可得到模型已看到的范围，与 `announcedContextNotices` 同一思路（压缩丢掉的通知等于模型没看到，会自然补发）。
- 追加在历史末尾，不改写前缀，prompt cache 前缀保持稳定。
- 发送时快照：用户按下发送的那一刻截止，之后产生的段落进入下一回合。
- 预算：单回合新增文本有 token 上限（初定 ~2k tokens）；超出时只发最近窗口原文 + 一句“更早内容可用 `read_live_transcript` 读取”。v2 起超出部分用滚动摘要代替。
- 格式示意：

```text
<live_context session_started="14:02" since="14:31:05" until="14:33:40">
[14:31:05 其他人] 下一步我们需要在周四之前完成 API 的设计评审……
[14:32:10 我] 那评审材料谁来准备？
</live_context>
```

- 数据来源：agent 运行在独立的 utility process，转写在 main。钩子通过现有 agent host 通道向 main 请求“session X 在游标之后的 final 段落”，main 从 `LiveContextService`（内存 + 文件）返回。
- 只对绑定的会话生效；子会话与侧边对话默认不继承（侧边对话可在 v1 后提供“带上实时上下文”开关）。

### 7.2 `read_live_transcript` 工具

供模型读取更早或完整的转写：参数 `{ from?: "HH:MM" | segmentId, to?, query?, limit? }`，返回带时间与说话人的段落。只在会话有转写文件时注册/可用。

### 7.3 引用到输入框

卡片里选中转写文本 → “引用到输入框”，以引用块插入 composer，便于“针对这句问”。

## 8. 工作台卡片

- 开始：来源（麦克风 / 系统音频，可多选）、语言（默认取系统语言，中文默认 `zh-CN`）。
- 采集中：红点 + 状态、暂停 / 继续、停止；模型下载进度；系统音频静音提示；错误。
- 转写：按时间排列，标注“我 / 其他人”与时间；volatile 文本用弱化颜色；用户停在底部时自动跟随。
- 状态：无会话；另一个会话正在记录（v1 加“跳转”按钮）；已停止（只读，可继续，继续时追加到同一文件）；不可用（说明原因）。
- v1 待补：会话标签/侧边栏上的录音指示；关闭正在录音的会话标签时询问是否停止；删除正在录音的会话时先停止采集；卡片随布局保存。

## 9. 分阶段

| 阶段                | 内容                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 spike（本次）** | Swift helper（mic + 系统音频 → SpeechTranscriber → JSONL）；dev 与打包构建集成；`LiveContextService` start/pause/resume/stop + 段落持久化；preload IPC；实验开关后的最小卡片                |
| **1**               | `live_context` 追加型通知 + `read_live_transcript` 工具 + 发送时快照；引用到输入框；录音指示与关标签确认；权限引导页；卡片布局持久化；去掉实验开关（或改为设置项）；`PINE_UI.md` 与用户文档 |
| **2**               | 滚动摘要（按时间窗由小模型生成，存 `summary.json`，注入时摘要 + 近期原文）；导出 Markdown；搜索                                                                                             |
| **3**               | 说话人分离；Windows/Linux（WASAPI loopback / PipeWire + 其他 ASR）；可选云端 ASR；更多语言与自定义词表（`AnalysisContext.contextualStrings`）                                               |

## 10. 实验开关

Phase 0 不对用户可见。启用方式：

```sh
PINE_EXPERIMENTAL_LIVE_CONTEXT=1 bun run dev
# 打包后的 app：
open --env PINE_EXPERIMENTAL_LIVE_CONTEXT=1 /Applications/Pine.app
```

开启后工作台卡片菜单出现“实时上下文 / Live context”。未开启时卡片不出现在任何菜单里，因此本阶段不更新 `PINE_UI.md`。

## 11. Spike 实测（macOS 27.0.1，Apple Silicon，Xcode SDK 26.2）

- `SpeechTranscriber.isAvailable = true`；支持 45 个 locale，本机已安装 `en-*`、`zh-CN`、`zh-TW`。
- 系统音频（`say` 播放）英文：final 段落在一句话结束后约 **0.7–1.0 s** 到达；volatile 文本约每 1 s 刷新一次，基本跟住语音。
- 中文（`say -v Tingting`）：整句基本准确，数字/百分比规范化良好（“百分之十五”→“15%”）。专有名词有误：“傅里叶变换”→“副理业变换”，中英混说 “pull request”→“plurequest”，“API”“Kevin” 正确。中文 final 往往在停顿处才出，单段可长达 ~10 s。
- 暂停/继续：`finalize(through: nil)` 后分析器对后续音频只输出 “.....”；`finalize(through: <最后一帧>)` 则永不返回。因此暂停时不 finalize，未定稿的 volatile 文本保留到继续或停止。
- 麦克风：未在本机实测（需要用户点击 TCC 弹窗，见交接说明）。

## 12. 风险与开放问题

- **回声/重复**：外放时麦克风会收到系统音频，同一句话可能被两个来源各转写一次。候选：`AVAudioEngine` voice processing（AEC）、耳机提示、或按时间与文本相似度去重。
- **系统录音权限不可查询**：只能用静音推断，误报（确实没在播放）与漏报都可能，需要好的 UI 文案。
- **输出设备切换**：aggregate device 绑定开始时的默认输出设备；中途切到 AirPods 可能断流，v1 需监听 `kAudioHardwarePropertyDefaultOutputDevice` 并重建 tap。
- **多语种混说**：一个 `SpeechTranscriber` 一个 locale；中英混说依赖 `zh-CN` 模型对英文词的处理，效果一般。可考虑 `contextualStrings` 提供术语表。
- **finalize 行为**：见 §11，可能是 macOS 27.0 的问题，后续版本需复测。
- **资源**：两个分析器并行常驻，内存与功耗需在长会议（1–2 h）下测量。
- **长会话注入成本**：追加型通知会让上下文持续增长；需要与会话压缩（compaction）配合，压缩后靠摘要 + 工具回读。
- **隐私**：录音指示必须始终可见；关闭窗口/退出应用必定停止；远程访问（浏览器、手机）不能启动采集（已通过只注册 `ipcMain` 保证）。
- **开放问题**：已停止的转写是否仍自动注入（倾向：注入直到用户“清除”，但只注入未发过的增量）；侧边对话是否允许显式继承；多个窗口同时显示同一会话时的交互。
