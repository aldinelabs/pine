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

`start` 带上 `speakers` 才会加载任何 diarization 相关的东西；不带时 helper 的行为、CPU 和内存与之前完全一致。helper 只负责“听”：门控、分割、提取声纹、回声检测；“谁是谁”（聚类、编号、重标、持久化、停止时的重整）全在 main（§3.4）。

```jsonc
// stdin
{"type":"start","sources":["mic","system"],"locale":"zh-CN",
 "speakers":{"segmentation":"…/pyannote-segmentation-3.0.int8.onnx","embedding":"…/campplus-zh-en.onnx"}}
// stdout：时间都是该来源分析器时间轴上的秒（两位小数）
{"type":"window","source":"system","id":17,"t0":30,"t1":40,"slow":true,"turns":[[30.4,33.1,0],[32.8,39.6,1]],"at":…}
{"type":"window","source":"system","id":18,"t0":40,"t1":43,"slow":false,"after":17,"turns":[[40,42.7,0]],"at":…}
{"type":"embedding","source":"system","window":17,"local":1,"t0":33.1,"t1":36.1,"seconds":3,"quality":0.82,"vector":"<192 个 float16，小端，base64>"}
{"type":"echo","source":"mic","t0":12,"t1":13.5,"correlation":0.91}
{"type":"device","source":"mic"}                        // 设备变了，之后的声音可能变样
{"type":"speakers-state","level":2,"reason":"thermal"}  // 降级等级 0–4；reason：load | thermal | power
{"type":"segment",…,"a0":30.4,"a1":39.6,"words":[[0,30.4,31],[3,31,31.6],…]}
{"type":"error","code":"speakers_unavailable","message":"…"} // 库或模型加载失败，转写照常
```

- `window` 是一次分析的范围。慢窗（`slow: true`）是 pyannote 对最近 10 s 的分割，`turns` 第三项是窗口内的本地说话人编号；快窗是一个 3 s 块，只有一个声音，`turns` 是其中的语音片段，`after` 指向它延续的上一个窗口。
- `embedding` 属于某个窗口里的某个本地说话人（`window` + `local`）；`quality`（0–1）综合时长、信噪比和独占比例。
- 开启说话人时 `segment` 多出分析器时间 `a0`/`a1` 和逐词时间 `words`（`[UTF-16 偏移, 开始, 结束]`），main 据此把每个词归给说话人。
- `echo` 标出麦克风里其实是系统音频的回声的时段；`device` 在输入或输出设备变化时发出。

终端自测（`--file` 用音频文件代替第一个来源，`--mic-file`/`--system-file` 分别指定，两个一起即可测回声；`--speed` 加速喂入；用文件代替麦克风时不请求麦克风权限）：

```sh
apps/desktop/native/live-context/build/pine-live-context --start --sources system --locale zh-CN \
  --file meeting.wav --speed 4 --segmentation seg.onnx --embedding emb.onnx
```

环境变量：`PINE_LIVE_CONTEXT_DEBUG=1` 在 stderr 打印回声判定；`PINE_LIVE_CONTEXT_PROVIDER=coreml` 试用 CoreML；`PINE_LIVE_CONTEXT_THERMAL=serious|critical`、`PINE_LIVE_CONTEXT_LOW_POWER=1` 模拟发热与低电量模式。

### 3.2 Main process：`LiveContextService`

文件：`src/main/liveContext.ts`（与 Electron 无关、可单测），`src/main/desktop/liveContext.ts`（helper 路径、可用性、`ipcMain` 注册）。

- 状态机：`idle → preparing → (downloading) → listening ⇄ paused → stopping → idle`。helper 意外退出回到 `idle` 并带 `lastError: helper_exited`。
- 单采集：已有采集时 `start` 另一个会话会被拒绝；同一会话处于 `paused` 时 `start` 等同 `resume`。
- volatile 段落按来源节流（150 ms，只保留最新一条）后广播；final 段落立即广播并追加写入转写文件。
- `stop` 发送 `stop` 并关闭 stdin，最多等 5 秒让 helper 冲刷最后的 final，超时 kill。退出 Pine 时 `dispose` 直接结束 helper。
- 可用性：`PINE_EXPERIMENTAL_LIVE_CONTEXT=1`、macOS ≥ 26（`process.getSystemVersion()`）、helper 存在，三者缺一则 `available: false` 并给出 `unavailableReason`（`disabled | platform | helper-missing`）。`speakersAvailable` 另外要求 helper 旁边有 `live-context-lib/`（构建没取到 sherpa-onnx 时为 false，卡片不显示开关）。
- 说话人：`start({ speakers: true })` 先确保模型就绪（缺失时下载，状态 `downloading` + `download: "speakers"`），再回放会话的 `<session>.speakers.jsonl`，让编号跨多次采集延续。模型拿不到时照常开始转写，`lastError.code = "speaker_models_failed"`。下载期间 `stop` 直接回到 idle，不启动 helper。
- helper 的 `window`/`embedding`/`echo`/`device` 事件交给 `SpeakerSession`（`src/main/liveContextDiarizer.ts`，纯 TS、确定性、可回放）并追加写入 sidecar。它给出的标签以 `turns` 事件广播：段落还没 final 时只在内存里，final 段落落盘时带上，之后的修正追加 `turns` 记录；Pine 自己合并说话人时追加 `speaker-alias`。helper 退出后跑停止时的重整（§3.4 第 8 步），结果同样以 `turns` 记录追加。
- `speakers-state` 映射为 `status.speakersDegraded`：等级 1–3 为 `reduced`，4 为 `paused`，0 清除。

### 3.3 Renderer

- `src/stores/liveContext.ts`（Pinia）：全局状态、每个会话的 final 段落、采集会话的 volatile 段落、每个会话的说话人名字、合并与别名、“识别说话人”开关（默认关）；订阅 preload 事件，按 id 去重，`turns` 事件（含 `echo`）同时作用于 volatile 和 final 段落。
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

**分工**：helper（Swift）管音频：环形缓冲、门控、分割、声纹提取、回声检测，只输出 `window`/`embedding`/`echo`/`device` 事件，不做任何“谁是谁”的判断。main（`src/main/liveContextDiarizer.ts`）管身份：约束聚类、别名表、重标、持久化、停止时的重整。这一半是纯函数式、确定性的，可以从 sidecar 原样回放，用 Vitest 和合成高斯簇测试（`__tests__/liveContextDiarizer.test.ts`，16 个场景）。

**helper 管线**（`Sources/Diarization.swift`，每个来源一个 `SpeakerTracker`，共用一个 utility QoS 串行队列）：

1. **门控**：10 ms 帧能量 VAD，噪声底自适应（下降立即跟随，上升每帧 ×1.0005）；帧电平 > max(0.003, 噪声底 × 2.5) 记为语音。一个 hop 里语音不足 20% 时跳过，不推理。
2. **回声**（`EchoGuard`）：麦克风与系统音频的 10 ms 能量包络做归一化互相关，延迟 0–300 ms（另容许 50 ms 超前），系统音频活跃 ≥ 40% 且相关 ≥ 0.8 记为回声。包络按样本计数对时，漂移超过 0.5 s 时重新对齐。回声段不提取麦克风声纹，慢窗的 turns 也扣掉回声段。
3. **快路径**：每个 hop（1.5 s）取最近 3 s 语音算一个 embedding。若它与本来源“当前声音”（运行向量，EMA 0.7/0.3）的余弦 ≥ 0.65，且这 3 s 里没有 ≥ 0.35 s 的停顿、没有 > 8 dB 的响度跳变、不是静音后的新起音，就作为快窗发出，`after` 指向上一个窗口，在 main 里直接接上前一个说话人。
4. **慢路径**：不满足连续性（相似度下降、停顿、起音、响度跳变）时，对最近 10 s 跑 pyannote 分割，按本地说话人发出慢窗，最多每 2.5 s 一次。慢窗只为上次之后的新语音提取声纹（`embeddedUntil`）。
5. **声纹策略**：只用无重叠、非回声的语音；每个本地说话人取最近最多 3 s 的连续语音（相隔 > 1.5 s 的片段不拼接，避免分割出错时混入别人），总长 ≥ 1 s 且最近 0.3 s 内有语音才提取；短于 1 s 的附和（“嗯”“对”）不出声纹，只按时间跟随邻近的说话人。质量 = 时长因子 × 信噪比因子 × 独占比例。

**main 聚类**（`SourceDiarizer`，每个来源一个，编号空间互相独立）：

6. **约束在线聚类**：
   - 单元是（窗口，本地说话人）。同一慢窗的不同本地说话人互为 cannot-link；相邻慢窗按时间重叠缝合为 must-link（≥ 0.5 s 且占两边各 ≥ 50%）；快窗 must-link 到 `after` 窗口的最后一个单元。
   - 说话人模型 = 加权 EMA 中心 + 多样性储备池（≤ 20 个）；得分 = max(与中心的余弦, 与储备池前 3 的均值)。
   - 双阈值：≥ τ_hi（0.6）归入并学习；< τ_lo（0.4）视为新声音；中间是模糊带，进入候选缓冲，标签先显示“?”。有 must-link 先验时得分 ≥ (τ_hi+τ_lo)/2 即接受，但只有 ≥ τ_hi 才学习。
   - 新说话人只从候选缓冲产生：≥ 2 个彼此相似的 embedding、覆盖 ≥ 3 s 语音（设备切换后的一段时间加倍），在此之前标为“?”。
   - 每个来源自适应 τ_hi：用 ≥ τ_lo 的归入得分估计 μ−2σ，限制在 [基准−0.05, 基准+0.1]。
   - 最多 12 位；`expectedSpeakers`（“大约 N 人”）把上限设为 N+1 并让合并更积极。
7. **定期合并**（每 90 s）：只看说话人模型，储备池平均连接 ≥ τ_hi+0.05（超过预期人数时 ≥ τ_lo+0.1），两人曾在同一窗口里同时出现 ≥ 2 次则永不合并；合并结果记入 union-find 别名表（持久化为 `speaker-alias`）。
8. **标签与稳定性**：每个词按覆盖其时间的 embedding（按中心度和质量加权）定说话人，没有时退回窗口；同窗口里另一说话人重叠时显示“A + B”；短于 0.5 s 的片段并入相邻片段；段落超过一半是回声时标记 `echo`。只重标最近 60 s 的段落，更早的只经别名表或停止时的重整改变。
9. **停止时的重整**：对本次会话存下的 embedding（float16）做 AHC 平均连接（Lance–Williams）。先按连通分量切成 ≤ 30 s 的原子，停止阈值取原子内两两相似度的 p10 − 0.05（限制在 0.5–0.85，样本 < 10 时取 0.6）；cannot-link 为 −∞；用户合并过的强制同簇，用户起过不同名字的不合并；< 2 s 的簇并入邻居；新簇按重叠贪心映射回在线编号，号码不跳。结果作为一组 `turns` 记录追加。

**性能控制**：

- 模型在开始时加载、停止时卸载；分割模型 int8；ONNX Runtime 1 线程（推理串行，同一时刻最多占一个核）；CoreML 可用 `PINE_LIVE_CONTEXT_PROVIDER=coreml` 试用，默认 CPU（见 §11.1）。
- 预算调度（`DiarizationBudget`），逐级降级：1 级 hop 1.5 → 3 s；2 级慢路径间隔 2.5 → 5 s；3 级只走快路径（不再分割）；4 级暂停。触发：近 30 s 推理占单核 > 25% 或积压 > 6 s（每 10 s 升一级）；发热 serious → 至少 2 级，critical → 4 级；低电量模式 → 至少 2 级。恢复有迟滞：占用 < 12% 后每 30 s 降一级。等级变化以 `speakers-state` 报给 main，卡片显示一行提示。
- 内存有界：音频环形缓冲 ≤ 10 s/来源；main 的储备池 ≤ 20/说话人；embedding 以 float16 存于 sidecar（每个 ≈ 0.4 KB），3 小时约 7000 个、≈ 3 MB。

**与原方案的偏差**（及原因）：

- 快路径比较的是 helper 里本来源“当前声音”的运行向量，而不是说话人模型：模型在 main，往返一次会让快路径失去意义；最终归属仍由 main 判定，快路径只决定“要不要分割”。
- 重叠触发：没有分割就没有重叠检测器，所以重叠只能在慢窗里发现；快路径的停顿/响度/起音检测承担了“可能换人”的触发。
- 门控用 helper 自己的能量 VAD，而不是转写器的 VAD：SpeechTranscriber 不暴露逐帧语音概率。
- 声纹模型没有 int8 版本：sherpa-onnx 只提供 CAM++ 的 fp32 导出；分割模型用 int8。
- 回声检测粒度是一个 hop（1.5–3 s），不是逐帧。
- 持久化分成两个文件：轻量的 `turns`/`speaker-alias` 在转写文件里，窗口与 embedding 在 sidecar 里（见 §4），转写文件不因此变大。
- 停止时的重整不是单条“relabel”记录，而是对改动的段落逐条追加 `turns`（sidecar 里另记一条 `relabel` 以便回放）。
- “大约 N 人”目前只在 API（`start` 的 `expectedSpeakers`）里，卡片上没有入口。
- 储备池取 20（方案 16–24），快路径块 3 s、hop 1.5 s 与方案一致；τ_hi/τ_lo 取 0.6/0.4，由 §11.1 素材选出。

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
{"v":1,"type":"speaker-merge","from":"system-3","into":"system-2"}     // 用户合并；可跨来源，链式解析，不会成环
{"v":1,"type":"speaker-alias","from":"system-4","into":"system-2"}     // Pine 自己的合并（定期合并），用户合并优先
```

- `turns` 里的单项可带 `provisional: true`（声音还没确认，卡片显示“?”或半透明）和 `overlap`（同时说话的另一位）；`turns` 记录可带 `echo: true`（这段主要是系统音频的回声）。

- 说话人 key 为 `<source>-<n>`：麦克风与系统音频是两个命名空间，只有用户合并时才相连。
- 说话人识别的原始证据另存 sidecar `live-context/<session-id>.speakers.jsonl`，只追加：`capture`（本次采集的时间基准，避免与上次的分析器时间重叠）、helper 原样的 `window`/`embedding`/`echo`/`device`、`segment`（final 段落的 id、相对时间和逐词时间）、停止时的 `relabel`（每个单元的最终归属）。下次开始或读取时按顺序回放即可重建同样的说话人模型，编号跨采集延续。embedding 是由语音算出的 192 维向量（float16），不是音频；sidecar 与转写文件一起随会话删除。
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
- 说话人：开启后每段转写按说话人切成多行，每行前是彩色圆点 + 来源图标 + 名字（默认“说话人 N”）。点名字弹出菜单：重命名（行内输入框，回车保存、Esc 取消）、合并到另一位说话人。还可能变化的标签半透明；还不确定是谁时显示“?”；同时说话显示“说话人 1 + 说话人 2”；麦克风里的系统音频回声在时间后标“· 系统音频的回声”，正文变淡。降级时控件下方一行提示（“已降级”或“已暂停”，会自动恢复）。
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

开启后工作台卡片菜单出现“实时上下文 / Live context”。未开启时卡片不出现在任何菜单里；`PINE_UI.md` 里的说明标注了它只在可用时出现。

## 11. Spike 实测（macOS 27.0.1，Apple Silicon，Xcode SDK 26.2）

- `SpeechTranscriber.isAvailable = true`；支持 45 个 locale，本机已安装 `en-*`、`zh-CN`、`zh-TW`。
- 系统音频（`say` 播放）英文：final 段落在一句话结束后约 **0.7–1.0 s** 到达；volatile 文本约每 1 s 刷新一次，基本跟住语音。
- 中文（`say -v Tingting`）：整句基本准确，数字/百分比规范化良好（“百分之十五”→“15%”）。专有名词有误：“傅里叶变换”→“副理业变换”，中英混说 “pull request”→“plurequest”，“API”“Kevin” 正确。中文 final 往往在停顿处才出，单段可长达 ~10 s。
- 暂停/继续：`finalize(through: nil)` 后分析器对后续音频只输出 “.....”；`finalize(through: <最后一帧>)` 则永不返回。因此暂停时不 finalize，未定稿的 volatile 文本保留到继续或停止。
- 麦克风：未在本机实测（需要用户点击 TCC 弹窗，见交接说明）。

### 11.1 说话人识别实测（同一台 Mac：Apple M5 Pro，macOS 27.0.1）

素材：`say` 生成的多人对话（中文 4 人约 65 s 两组、英文 4 人约 50 s，轮次间隔 0.2–0.8 s，含 0.5–0.8 s 重叠）；sherpa-onnx 自带的真人 4 人中文录音 `0-four-speakers-zh.wav`（56 s，参考为 sherpa-onnx 全量离线聚类、已知 4 人的结果）；单人讲课 468 s；3 人会议；以及外放回声场景（系统音频 4 人通话，麦克风收到 0.3 倍、延迟 150 ms 的回声，另有本地 1 人说话）。helper 用 `--file` 输入，结果由 `SourceDiarizer` 回放打分：DER 按 10 ms 帧（含漏检、虚警、混淆，重叠按人计），“词”是单人说话时段里被标对的词时长占比。

| 素材                            | 词（旧方案）   | DER   | 说话人（真值） | 慢路径占比 |
| ------------------------------- | -------------- | ----- | -------------- | ---------- |
| 真人 4 人中文                   | 99.0%（93.7%） | 20.8% | 4（4）         | 59%        |
| `say` 英文 4 人                 | 96.8%（91.9%） | 10.5% | 4（4）         | 65%        |
| `say` 中文 4 人（两个相似女声） | 74.0%（73.1%） | 28.6% | 3（4）         | 58%        |
| `say` 中文 4 人（同引擎合成声） | 69.9%（52.5%） | 33.3% | 3（4）         | 66%        |
| 单人讲课 468 s                  | 98.9%          | 3.1%  | 1（1）         | 53%        |
| 3 人会议                        | 83.1%          | 23.1% | 3（3）         | 76%        |
| 回声场景·系统音频一侧           | 93.6%          | 10.5% | 4（4）         | 65%        |

- 真人录音的 DER 主要是虚警（17%）：参考只标了离线聚类认定的语音，门控更宽。
- 合成中文压力组的“词”在停止时的重整里从 51.6% 升到 69.9%，其余素材重整前后不变或略好（会议 80.7% → 83.1%）。
- 回声：麦克风里 61% 的通话回声被标为回声，本地 8.6 s 说话没有一处被误标；麦克风一侧仍多出 1 个说话人（未标出的回声）。
- 合成声音彼此远比真人接近，`say` 素材偏悲观；真人录音只有一段，参考也是模型结果。

合成簇测试（`__tests__/liveContextDiarizer.test.ts`，192 维高斯簇，`PINE_DIARIZER_REPORT=1` 打印数字）：讲课不过分、两个相似声音、30 分钟后加入的人、快速一问一答、重叠、笑声/音乐/噪声不成为说话人、远场单麦、暂停/继续保号、换耳机不新增说话人、回放确定性、用户改名与合并、“大约 N 人”上限，全部准确率 1.0。3 小时会话：每步聚类耗时前段 0.09–0.17 ms、后段 0.09–0.14 ms（不随时长增长），7206 个窗口、7303 个 embedding，停止时的重整 1.1–2.1 s。

资源（69 s 中文素材 1× 实时喂入，`/usr/bin/time -l`）：

|                      | 不开说话人           | 开说话人                                         |
| -------------------- | -------------------- | ------------------------------------------------ |
| helper CPU（占单核） | 0.86 s / 71 s ≈ 1.2% | 5.69 s / 73 s ≈ 7.8%（增加约 6.6%）              |
| 其中推理             | —                    | 3.87 s，33 个窗口（14 快 / 19 慢），约 0.12 s/个 |
| 峰值 RSS / footprint | 23 MB / 10 MB        | 229 MB / 201 MB（增加约 206 MB）                 |
| main 聚类            | —                    | 每段素材合计 8–35 ms；重整 1–11 ms               |

峰值 CPU：推理串行、1 线程，任意时刻最多占满一个核（一次约 0.1 s）；预算调度把 30 s 平均限制在 25% 以内。

标签延迟：窗口在其音频结束后约 40 ms（快路径，中位数）/ 15 ms（慢路径）发出；加上等待 hop，快路径的标签在说话后 ≤ 1.5 s，慢路径 ≤ 2.5 s，受限流时偶尔再晚约 2 s。新说话人还要等 ≥ 3 s 语音确认，此前显示“?”。由于转写器本身的段落常在说话后 1–10 s 才出现，用户看到的段落几乎总是已带标签。

CoreML 与降级（同一素材 4× 喂入）：

| 配置                          | 推理   | 窗口 | 峰值 RSS | 词    |
| ----------------------------- | ------ | ---- | -------- | ----- |
| CPU（默认）                   | 2.27 s | 33   | 207 MB   | 74.0% |
| CoreML                        | 1.84 s | 33   | 288 MB   | 74.0% |
| 发热 serious / 低电量（2 级） | 1.32 s | 15   | 208 MB   | 75.5% |
| 发热 critical（4 级，暂停）   | 0      | 0    | 166 MB   | —     |

CoreML 推理快约 19%，但多占约 80 MB、超出 250 MB 预算，所以默认 CPU。2 级降级省下约 42% 推理，这段素材上准确度没有变差。

慢路径占比（53–80%）高于预期：合成素材轮次密、停顿多，讲课的停顿也会触发慢路径。真实会议里同一人连续说话更长，占比应更低；若需要再省电，可放宽快路径的停顿条件。

## 12. 风险与开放问题

- **说话人识别**：相似的声音（同性别、同口音、合成声）仍可能被并成一人（中文相似女声组只分出 3/4）；轮次切换处前后一两个字可能归错；回声检测只覆盖约六成回声，剩余部分会让麦克风一侧多出说话人（需要用户合并）；内存约 +206 MB，接近 250 MB 预算，主要是 ONNX Runtime 与 sherpa-onnx 离线 diarizer 句柄强制多载的一份 CAM++（约 40 MB），直接用 ONNX Runtime 跑分割模型可去掉；3 小时会话停止时的重整在 main 进程同步运行 1–2 s，更长的会话应移到 worker；“大约 N 人”还没有界面入口；麦克风路径、打包后的 Pine.app 和真人多方通话尚未实测。

- **回声/重复**：外放时麦克风会收到系统音频，同一句话可能被两个来源各转写一次。候选：`AVAudioEngine` voice processing（AEC）、耳机提示、或按时间与文本相似度去重。
- **系统录音权限不可查询**：只能用静音推断，误报（确实没在播放）与漏报都可能，需要好的 UI 文案。
- **输出设备切换**：aggregate device 绑定开始时的默认输出设备；中途切到 AirPods 可能断流，v1 需监听 `kAudioHardwarePropertyDefaultOutputDevice` 并重建 tap。
- **多语种混说**：一个 `SpeechTranscriber` 一个 locale；中英混说依赖 `zh-CN` 模型对英文词的处理，效果一般。可考虑 `contextualStrings` 提供术语表。
- **finalize 行为**：见 §11，可能是 macOS 27.0 的问题，后续版本需复测。
- **资源**：两个分析器并行常驻，内存与功耗需在长会议（1–2 h）下测量。
- **长会话注入成本**：追加型通知会让上下文持续增长；需要与会话压缩（compaction）配合，压缩后靠摘要 + 工具回读。
- **隐私**：录音指示必须始终可见；关闭窗口/退出应用必定停止；远程访问（浏览器、手机）不能启动采集（已通过只注册 `ipcMain` 保证）。
- **开放问题**：已停止的转写是否仍自动注入（倾向：注入直到用户“清除”，但只注入未发过的增量）；侧边对话是否允许显式继承；多个窗口同时显示同一会话时的交互。
