# Pine Live Context（实时上下文）

> 状态：设计 + Phase 0 spike + 可选说话人识别（均在实验开关后）  
> 范围：桌面端会议/课堂实时转写、说话人识别、转写持久化、工作台卡片、向会话注入上下文

## 1. 目标

用户开会或上课时，Pine 在本机实时转写麦克风和系统音频，转写文本作为当前会话的上下文，用户可以随时问“刚才老师说的期末范围是什么”“对方最后提的三个需求是什么”。

- 绑定单个会话，不是项目级。全应用同时只有一个采集。
- 来源：麦克风（我）和系统音频（会议软件、网课播放器里的其他人），v1 两者都支持。
- 平台：先只做 macOS 26+；其他平台隐藏或禁用入口并说明原因。
- 只保存文本，永不保存音频。
- 转写在本机完成（`SpeechAnalyzer` + `SpeechTranscriber`），音频不离开电脑。

- 可选说话人识别（diarization，默认关闭）：在每个来源内部区分“说话人 1/2/3…”，让线下课堂/会议（全在麦克风里）和多人线上会议（全在系统音频里）也能分清是谁说的。同样在本机完成，见 §3.4。

非目标（v1 不做）：云端 ASR、Windows/Linux、录音导出、会议纪要模板。

## 2. 已定决策

| 决策          | 结论                                                                                    |
| ------------- | --------------------------------------------------------------------------------------- |
| 绑定范围      | 单会话；子会话与侧边对话默认不继承                                                      |
| 并发          | 全应用一个采集；其他会话的卡片显示“另一个对话正在记录”                                  |
| 来源          | 麦克风 + 系统音频，各自独立转写                                                         |
| 说话人        | 默认以声道代替：mic = 我，system = 其他人；开启“识别说话人”后每个来源内部再编号（§3.4） |
| 平台          | macOS 26+                                                                               |
| 存储          | 仅文本 JSONL，随会话删除                                                                |
| 采集/ASR 进程 | 随应用签名的 Swift 可执行 helper，不做 N-API addon                                      |

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

#### 说话人协议（可选）

`start` 带上 `speakers` 才会加载任何 diarization 相关的东西；不带时 helper 的行为、CPU 和内存与之前完全一致。

```jsonc
// stdin
{"type":"start","sources":["system"],"locale":"zh-CN",
 "speakers":{"segmentation":"…/pyannote-segmentation-3.0.int8.onnx","embedding":"…/3dspeaker-campplus-zh-en-16k-advanced.onnx",
             "voices":{"system":[{"speaker":1,"centroid":[…192 floats…],"count":12}]},
             "threshold":0.6,"maxSpeakers":8}}
// stdout
{"type":"status","state":"listening",…,"speakers":true}
{"type":"speaker","id":"system-3","source":"system","speaker":2,
 "turns":[{"offset":0,"speaker":1},{"offset":23,"speaker":2}],"confidence":0.84,"at":…}
{"type":"voices","source":"system","voices":[{"speaker":1,"centroid":[…],"count":40}]}   // 停止时，每个来源一条
{"type":"error","code":"speakers_unavailable","message":"…"}                               // 库或模型加载失败，转写照常
```

- `speaker` 是来源内的编号（从 1 起）。`turns` 把段落文本按说话人切开：`offset` 是 UTF-16 偏移（与 JS 字符串一致），第一段从 0 开始。同一段落的标签可以多次更新（volatile 期间就会给出，final 后还会修正），每次都是完整的 `turns`。
- `speaker` 事件总在对应的 `segment` 事件之后发出。
- `confidence` 是该段落各部分与所属说话人声纹的余弦相似度（按时长加权，0–1），仅供参考。
- `voices` 是声纹（归一化 embedding 均值 + 样本数），不是音频。下次同一会话开始时由 main 传回，编号因此跨多次采集保持一致。

终端自测（`--file` 用音频文件代替第一个来源的设备，`--speed` 加速喂入；同时适用于 stdin 启动）：

```sh
apps/desktop/native/live-context/build/pine-live-context --start --sources system --locale zh-CN \
  --file meeting.wav --speed 4 --segmentation seg.onnx --embedding emb.onnx
```

`PINE_LIVE_CONTEXT_DEBUG=1` 时在 stderr 输出最终的说话人区间，便于和标注对照。

### 3.2 Main process：`LiveContextService`

文件：`src/main/liveContext.ts`（与 Electron 无关、可单测），`src/main/desktop/liveContext.ts`（helper 路径、可用性、`ipcMain` 注册）。

- 状态机：`idle → preparing → (downloading) → listening ⇄ paused → stopping → idle`。helper 意外退出回到 `idle` 并带 `lastError: helper_exited`。
- 单采集：已有采集时 `start` 另一个会话会被拒绝；同一会话处于 `paused` 时 `start` 等同 `resume`。
- volatile 段落按来源节流（150 ms，只保留最新一条）后广播；final 段落立即广播并追加写入转写文件。
- `stop` 发送 `stop` 并关闭 stdin，最多等 5 秒让 helper 冲刷最后的 final，超时 kill。退出 Pine 时 `dispose` 直接结束 helper。
- 可用性：`PINE_EXPERIMENTAL_LIVE_CONTEXT=1`、macOS ≥ 26（`process.getSystemVersion()`）、helper 存在，三者缺一则 `available: false` 并给出 `unavailableReason`（`disabled | platform | helper-missing`）。`speakersAvailable` 另外要求 helper 旁边有 `live-context-lib/`（构建没取到 sherpa-onnx 时为 false，卡片不显示开关）。
- 说话人：`start({ speakers: true })` 先确保模型就绪（缺失时下载，状态 `downloading` + `download: "speakers"`），再读会话的声纹文件、按用户的合并折叠同一来源的声纹，随 `start` 交给 helper。模型拿不到时照常开始转写，`lastError.code = "speaker_models_failed"`。下载期间 `stop` 直接回到 idle，不启动 helper。
- helper 的 `speaker` 事件：段落还没 final 时先记在内存、广播给 renderer；final 段落落盘时带上 `turns`；之后的修正追加 `turns` 记录。`voices` 事件写入声纹文件。

### 3.3 Renderer

- `src/stores/liveContext.ts`（Pinia）：全局状态、每个会话的 final 段落、采集会话的 volatile 段落、每个会话的说话人名字与合并、“识别说话人”开关（默认关）；订阅 preload 事件，按 id 去重，`turns` 事件同时作用于 volatile 和 final 段落。
- `src/shared/liveContextSpeakers.ts`：说话人 key、重命名/合并的折叠、按 `turns` 切分文本，main 与 renderer 共用。
- `src/components/workbench/WorkbenchLiveContextPanel.vue`：工作台卡片 `live-context`。和侧边对话一样只由用户打开，不进入 agent 的 `ui_workbench_*` 工具，也暂不随布局保存。
- Renderer 不接触 Node、文件系统或 helper；一切经 preload 暴露的最小 API。

### 3.4 说话人识别（diarization）

目标：同一来源里的多个人分开标注（“说话人 1/2/3…”），可改名、可合并。实验开关后、卡片上的“识别说话人”开关打开才生效，默认关闭。

**引擎**：[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 2.0.1 的 C API（含 ONNX Runtime），在 helper 进程内运行，不新开进程：

- 分割：pyannote segmentation-3.0（sherpa-onnx 的 int8 导出，1.5 MB）。
- 声纹：3D-Speaker CAM++ `zh_en_16k-common_advanced`（28 MB，192 维，中英文混合训练）。选它而不是 ERes2Net/WeSpeaker：同尺寸里唯一同时覆盖中文与英文的；ERes2Net base 40 MB 且只训中文，WeSpeaker ResNet34 26 MB 只训英文或中文之一。
- 加载方式：`CSherpaOnnx/sherpa_onnx_loader.c` 用 `dlopen` 打开 `live-context-lib/libsherpa-onnx-c-api.dylib`。helper 不链接它，所以库缺失时转写照常，关闭说话人时进程里根本没有这两个库。结构体按 v2.0.1 的 `c-api.h` 镜像，升级版本时一起改。
- 为什么一个进程：音频已经在 helper 里且两条管线共享时间轴，单独进程要再传一份 PCM；推理放在 helper 内一个 utility QoS 串行队列上，两个来源共用，最多占一个核。

**流式算法**（`Sources/Diarization.swift`，每个来源一个 `SpeakerTracker`）：

1. 与分析器拿到的是同一份音频（转成 16 kHz 单声道），时间轴一致。
2. 每 2 s 新音频跑一次：取最近 10 s（pyannote 一个窗口）。只给一个窗口时 sherpa-onnx 只跑分割模型，不算 embedding、不聚类，相当于“只分割”。新音频 RMS 低于 −50 dBFS 时整段跳过。
3. 只处理上次之后新出现的语音（窗口末尾 0.5 s 留到下次）。每个含新语音的 turn 算一个 embedding：只取这个 turn 里没有别人同时说话的部分，最多最近 6 s，不足 1.5 s 时用同一本地说话人附近的 turn 补足。最初的实现是把整个窗口里同一本地说话人的音频拼起来，分割一出错就混入别人的声音，所以改成按 turn。
4. 在线聚类：与各说话人声纹（归一化 embedding 之和）的余弦相似度 ≥ 0.6 归入最接近的一位并更新声纹（≥ 1 s 的音频才更新）；否则在未达上限（8 位）且音频 ≥ 1 s 时新建说话人；否则归入最接近的。成本与时长无关。
5. 段落切分：SpeechTranscriber 常把间隔不到 1 s 的多人发言并成一个 10–15 s 的段落，所以不按段落贴一个标签，而是用转写结果每个文本 run 的 `audioTimeRange`，每个词归给覆盖它的说话人（没有覆盖时取 2 s 内最近的），短于 0.5 s 的片段并入相邻片段，得到 `turns`。
6. 停止时的重整：用本次采集存下的 embedding（不是音频）重建声纹，合并相似度 ≥ 阈值的说话人，再把每个区间重新分给最近的说话人，修正早期证据不足时的标签，然后输出 `voices`。

**模型与库的分发**：

- 库随应用打包：`scripts/build-native.mjs` 下载固定版本的 `sherpa-onnx-v2.0.1-osx-universal2-shared-no-tts-lib.tar.bz2`，先校验 SHA-256 再解出 `libsherpa-onnx-c-api.dylib` 和 `libonnxruntime.dylib` 到 `native/live-context/build/live-context-lib/`；失败时只是没有说话人识别（`PINE_REQUIRE_LIVE_CONTEXT=1` 时报错）。打包时 `forge.config.ts` 把它们 `lipo -thin` 到目标架构并单独签名，再签 helper 和整个 app。代码必须随应用签名，所以库不走运行时下载。
- 模型首次开启时下载：`src/main/liveContextSpeakerModels.ts` 固定 URL（sherpa-onnx 的 GitHub release）、字节数和 SHA-256，经 Electron `net.fetch`（跟随系统代理，与 Pine 其他请求一致）下载到 `<userData>/models/live-context-speakers/`，超出字节数立即中止，校验不过不落地；分割模型在 tar.bz2 里，校验归档后用 `/usr/bin/tar` 只解出那一个文件，再校验文件本身。每次开始前重新校验哈希，损坏的会重下。下载的只是 ONNX 权重，从不执行。
- 体积：每个架构的应用包增加约 32 MB（arm64 实测：ONNX Runtime 28.8 MB + C API 3.4 MB，未压缩；universal 原件为 68 MB）；首次开启下载约 35 MB（归档 7.0 MB + 声纹模型 28.3 MB），解出后约 30 MB。不随应用捆绑模型，是因为功能默认关闭、只在实验开关后，没必要让每个用户多下载 30 MB。
- 许可证（详见 `native/live-context/NOTICE.md`，随库一起打包）：sherpa-onnx Apache-2.0、ONNX Runtime MIT、pyannote segmentation-3.0 MIT、3D-Speaker CAM++ Apache-2.0，均可随 AGPL-3.0 分发。

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
- 开启说话人识别时，段落行多一个 `turns`（key 形如 `system-2`）：`"turns":[{"offset":0,"speaker":"system-1"},{"offset":23,"speaker":"system-2"}]`。

同一文件里还会追加三类记录，读取时按顺序折叠，历史只追加不改写（没有 `type` 的行是段落，旧文件照常可读，未知 `type` 忽略）：

```jsonc
{"v":1,"type":"turns","id":"mi3k2x-system-3","turns":[…]}               // 标签修正，以最后一条为准
{"v":1,"type":"speaker-name","speaker":"system-2","name":"Alice"}       // 改名，空字符串恢复默认
{"v":1,"type":"speaker-merge","from":"system-3","into":"system-2"}     // 合并；可跨来源，链式解析，不会成环
```

- 说话人 key 为 `<source>-<n>`：麦克风与系统音频是两个命名空间，只有用户合并时才相连。
- 声纹另存 `live-context/<session-id>.voices.json`（`{"v":1,"voices":{"mic":[…],"system":[…]}}`，每次采集结束覆盖对应来源）。它是由语音算出的 192 维向量而非音频，只用来让下次采集沿用同样的编号；与转写文件一起随会话删除。下次开始时，同一来源内的合并会先折叠进声纹。
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
  transcript({ projectId, sessionId }): Promise<{ segments: LiveContextSegment[]; speakers: { names; merges } }>;
  renameSpeaker({ projectId, sessionId, speaker, name }): Promise<LiveContextSpeakers>;
  mergeSpeakers({ projectId, sessionId, from, into }): Promise<LiveContextSpeakers>;
  subscribe(listener: (event: LiveContextEvent) => void): () => void;
}
// start 的请求另有可选 speakers: boolean
// LiveContextEvent = { kind: "status", status } | { kind: "segment", sessionId, segment }
//   | { kind: "turns", sessionId, segmentId, turns } | { kind: "speakers", sessionId, speakers }
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

- 开始：来源（麦克风 / 系统音频，可多选）、语言（默认取系统语言，中文默认 `zh-CN`）、“识别说话人”开关（默认关；本构建没有说话人库时不显示），下面一行说明成本与准确度（首次下载约 35 MB、多占一些 CPU、标签晚几秒且可能出错）。
- 说话人：开启后每段转写按说话人切成多行，每行前是彩色圆点 + 来源图标 + 名字（默认“说话人 N”）。点名字弹出菜单：重命名（行内输入框，回车保存、Esc 取消）、合并到另一位说话人。还在形成中的文本，标签半透明，表示可能变化。
- 采集中：红点 + 状态、暂停 / 继续、停止；模型下载进度；系统音频静音提示；错误。
- 转写：按时间排列，标注“我 / 其他人”与时间；volatile 文本用弱化颜色；用户停在底部时自动跟随。
- 状态：无会话；另一个会话正在记录（v1 加“跳转”按钮）；已停止（只读，可继续，继续时追加到同一文件）；不可用（说明原因）。
- v1 待补：会话标签/侧边栏上的录音指示；关闭正在录音的会话标签时询问是否停止；删除正在录音的会话时先停止采集；卡片随布局保存。

## 9. 分阶段

| 阶段                | 内容                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 spike（本次）** | Swift helper（mic + 系统音频 → SpeechTranscriber → JSONL）；dev 与打包构建集成；`LiveContextService` start/pause/resume/stop + 段落持久化；preload IPC；实验开关后的最小卡片；可选说话人识别（§3.4） |
| **1**               | `live_context` 追加型通知 + `read_live_transcript` 工具 + 发送时快照；引用到输入框；录音指示与关标签确认；权限引导页；卡片布局持久化；去掉实验开关（或改为设置项）；`PINE_UI.md` 与用户文档          |
| **2**               | 滚动摘要（按时间窗由小模型生成，存 `summary.json`，注入时摘要 + 近期原文）；导出 Markdown；搜索                                                                                                      |
| **3**               | Windows/Linux（WASAPI loopback / PipeWire + 其他 ASR）；可选云端 ASR；更多语言与自定义词表（`AnalysisContext.contextualStrings`）                                                                    |

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

### 11.1 说话人识别实测（同一台 Mac：Apple M5 Pro，macOS 27.0.1）

测试素材：`say` 生成的多人对话（中文 4 人约 65 s、英文 4 人约 50 s，轮次间隔 0.2–0.8 s，含 0.5–0.8 s 的重叠），以及 sherpa-onnx 自带的真人 4 人中文录音 `0-four-speakers-zh.wav`（56 s，以 sherpa-onnx 全量离线聚类、已知 4 人的结果作参考）。helper 用 `--file` 输入，准确度按 10 ms 帧、仅单人说话的时段、说话人与真值一对一最优匹配计算（近似 1 − DER，不计重叠段）。

| 素材                                                | 阈值 0.6 结果                             | 说明                                                           |
| --------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| 真人 4 人中文                                       | 93.7% 一致，5 个说话人（多出 1 个很短的） | 阈值 0.5 时只有 80.6%（两人被并成一个）                        |
| `say` 英文 4 人（Daniel/Karen/Ralph/Kathy）         | 91.9%                                     | 4 人全部分开                                                   |
| `say` 中文 4 人（Tingting/Meijia/Reed/Sinji）       | 73.1%                                     | Tingting 与 Meijia 两个女声被并成一人（CAM++ 相似度均值 0.61） |
| `say` 中文 4 人（Tingting + 3 个 Eloquence 合成声） | 52.5%                                     | 压力测试：同一合成引擎的声音彼此相似度 0.6–0.75，只分出 2 人   |

合成声音彼此远比真人接近，所以 `say` 素材偏悲观；真人录音只有一段，且参考也是模型结果，不是人工标注。

资源（69 s 中文素材 1× 实时喂入，`/usr/bin/time -l`）：

|                               | 不开说话人                | 开说话人                                 |
| ----------------------------- | ------------------------- | ---------------------------------------- |
| helper CPU（user+sys / 墙钟） | 0.77 s / 71 s ≈ 1.1% 单核 | 4.56 s / 71 s ≈ 6.4% 单核                |
| 其中 diarization 推理         | —                         | 3.6 s（35 次，约 0.1 s/次，每 2 s 一次） |
| helper 峰值 RSS / footprint   | 23 MB / 10 MB             | 221 MB / 192 MB                          |

（转写本身在系统的语音服务进程里，不计入 helper。）内存分布（单独测）：ONNX Runtime + 第一份 CAM++ 约 100 MB；sherpa-onnx 的离线 diarizer 句柄要求同时加载一份 embedding 模型，C API 无法只加载分割模型，多约 40 MB；推理 arena 约 35–65 MB。

标签延迟：标签通常在段落还是 volatile 时就已给出（比 final 早 1–19 s，随段落长度）；final 之后的最后一次修正一般在 0–3 s 内；停止时的重整可能再改动个别早期段落。

## 12. 风险与开放问题

- **说话人识别**：相似的声音（同性别、同口音、合成声）会被并成一人，阈值 0.6 是在上表素材上选的折中；轮次切换处前后一两个字可能归错人；重叠说话只归给一人；麦克风与扬声器回声会让同一个人在两个来源里各出现一次（需要用户合并）；内存约 +200 MB，若要降低，可直接用 ONNX Runtime 跑分割模型以去掉重复加载的 embedding 模型，或换 int8 声纹模型。

- **回声/重复**：外放时麦克风会收到系统音频，同一句话可能被两个来源各转写一次。候选：`AVAudioEngine` voice processing（AEC）、耳机提示、或按时间与文本相似度去重。
- **系统录音权限不可查询**：只能用静音推断，误报（确实没在播放）与漏报都可能，需要好的 UI 文案。
- **输出设备切换**：aggregate device 绑定开始时的默认输出设备；中途切到 AirPods 可能断流，v1 需监听 `kAudioHardwarePropertyDefaultOutputDevice` 并重建 tap。
- **多语种混说**：一个 `SpeechTranscriber` 一个 locale；中英混说依赖 `zh-CN` 模型对英文词的处理，效果一般。可考虑 `contextualStrings` 提供术语表。
- **finalize 行为**：见 §11，可能是 macOS 27.0 的问题，后续版本需复测。
- **资源**：两个分析器并行常驻，内存与功耗需在长会议（1–2 h）下测量。
- **长会话注入成本**：追加型通知会让上下文持续增长；需要与会话压缩（compaction）配合，压缩后靠摘要 + 工具回读。
- **隐私**：录音指示必须始终可见；关闭窗口/退出应用必定停止；远程访问（浏览器、手机）不能启动采集（已通过只注册 `ipcMain` 保证）。
- **开放问题**：已停止的转写是否仍自动注入（倾向：注入直到用户“清除”，但只注入未发过的增量）；侧边对话是否允许显式继承；多个窗口同时显示同一会话时的交互。
