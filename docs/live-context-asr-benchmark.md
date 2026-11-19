# Live Context 本地语音识别评测

日期：2026-11-18。机器：MacBook Pro M5 Pro，48 GB，macOS 27.0.1，插电。目的：给 Live Context（见 `docs/live-context.md`）选默认的本地 ASR 引擎，并确定说话人分离和可选引擎的方向。复现用的脚本在 `apps/desktop/native/live-context/bench/`，数据、模型和结果都留在仓库外的临时目录。

## 结论

> **建议**：macOS 26+ 默认引擎**继续用 Apple SpeechTranscriber**；**sherpa-onnx + SenseVoice-Small** 作为第一个可选引擎（“术语 / 中英混说增强”，同时覆盖 macOS 26 以下和以后的 Windows），复用说话人分离分支已经接入的 sherpa-onnx 运行时；说话人分离下一步对比 **FluidAudio Sortformer**。WhisperKit 只适合会后“高精度重转”，不适合实时默认；WebGPU 路线在 macOS 上不划算，只作为 Windows 的储备。

| 候选                                    | 中文准确率                                  | 中英混说 / 术语    | 英文               | 实时延迟                                                            | 资源                                                               | 稳健性                          | 定位               |
| --------------------------------------- | ------------------------------------------- | ------------------ | ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- | ------------------ |
| Apple SpeechTranscriber                 | 最好或并列最好（朗读 5.9%、远场会议 41.9%） | 一般（术语 19.5%） | 中等，远场差       | 首字 ≈0.5–1 s；定稿中位 2–9 s，p90 最长 16 s                        | 最低：≈5 J/音频分钟，进程 ≈30 MB + 系统守护进程 ≈130 MB；无需下载  | 静音/音乐 0 幻觉                | **默认**           |
| sherpa-onnx SenseVoice int8（CPU）      | 接近 Apple，远场会议差 10 点                | 好（术语 10.5%）   | 中等，远场很差     | 本身无流式；配流式 Paraformer 后首字 0.3–0.9 s，定稿取决于 VAD 段长 | ≈10 J/音频分钟；模型 230 MB（下载 163 MB）；加 Paraformer 再 +1 GB | 0 幻觉                          | **第一个可选引擎** |
| FluidAudio SenseVoice（CoreML）         | 同模型，近讲会议最好 26.2%                  | 好（11%）          | 同上               | 同上                                                                | CoreML 跑在 GPU/CPU 不在 ANE；RSS ≈2 GB；首次准备 7–9 s            | 有空输出 bug，需要重试          | 不推荐（暂）       |
| FluidAudio Nemotron 流式                | 朗读 13.6%，会议与 Apple 接近               | 差（丢英文）       | 中等               | 首字/末字 1–2 s，无端点、需自己切句                                 | ≈12 J/音频分钟，RSS ≈120 MB；模型 641 MB；首次 33 s                | 0 幻觉                          | 观察               |
| WhisperKit large-v3-turbo（ANE）        | 中等（朗读 11.1%）                          | 最好（5.5%）       | 最好（远场 43.4%） | 流式跟不上（会议确认滞后 ≈59 s）                                    | ≈24 J/音频分钟，ANE；模型 624 MB；首次加载 116 s                   | 静音/音乐有幻觉（“感谢观看”等） | 会后重转           |
| WebGPU Whisper turbo（transformers.js） | 朗读 7.1%，远场会议 61.4%                   | 好（8%）           | 中等               | 未测流式；冷启动 ≈4 s                                               | ≈161 J/音频分钟（GPU）；进程树 RSS 最高 ≈7.9 GB；模型 1.6 GB       | 0 幻觉（本次），small 有复读    | Windows 储备       |

数字是本机、本批片段上的结果，样本量小（每类 1–2 段、3–5 分钟），差几个点不显著。

## 方法

### 被测引擎与版本

| 名称（表中）                                                      | 内容                                                                                                                                                                                                                                                                                                                           | 版本 / 来源                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `apple`                                                           | 现有 helper 的 `SourcePipeline`（SpeechAnalyzer + SpeechTranscriber），改成读文件；`--realtime` 时按 1× 速度每 100 ms 喂一块                                                                                                                                                                                                   | macOS 27.0.1 系统资源                                                                           |
| `sherpa-sv-cpu` / `sherpa-sv-coreml`                              | sherpa-onnx：silero VAD → SenseVoice-Small int8，2 线程；CoreML 版用 ORT CoreML EP                                                                                                                                                                                                                                             | sherpa-onnx 2.0.1（Python 包），模型 `sense-voice-zh-en-ja-ko-yue-int8-2024-07-17`              |
| `sherpa-sv-partials`                                              | 同上，外加流式 Paraformer（中英双语 int8）出实时 partial，VAD 段结束后 SenseVoice 定稿                                                                                                                                                                                                                                         | `streaming-paraformer-bilingual-zh-en`                                                          |
| `fluid-sv-fp16` / `fluid-sv-int8` / `fluid-paraformer`            | FluidAudio 的 CoreML SenseVoice / Paraformer，输入与 sherpa 相同的 VAD 段                                                                                                                                                                                                                                                      | FluidAudio 0.18.3                                                                               |
| `fluid-nemotron`                                                  | FluidAudio 流式 Nemotron 多语言（2240 ms 块）                                                                                                                                                                                                                                                                                  | 同上                                                                                            |
| `fluid-parakeet-v3`                                               | FluidAudio Parakeet TDT v3（仅英文片段）                                                                                                                                                                                                                                                                                       | 同上                                                                                            |
| `wk-turbo` / `wk-small`                                           | WhisperKit CLI，`openai_whisper-large-v3-v20240930_turbo_632MB` / `openai_whisper-small_216MB`，指定语言                                                                                                                                                                                                                       | WhisperKit 1.1.1                                                                                |
| `webgpu-whisper-turbo` / `-small` / `webgpu-moonshine` / `wasm-*` | transformers.js 在 Electron 隐藏渲染窗口里（ORT Web WebGPU EP；`wasm` 为 CPU），encoder fp16 + decoder q4，输入同样的 VAD 段                                                                                                                                                                                                   | `@huggingface/transformers` 4.3.2（自带 onnxruntime-web 1.31 dev），Electron 44.9.1（仓库自带） |
| 说话人分离                                                        | `sherpa-online`（pyannote seg 3.0 + CAM++ 在线质心聚类）、`sherpa-offline`（sherpa 自带离线聚类）、`fluid-streaming` / `fluid-offline`（FluidAudio pyannote + VBx）、`fluid-sortformer`（NVIDIA Sortformer，≤4 人）、`wk-speakerkit`（Argmax SpeakerKit）、`webgpu-diar`（transformers.js pyannote seg + WeSpeaker，在线质心） | 同上；`@0.7` 等后缀为聚类阈值                                                                   |

whisper.cpp 没有测：它和 WhisperKit 是同一组权重，在 Apple Silicon 上 WhisperKit 走 ANE 更省电，且两者幻觉问题相同。

### 测试音频

全部 16 kHz 单声道，放在临时目录，不进仓库。参考文本与说话人标注来自数据集原始标注；跨越截取窗口边界的句子整句静音并从参考中删除，避免边界误差。

| 片段              | 时长  | 来源                                                                                         | 代理场景                   | 许可         |
| ----------------- | ----- | -------------------------------------------------------------------------------------------- | -------------------------- | ------------ |
| `zh_read`         | 184 s | FLEURS cmn_hans_cn test，18 句朗读拼接                                                       | 中文讲课（干净、书面语）   | CC BY 4.0    |
| `zh_noisy`        | 184 s | `zh_read` + 约 8 路中文 babble + 粉红噪声，SNR 10 dB                                         | 嘈杂教室                   | 同上（合成） |
| `zh_meeting`      | 300 s | AliMeeting Eval `R8001_M8004`，8 麦阵列第 0 路（远场），4 人                                 | 会议室里用电脑麦克风录现场 | CC BY-SA 4.0 |
| `zh_meeting_near` | 300 s | 同一会议同一窗口，4 人头戴麦相加                                                             | 线上会议经系统音频（近讲） | CC BY-SA 4.0 |
| `cs_conv`         | 239 s | ASCEND test session 1，两人中英夹杂对话按原时间轴混合                                        | 中英混说口语               | CC BY-SA 4.0 |
| `cs_tech`         | 63 s  | `say -v Tingting` / `Samantha` 合成 9 句，含 傅里叶变换、pull request、Kubernetes、Docker 等 | 技术课程术语               | 自制         |
| `en_meeting`      | 300 s | AMI ES2004a 300–600 s，Mix-Headset，4 人                                                     | 英文线上会议               | CC BY 4.0    |
| `en_meeting_far`  | 300 s | 同一窗口，Array1-01 远场单麦                                                                 | 英文会议室远场             | CC BY 4.0    |
| `diar_synth`      | 35 s  | `say` 4 个中文声音（Eddy/Reed 两个相近男声），含 0.4–0.8 s 重叠和插话“嗯/对”                 | 分离压力测试               | 自制         |
| `silence`         | 60 s  | −60 dBFS 白噪声                                                                              | 静音幻觉                   | 自制         |
| `music`           | 60 s  | 合成和弦 + 低音 + 噪声打击                                                                   | 音乐幻觉                   | 自制         |

数据许可都允许本地评测；CC BY-SA 数据只在本机使用、不再分发。用户自己的真实录音没有用，是下一步（见“后续”）。

### 指标口径

- **准确率**：每个汉字一个 token、每个拉丁词一个 token（中文片段即 CER，混说为混合错误率 MER，英文为 WER）。两边同样规整：繁转简（OpenCC t2s）、小写、去标点、数字读法统一（`2点`→二点、`15%`→百分之十五；英文 num2words）、“两”→“二”、去语气词（嗯/呃/额/唔、um/uh/hmm/mm）。超过 100% 表示插入（复读）很多。
- **RTF**：处理时间 / 音频时长（快进模式，不含进程启动与模型加载）。
- **延迟**（实时模式，1× 速度、每 100 ms 一块，与 helper 采集一致）：首字 = 一段话开头（之前 ≥1 s 无人说话）到第一条文本事件；定稿 = 一句话结束到覆盖它的 final 段发出；末字 = 一句话结束到之后第一条文本事件（volatile 也算）。
- **CPU**：被测进程树 CPU 时间 / 墙钟时间（100% = 一个核），另列系统守护进程（Apple 的转写跑在 `localspeechrecognition` 里）的 CPU 增量。
- **RSS**：进程树峰值（各进程相加）。Electron 的数字包含 GPU 进程，统一内存会被重复计入，是上界。ANE 上的模型内存不一定计入 RSS。
- **能耗**：自写 IOReport 读取器（`bench/energy/iorep.c`，读 “Energy Model” 组，不需要 sudo、不改设置），分 CPU / GPU / ANE / DRAM，减去运行前 4 s 空闲基线。这是系统级计数器，后台应用（评测期间开着 ClickUp、Pine 开发版等）会带来噪声，小数值和负数都应视为 0。`powermetrics` 需要 sudo，未用。
- **说话人分离**：pyannote.metrics DER（collar 0.25 s，含重叠），以及说话人数误差（表中“识别人数/真实人数”）。

## 结果

### 准确率（%，越低越好；silence / music 列为幻觉出的 token 数）

| engine               | zh_read | zh_noisy | zh_meeting | zh_meeting_near | cs_conv | cs_tech | en_meeting | en_meeting_far | silence | music |
| -------------------- | ------- | -------- | ---------- | --------------- | ------- | ------- | ---------- | -------------- | ------- | ----- |
| apple                | 5.86    | 56.24    | 41.93      | 30.74           | 39.45   | 19.5    | 26.33      | 51.75          | 0       | 0     |
| fluid-nemotron       | 13.56   | 59.78    | 48.98      | 30.52           | 46.1    | 27.0    | 29.83      | 57.99          | 0       | 0     |
| fluid-paraformer     | 260.4   | 100.0    | 120.88     | 95.37           | 260.89  | 444.0   | —          | —              | 0       | 0     |
| fluid-parakeet-v3    | —       | —        | —          | —               | —       | —       | 23.59      | 38.96          | 0       | 0     |
| fluid-sv-fp16        | 14.64   | 55.01    | 51.4       | 26.17           | 37.39   | 11.0    | 32.72      | 71.84          | 0       | 0     |
| fluid-sv-int8        | 12.17   | 54.7     | 51.4       | 26.23           | 37.5    | 11.0    | 32.12      | 71.54          | 0       | 0     |
| sherpa-sv-coreml     | —       | —        | 51.68      | —               | —       | 10.5    | —          | —              | —       | —     |
| sherpa-sv-cpu        | 7.24    | 57.47    | 51.57      | 32.34           | 38.65   | 10.5    | 32.88      | 72.91          | 0       | 0     |
| wasm-moonshine       | —       | —        | —          | —               | —       | —       | 40.79      | —              | —       | —     |
| wasm-whisper-small   | —       | —        | —          | —               | —       | 233.5   | —          | —              | —       | —     |
| webgpu-moonshine     | —       | —        | —          | —               | —       | —       | 137.9      | 116.74         | 0       | 0     |
| webgpu-whisper-small | 12.33   | 77.97    | 68.21      | 35.92           | 46.79   | 233.5   | 32.72      | 71.23          | 0       | 0     |
| webgpu-whisper-turbo | 7.09    | 59.78    | 61.38      | 31.63           | 44.72   | 8.0     | 29.07      | 60.27          | 0       | 0     |
| wk-small             | 25.12   | 75.19    | 54.71      | 38.07           | 41.74   | 24.0    | 36.68      | 65.75          | 12      | 7     |
| wk-turbo             | 11.09   | 55.16    | 47.05      | 34.05           | 43.69   | 5.5     | 25.27      | 43.38          | 12      | 40    |

要点：

- **中文朗读和远场会议 Apple 最好**（5.9% / 41.9%）；近讲会议 SenseVoice（FluidAudio CoreML 26.2%、sherpa 32.3%）和 Apple（30.7%）、Nemotron（30.5%）接近。
- **术语和中英混说 Whisper turbo 最好**（WhisperKit 5.5%，WebGPU 8.0%），SenseVoice 10.5–11% 次之，Apple 19.5%（英文术语常被写成音近汉字）。口语混说 `cs_conv` 各家都在 37–47%，差别不大。
- **英文**：WhisperKit turbo 最好，远场 Parakeet v3（39.0%）更好；SenseVoice 远场英文很差（72%）。
- **幻觉**：只有 WhisperKit 在静音/音乐上编文本（turbo 音乐段 40 个 token，如“请不吝点赞 订阅 转发 打赏支持明镜与点点栏目”，静音段“感谢观看”）。WebGPU 版因为只送 VAD 段，静音/音乐段没有输入；但 small 在 `cs_tech` 的一段上无限复读（233%）。
- **同一个 SenseVoice 模型，三种运行时**：sherpa CPU 与 CoreML EP 结果相同；FluidAudio CoreML 版在近讲会议更好、朗读更差，差异来自权重转换和长段切分。
- **FluidAudio Paraformer 输出乱码**（错误率 >100%，它自己的 CLI 也一样），是上游问题，不计入比较。
- `webgpu-moonshine` 在 WebGPU 上只输出重复词（“guide guide …”），同一模型改用 WASM（CPU）则正常（英文会议 40.8%），说明是 ORT Web 的 WebGPU 内核在这个模型上的数值问题。

### 性能（快进模式，全部语音片段汇总）

| engine               | RTF median | CPU % (tree, while running) | daemon CPU s / audio min | tree CPU s / audio min | peak RSS MB | J / audio min | CPU J  | GPU J | ANE J | warm load s |
| -------------------- | ---------- | --------------------------- | ------------------------ | ---------------------- | ----------- | ------------- | ------ | ----- | ----- | ----------- |
| apple                | 0.012      | 20                          | 0.8                      | 0.1                    | 34          | 5.4           | 4.5    | -0.0  | 0.5   | 0.1         |
| fluid-nemotron       | 0.015      | 32                          | 0.0                      | 1.1                    | 660         | 12.0          | 9.9    | -0.0  | 0.6   | 0.2         |
| fluid-paraformer     | 0.024      | 95                          | 0.0                      | 2.3                    | 1402        | 18.0          | 17.4   | -0.0  | 0.0   | 4.9         |
| fluid-parakeet-v3    | 0.063      | 31                          | 0.0                      | 1.2                    | 538         | 15.9          | 13.0   | -0.1  | 2.2   | —           |
| fluid-sv-fp16        | 0.030      | 98                          | 0.0                      | 3.8                    | 2092        | 29.8          | 28.7   | 0.0   | 0.0   | 7.3         |
| fluid-sv-int8        | 0.031      | 97                          | 0.0                      | 4.4                    | 2250        | 49.8          | 47.7   | 0.0   | 0.0   | 9.5         |
| sherpa-sv-coreml     | 0.017      | 136                         | 0.0                      | 2.5                    | 906         | 15.5          | 15.5   | -0.0  | 0.0   | 1.9         |
| sherpa-sv-cpu        | 0.015      | 160                         | 0.0                      | 1.7                    | 1023        | 10.3          | 10.1   | -0.0  | 0.0   | 0.4         |
| wasm-moonshine       | 0.090      | 111                         | 0.0                      | 6.4                    | 1828        | 52.3          | 50.2   | -1.4  | 0.0   | 0.9         |
| wasm-whisper-small   | 2.236      | 102                         | 0.0                      | 178.5                  | 4137        | 1524.9        | 1471.4 | 9.8   | -0.8  | 41.7        |
| webgpu-moonshine     | 0.024      | 262                         | 0.0                      | 4.7                    | 2581        | 38.3          | 29.7   | 7.1   | 0.0   | 1.2         |
| webgpu-whisper-small | 0.054      | 157                         | 0.0                      | 6.8                    | 3570        | 90.9          | 40.3   | 43.5  | 0.0   | 4.6         |
| webgpu-whisper-turbo | 0.081      | 71                          | 0.0                      | 3.8                    | 7926        | 160.7         | 25.6   | 124.8 | 0.0   | 2.4         |
| wk-small             | 0.052      | 36                          | 0.0                      | 1.1                    | 295         | 21.7          | 5.5    | 0.0   | 13.6  | 0.5         |
| wk-turbo             | 0.044      | 33                          | 0.0                      | 1.0                    | 345         | 24.2          | 5.7    | 0.0   | 15.8  | 1.1         |

列：RTF 中位数；运行时进程树 CPU %；守护进程 CPU 秒 / 音频分钟；进程树 CPU 秒 / 音频分钟；进程树峰值 RSS；每音频分钟能耗（J，总计与 CPU / GPU / ANE 分项，减空闲基线）；热加载时间。

- Apple 的计算在系统守护进程 `localspeechrecognition` 里，本进程只有 ≈30 MB；守护进程常驻 ≈130 MB（不随会话增加）。能耗最低。
- SenseVoice 的 RSS（≈0.8–1 GB）是 Python + NumPy + ORT 的开销；说话人分离分支在原生 helper 里实测 sherpa（pyannote + CAM++）只多 ≈206 MB，SenseVoice 原生加载估计 ≈300–400 MB（未实测）。
- sherpa **CoreML EP 没有收益**：SenseVoice int8 共 5924 个节点只有 827 个分到 CoreML、切成 352 段（`Gather`/`Reshape`/`DynamicQuantizeLinear` 不支持），每次建会话多 ≈50 s 编译（之后有缓存，表中 warm load 1.9 s），能耗反而更高。其他模型：silero VAD 65/69 节点（3 段）、pyannote seg 26/50（5 段）、CAM++ 406/1785（54 段）、流式 Paraformer encoder 2728/3333（251 段）。说话人分离分支测得 CoreML 快 19% 但 +80 MB，默认仍用 CPU 合理。
- FluidAudio SenseVoice 的 CoreML 模型实际跑在 CPU（ANE 能耗 ≈0），RSS ≈2 GB，比 sherpa CPU 还慢、还耗电。
- WhisperKit 真正用到 ANE（ANE 能耗占大头），CPU 很低，但 RTF 0.04–0.05 是 Apple 的 4 倍，能耗也是 4–5 倍。
- WebGPU 跑在 GPU 上：turbo 每音频分钟 ≈125 J GPU 能耗，是 WhisperKit ANE 的 ≈8 倍、Apple 的 ≈30 倍。

### 冷启动

| 引擎                        | 首次（含模型编译）                                   | 之后                             |
| --------------------------- | ---------------------------------------------------- | -------------------------------- |
| Apple                       | 系统资源已装好时 ≈0.1 s                              | ≈0.1 s                           |
| sherpa SenseVoice CPU       | ≈0.7 s                                               | ≈0.4 s                           |
| sherpa SenseVoice CoreML EP | ≈50 s（CoreML 编译）                                 | ≈1.9 s                           |
| FluidAudio SenseVoice       | ≈7–9 s                                               | ≈7–9 s（每次都要准备）           |
| FluidAudio Nemotron         | 32.7 s（含下载）                                     | 预热 ≈9 s，加载 0.2 s            |
| WhisperKit turbo            | **115.6 s**（encoder ANE 编译 109.8 s）              | ≈1.1–1.4 s                       |
| WhisperKit small            | 15.4 s                                               | ≈0.5 s                           |
| WebGPU Whisper turbo        | 3.8 s（独立空 profile；加载 2.5 s + 首次推理 1.3 s） | 2.5 s                            |
| WebGPU Whisper small        | 4.9 s                                                | 4.9 s（首次推理 3.6 s 每次都有） |
| WASM Whisper small          | 41.7 s（首次推理 40.4 s）                            | —                                |

“首次”指模型编译缓存为空；模型文件都已在本地磁盘缓存里，下载时间不计。

### 实时（1× 喂入）

| engine             | clip            | first         | final           | tail          | CPU % avg (incl. daemon) | CPU % peak (tree) | RSS MB | W above idle | ER %  |
| ------------------ | --------------- | ------------- | --------------- | ------------- | ------------------------ | ----------------- | ------ | ------------ | ----- |
| apple              | cs_tech         | 1038 / 1038   | 6229 / 14308    | 448 / 773     | 1                        | 4                 | 22     | 3.29         | 19.5  |
| apple              | en_meeting      | 702 / 1796    | 1744 / 4530     | 545 / 2683    | 0                        | 2                 | 20     | 0.32         | 26.33 |
| apple              | zh_meeting_near | 507 / 872     | 9245 / 16076    | 462 / 856     | 4                        | 4                 | 24     | 0.00         | 30.74 |
| fluid-nemotron     | cs_tech         | 2243 / 2243   | 29580 / 48648   | 1018 / 2046   | 11                       | 29                | 118    | 0.92         | 27.0  |
| fluid-nemotron     | en_meeting      | 1834 / 3000   | 150823 / 245107 | 1332 / 3432   | 2                        | 21                | 117    | 0.02         | 29.83 |
| fluid-nemotron     | zh_meeting_near | 1208 / 2056   | 110190 / 245110 | 1326 / 2024   | 3                        | 22                | 126    | 0.62         | 30.52 |
| sherpa-sv-cpu      | cs_tech         | 6431 / 6431   | 711 / 850       | 711 / 850     | 11                       | 144               | 820    | 0.06         | 10.5  |
| sherpa-sv-cpu      | en_meeting      | 4419 / 11602  | 2648 / 10562    | 1935 / 10040  | 4                        | 129               | 847    | 0.03         | 32.88 |
| sherpa-sv-cpu      | zh_meeting_near | 16721 / 45382 | 16126 / 45042   | 15748 / 45042 | 6                        | 200               | 1301   | 1.44         | 32.34 |
| sherpa-sv-partials | cs_tech         | 943 / 943     | 622 / 663       | 129 / 597     | 16                       | 99                | 1218   | 2.72         | 10.5  |
| sherpa-sv-partials | en_meeting      | 554 / 2259    | 2643 / 10552    | 484 / 1816    | 11                       | 98                | 1378   | 0.97         | 32.88 |
| sherpa-sv-partials | zh_meeting_near | 302 / 574     | 16111 / 44797   | 364 / 581     | 16                       | 200               | 1874   | 1.14         | 32.34 |

- **Apple**：首字中位 0.5–1 s，末字（volatile 跟上）≈0.5 s，体感流畅；但**定稿慢**，中文近讲会议中位 9.2 s、p90 16 s，因为它要等长句结束才给 final。CPU 几乎为 0（计在守护进程里，平均 ≤4%）。
- **sherpa SenseVoice（无 partial）**：只在 VAD 段结束时出字，会议里段很长（最长 20 s），首字中位 16.7 s，不能单独作为实时引擎。
- **sherpa SenseVoice + 流式 Paraformer partial**：首字 0.3–0.9 s、末字 0.1–0.5 s，和 Apple 同级；定稿仍取决于 VAD 段长（会议 p90 45 s），需要把 VAD 的最长段降到 ≈8–10 s 再测。代价：CPU 平均 11–16%（Python），Paraformer 模型 1 GB。
- **WhisperKit 流式（`--stream-simulated`，1 s 步长、两次一致才确认）**：`cs_tech` 上 turbo 确认滞后中位 1.7 s，正常；但在 5 分钟近讲会议上 turbo 处理了 782 s（滞后中位 59 s、单步最长 69 s），small 在 `cs_tech` 上单步最长 198 s、会议片段 31 分钟未完成被中止。重新解码不断增长的窗口在长会话里跟不上。
- **FluidAudio Nemotron 流式**：首字中位 1.2–2.2 s、末字 1.0–1.3 s（每 2.24 s 一块，延迟下限就在这里），CPU 平均 ≤11%、RSS ≈120 MB。它没有端点检测，整段只在结尾定稿，所以“定稿”列（110–150 s）没有意义；接入时要自己按 VAD 切句。中英混说时会丢掉英文（`cs_tech` 27%）。

### 说话人分离：DER %（识别人数 / 真实人数）

| engine             | diar_synth  | zh_meeting   | zh_meeting_near | cs_conv      | en_meeting   | en_meeting_far | mean DER | RTF (process) |
| ------------------ | ----------- | ------------ | --------------- | ------------ | ------------ | -------------- | -------- | ------------- |
| fluid-offline      | 30.48 (2/4) | 21.98 (4/4)  | 26.46 (4/4)     | 47.42 (4/2)  | 44.16 (3/4)  | 63.57 (2/4)    | 39.0     | 0.005         |
| fluid-sortformer   | 24.51 (4/4) | 18.91 (4/4)  | 15.57 (4/4)     | 31.34 (4/2)  | 42.36 (4/4)  | 59.02 (4/4)    | 32.0     | 0.066         |
| fluid-streaming    | 38.51 (2/4) | 42.06 (5/4)  | 56.65 (3/4)     | 46.01 (4/2)  | 44.43 (6/4)  | 56.03 (5/4)    | 47.3     | 0.009         |
| sherpa-offline     | 20.03 (3/4) | 50.6 (34/4)  | 36.62 (18/4)    | 75.95 (27/2) | 60.23 (26/4) | 76.74 (38/4)   | 53.4     | 0.055         |
| sherpa-offline@0.7 | 31.61 (2/4) | 33.42 (19/4) | 21.12 (8/4)     | 66.43 (13/2) | 41.82 (14/4) | 66.72 (24/4)   | 43.5     | 0.064         |
| sherpa-offline@0.9 | 31.61 (2/4) | 38.57 (13/4) | 19.71 (6/4)     | 47.35 (5/2)  | 37.96 (8/4)  | 52.94 (13/4)   | 38.0     | 0.058         |
| sherpa-offline@1.1 | 65.4 (1/4)  | 32.13 (5/4)  | 49.37 (2/4)     | 35.62 (3/2)  | 40.13 (3/4)  | 50.38 (3/4)    | 45.5     | 0.059         |
| sherpa-online      | 67.43 (1/4) | 61.15 (5/4)  | 64.21 (2/4)     | 52.66 (4/2)  | 51.12 (10/4) | 66.56 (15/4)   | 60.5     | 0.021         |
| sherpa-online@0.6  | 67.43 (1/4) | 61.95 (7/4)  | 55.29 (3/4)     | 46.46 (8/2)  | 51.42 (11/4) | 70.81 (20/4)   | 58.9     | 0.022         |
| sherpa-online@0.7  | 62.44 (2/4) | 63.42 (11/4) | 55.29 (3/4)     | 53.33 (15/2) | 60.68 (23/4) | 75.59 (23/4)   | 61.8     | 0.023         |
| webgpu-diar        | 29.31 (5/4) | 35.72 (37/4) | 47.52 (19/4)    | 62.67 (27/2) | 45.68 (20/4) | 64.52 (31/4)   | 47.6     | 0.021         |
| wk-speakerkit      | 56.72 (4/4) | 25.28 (5/4)  | 20.69 (4/4)     | 48.7 (5/2)   | 32.9 (4/4)   | 53.18 (5/4)    | 39.6     | 0.004         |

- **FluidAudio Sortformer 最好**（平均 32.0%，中文会议 15.6–18.9%，人数全对），但模型上限 4 人，在 2 人的 `cs_conv` 上报了 4 人；它的 CPU 开销不小（RTF 0.066，每 5 分钟音频 ≈250 J，CPU 计算）。
- **WhisperKit SpeakerKit**（39.6%）和 **FluidAudio 离线 VBx**（39.0%）次之，都很快（RTF ≤0.005）。
- sherpa 的离线聚类在默认阈值下严重过分（18–38 人）；阈值 0.9 时平均 38.0%，但这个阈值是在测试集上挑的，偏乐观。这里的 `sherpa-online` 是评测脚本里的简单质心聚类，**不是**说话人分离分支实际实现的“约束在线聚类 + 停止时重整”（那边在自己的片段上测得会议 DER 20.8–23.1%）；应在本批片段上重测那条实现，再和 Sortformer 比较。
- `webgpu-diar`（同样简单的在线聚类）过分严重，说明 WeSpeaker 的阈值需要单独调，不代表运行时本身的上限。

## WebGPU（transformers.js）路线

- **只能在渲染进程跑**：同一个 Electron 44.9.1 里，`utilityProcess` 的 `navigator.gpu` 是 `undefined`（实测）；隐藏 `BrowserWindow`（`show: false`、`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`backgroundThrottling: false`）里可用，适配器 Apple `metal-3`，支持 `shader-f16`。隐藏窗口必须关 `backgroundThrottling`。
- **耗电和内存**：同一个 Whisper turbo，WebGPU 每音频分钟 ≈161 J（GPU 125 J），WhisperKit 在 ANE 上 ≈24 J；渲染 + GPU 进程树 RSS 峰值 ≈7.9 GB（统一内存重复计入，是上界，但 1.27 GB 的 fp16 encoder 至少要在 CPU 和 GPU 两侧各有一份）。电池供电时这条路明显不划算。
- **中文准确率**：Whisper turbo 朗读 7.1%、术语 8.0%，好于 WhisperKit 同模型（权重相同，差别来自 q4 decoder 与解码参数）；远场会议 61.4% 明显差。small 比 turbo 差很多，还会复读。transformers.js **没有 SenseVoice**（没有对应模型类，onnx-community 也没有导出），所以中文最强的小模型用不上。sherpa-onnx 的 WASM 版是纯 CPU，不会比原生 sherpa 快，未测。
- **冷启动**：在独立的空 profile 里，turbo 首次 3.8 s（加载 2.5 s + 首次推理编译 1.3 s），第二次 2.5 s；small 两次都是 4.9 s（首次推理 3.6 s 每次都要，Dawn 管线缓存帮助不大）。和 WhisperKit 首次 ANE 编译 116 s 相比，WebGPU 冷启动快得多。
- **WebGPU 不可用时**：transformers.js 不会自动回退，要捕获错误后改用 `device: "wasm"`（CPU）。实测 WASM 版 Whisper small（encoder fp16）RTF 2.2（比实时慢一倍多）、首次推理 40 s，同样复读；Moonshine base 在 WASM 上 RTF 0.09、英文会议 40.8%，正常可用。
- **系统音频**：Electron 44 的类型定义写明 `setDisplayMediaRequestHandler` 的 `audio: 'loopback'` “currently only supported on Windows”；Chromium 有 `MacCatapLoopbackAudioForScreenShare` 开关但 Electron 不承诺，且 `getDisplayMedia` 仍要视频源（需要“屏幕录制”权限）。macOS 上系统音频仍应由 Swift helper 的 Core Audio tap 采集，PCM 经 main 转发给渲染器。为避免在本机弹权限框，没有实际调用 loopback。
- **安全与集成**：推理放渲染器不违反“渲染进程不直接访问 Node/文件系统”——harness 只用一个只读自定义协议（`pinebench://`，只服务指定目录），没有 preload、没有 Node。但它要一个单独的隐藏窗口长时间占满 GPU，崩溃时由 main 重建。CSP：`transformers.web.js` 用裸模块名导入 `onnxruntime-web/webgpu`，需要 import map（内联要写 hash）或打包；WASM 需要 `'wasm-unsafe-eval'`，ORT 用 `blob:` worker。模型应由 main 下载（钉 URL + SHA-256）到 `<userData>/models/`，再经自定义协议只读提供，`env.allowRemoteModels = false`、`env.useBrowserCache = false`，CSP 的 `connect-src` 只放自有协议。
- **对 Windows 的价值**：Windows 没有 SpeechTranscriber 和 ANE，WebGPU（D3D12）是少数能跨厂商用 GPU 的路线，加上 loopback 在 Windows 上 Electron 原生支持，这条路在 Windows 上有意义。但 sherpa-onnx 原生 CPU（Windows 也有预编译库）对中文更好、更省，应作为 Windows 的首选，WebGPU Whisper 作为英文 / 术语增强的备选。

## 集成成本与许可

| 方案                            | 接入方式                                                                                            | 架构 / 系统                                           | 代码许可            | 模型许可                                                                                                                                            | 与 AGPL 分发                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Apple SpeechTranscriber（现状） | 系统框架，已集成                                                                                    | arm64 + x86_64，macOS 26+                             | 系统                | 系统资源，按需由系统下载                                                                                                                            | 无问题                                             |
| sherpa-onnx + SenseVoice        | C API（dlopen `libsherpa-onnx-c-api` + `libonnxruntime`），说话人分离分支已经这样接入               | universal 动态库（arm64 ≈33 MB）；ORT CPU，任意 macOS | Apache-2.0；ORT MIT | SenseVoiceSmall：FunASR Model License 1.1（允许使用/修改/分发，需署名；含“不得诋毁”条款且可单方修订，不是 OSI 许可）；Paraformer 同；silero VAD MIT | 代码兼容；权重按需下载、不随包分发，需在关于页署名 |
| FluidAudio                      | SwiftPM（Swift 6，macOS 14+），依赖预编译 Rust xcframework（NemoTextProcessing，含 arm64 + x86_64） | CoreML；x86_64 能编译但没有 ANE                       | Apache-2.0          | SenseVoice/Paraformer CoreML 沿用 FunASR 许可；Nemotron：OpenMDW-1.1；Sortformer、Parakeet：CC BY 4.0；pyannote 管线：CC BY 4.0（限定范围）         | 代码兼容；CC BY 需署名                             |
| WhisperKit + SpeakerKit         | SwiftPM（`argmax-oss-swift`，macOS 13+）                                                            | CoreML；ANE 仅 Apple Silicon                          | MIT                 | Whisper 权重 MIT；SpeakerKit 模型 CC BY 4.0                                                                                                         | 兼容                                               |
| transformers.js（WebGPU）       | npm（`@huggingface/transformers`，自带 onnxruntime-web）                                            | 跨平台，需要 WebGPU；否则 WASM                        | Apache-2.0；ORT MIT | Whisper MIT；Moonshine MIT；pyannote seg MIT；WeSpeaker CC BY 4.0                                                                                   | 兼容                                               |

所有 Swift 方案都要随 helper 一起签名公证；sherpa 的动态库需要 `codesign --options runtime` 并放进 helper 旁边（说话人分离分支已处理）。

### 在 1.5 GB 预算内的组合

预算按整条 Live Context 管线（两路音源的 ASR + VAD + 说话人分离）额外 RSS ≈1.5 GB、16 GB Apple Silicon 计算，内存只作为成本列出，不作为淘汰条件。

| 组合                                | 估计额外内存                                      | 按需下载        |
| ----------------------------------- | ------------------------------------------------- | --------------- |
| Apple ×2 路 + sherpa 分离（现分支） | 守护进程 ≈130 MB（共享）+ 分离 ≈206 MB            | 分离模型 ≈35 MB |
| sherpa SenseVoice ×2 路 + 分离      | 共享一个 ORT 运行时，估计 ≈0.6–0.8 GB（原生未测） | 163 MB          |
| 上面再加流式 Paraformer partial     | 再 +≈1 GB（Python 实测 1.2–1.9 GB 进程总量）      | +1.0 GB         |
| WhisperKit turbo 会后重转           | ≈350 MB（另有 ANE 常驻）                          | 624 MB          |
| FluidAudio Sortformer 分离          | ≈320 MB                                           | 235 MB          |

## 建议

1. **默认引擎：Apple SpeechTranscriber，不换。** 中文朗读和远场会议最准，能耗和内存最低，零下载、零幻觉，首字延迟最低，已经集成。主要短板是定稿慢和英文术语写成音近汉字。
2. **第一个可选引擎：sherpa-onnx + SenseVoice-Small int8（CPU）。** 中英术语错误率约为 Apple 的一半，中文近讲会议持平；复用说话人分离分支的 sherpa-onnx 运行时，几乎不增加二进制；也是 macOS 26 以下和 Windows 的唯一合理选择。要做到实时，需要再接流式 Paraformer 出 partial（+1 GB 下载、+≈10% CPU）或至少把 VAD 最长段缩到 8–10 s。
3. **说话人分离**：保留分支现在的 sherpa 管线作为默认，但在本批片段上和 **FluidAudio Sortformer** 正面比较（本次 Sortformer 中文会议 DER 15.6–18.9%，人数全对）；Sortformer 有 4 人上限和较高 CPU，适合作为“≤4 人会议”的选项。
4. **WhisperKit turbo 作为“会后高精度重转”**：术语和英文最好，但首次加载 116 s、长会话流式跟不上、静音/音乐会编文本，必须只喂 VAD 段，并对“感谢观看”这类典型幻觉做过滤。
5. **不集成 FluidAudio 的 ASR**（SenseVoice 空输出、Paraformer 乱码、CoreML 不走 ANE），只考虑它的 Sortformer。
6. **WebGPU 不用于 macOS**；Windows 版再评估，届时首选 sherpa 原生 CPU。

## 后续

- 用用户自己的真实录音（课堂、线上会议、带术语的分享）重跑一遍；本批片段每类只有一两段。
- 在原生 helper 里实测 SenseVoice 的内存、CPU 和功耗（这里是 Python），以及 VAD 最长段 8–10 s 时的定稿延迟。
- 在本批片段上跑说话人分离分支的实际实现，和 Sortformer 比较。
- 麦克风真实路径、长会话（≥1 h）稳定性、电池供电下的功耗，本次都没测。
- WebGPU 在 Windows 机器上的实测。

## 未测或不可靠的部分

- 每类场景只有 1–2 段，3–5 分钟；差几个点不显著。
- 能耗是系统级计数器减空闲基线，评测期间后台有其他应用（含 Pine 开发版的 helper），小数值不可靠；没有用 `powermetrics`（需要 sudo）。
- sherpa 的 CPU/内存是 Python 进程，含解释器开销。
- 说话人分离的 sherpa 阈值是在测试集上挑的，偏乐观。
- WebGPU harness 早期几次运行把 Chromium/Dawn 缓存写进了共享的 `~/Library/Application Support/Electron`（该目录原本就存在，未删除），之后改为独立 `--user-data`；冷启动数字取自独立目录。
- whisper.cpp、sherpa WASM、FluidAudio Parakeet 中文（不支持）未测。

## 复现

见 `apps/desktop/native/live-context/bench/README.md`。该目录不参与应用构建和打包：`scripts/build-native.mjs` 只编译 helper 的 `Sources`，`forge.config.ts` 只打包 `build/pine-live-context`；但 `build-native.mjs` 用整个 `native/live-context/` 的最新修改时间判断是否重编，改动 bench 会触发一次无变化的 helper 重编。

### 下载与校验

全部来自官方来源（GitHub Releases、模型作者的 Hugging Face 组织、数据集官方地址），保存在临时目录。WhisperKit 和 FluidAudio 的模型由各自的官方工具从 `argmaxinc/whisperkit-coreml`、`argmaxinc/speakerkit-coreml`、`FluidInference/*` 下载。

| 文件                                                                                                                                           | 字节       | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| https://huggingface.co/datasets/CAiRE/ASCEND/resolve/main/main/test-00000-of-00001.parquet                                                     | 105756434  | `a4c81d2b5ed6124f052089a695972808c16e0ce0c365ec9773c5d1a8fcf043a7` |
| https://huggingface.co/datasets/google/fleurs/resolve/main/data/cmn_hans_cn/audio/test.tar.gz                                                  | 525346466  | `09d19ad18f5d7e91076880807e866cd16abd924c7052b55f71cdae91714fc166` |
| https://huggingface.co/datasets/google/fleurs/resolve/main/data/cmn_hans_cn/test.tsv                                                           | 491487     | `5734461648f816181d7dab5fc79204b18c4b9bc2cd5138225b25c72d18385d21` |
| https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2             | 165783878  | `7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63` |
| https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx                                                             | 643854     | `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6` |
| https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2              | 6958444    | `24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488` |
| https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx | 28281164   | `aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2` |
| https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/ES2004a/audio/ES2004a.Mix-Headset.wav                                                | 33579394   | `3e2560b19bee6952c7c7ce041b0f1ea8a7ea9468044c4eea79d2a2c67e24ab0f` |
| https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/ES2004a/audio/ES2004a.Array1-01.wav                                                  | 33579394   | `6936edac5d0904fc5c4ab175546c5cc5366601fdc1b1e5183a6ea2c10f05d150` |
| https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip                                                               | 22887865   | `b56e5babb2496b8795deeeda7e71178d7fbc9963f94276cf2a3f4b56ebbc9f9d` |
| https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2                    | 1047319737 | `5462a1fce42693deae572af1e8c4687124b12aa85fe61ff4d3168bb5280e205f` |
| https://speech-lab-share-data.oss-cn-shanghai.aliyuncs.com/AliMeeting/openlr/Eval_Ali.tar.gz                                                   | 3673718355 | `dc47343b2474b5ebcf458927e878155f6ddeb59c85e685b3645c32a1f9578d92` |
| https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2             | 163002883  | `7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/config.json                                                                   | 2227       | `457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/generation_config.json                                                        | 3893       | `f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/preprocessor_config.json                                                      | 339        | `a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/tokenizer.json                                                                | 2480466    | `27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/tokenizer_config.json                                                         | 282683     | `2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/special_tokens_map.json                                                       | 2194       | `e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/added_tokens.json                                                             | 34604      | `9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/merges.txt                                                                    | 493869     | `2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/normalizer.json                                                               | 52666      | `bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/vocab.json                                                                    | 1036584    | `50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/onnx/encoder_model_fp16.onnx                                                  | 176607756  | `5549cd8666ff4b694ceb128bfa48b95bdcceec29075cf2c2212f90002cc058de` |
| https://huggingface.co/onnx-community/whisper-small/resolve/main/onnx/decoder_model_merged_q4.onnx                                             | 233149327  | `795c61b344576719c2b249cc9911c78b4cc552c8c6a5407be21a3380a0791b13` |
| https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/config.json                                                             | 922        | `fab7241d1e9fc6c2370c4c6dfb5da79bb54d67ed9ab6b507ac51d29d2abe01d1` |
| https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/generation_config.json                                                  | 147        | `f9b3f711b57be7def2e50a8942f64f36ee0a55fad5b84ff93a687b6c5bcc1d44` |
| https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/preprocessor_config.json                                                | 128        | `fa43a7017ef85cd1d0fba0d9aae77c8adb16990ae6f11115631f41ec5d8aa679` |
| https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/tokenizer.json                                                          | 3761754    | `7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f` |
| https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/tokenizer_config.json                                                   | 135735     | `edaee394565d428ea98a663ae7209cdcfeefc5585c42d7a570ff7c986df2cd15` |
| https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/special_tokens_map.json                                                 | 3          | `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356` |
| https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/onnx/encoder_model_fp16.onnx                                            | 40512679   | `30eb888737aa9b5fd7e89131ba4efade0364b54ad3e8029e00b607fd8b5acda0` |
| https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/onnx/decoder_model_merged_q4.onnx                                       | 72781828   | `9f26db50c9f3b2eb1962ab93e9753f908c56367817d791032af58cbf7dba3803` |
| https://huggingface.co/onnx-community/pyannote-segmentation-3.0/resolve/main/config.json                                                       | 408        | `5a4c6bb4f49f1b47c9bd398aac78b8cd4a9f30a0ff91b5c2dc68d05e13e160cf` |
| https://huggingface.co/onnx-community/pyannote-segmentation-3.0/resolve/main/preprocessor_config.json                                          | 158        | `dfc7d35a3895f8997eb94521e28b1921c03480a34fa9bcbb6bef1f1934f81480` |
| https://huggingface.co/onnx-community/pyannote-segmentation-3.0/resolve/main/onnx/model.onnx                                                   | 5986908    | `057ee564753071c0b09b5b611648b50ac188d50846bff5f01e9f7bbf1591ea25` |
| https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM/resolve/main/config.json                                                  | 38         | `4a65a1544d2085d7819632f130583d83f6815f49ef6c8ba6c8eb460bd4085041` |
| https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM/resolve/main/preprocessor_config.json                                     | 371        | `a81bbded0530b1bf5c3d395d2c5c7c266686e348be5989171290ace960f24ec2` |
| https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM/resolve/main/onnx/model.onnx                                              | 26535549   | `3955447b0499dc9e0a4541a895df08b03c69098eba4e56c02b5603e9f7f4fcbb` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/config.json                                                          | 1332       | `35cd83669f75bc2867f3b3a4461850392d5e308cd6ea951c3700539883c28df1` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/generation_config.json                                               | 3897       | `16f95291d2f47c944d3c2b19390bba7965666555c1ea2a0bdc850d1fab45612f` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/preprocessor_config.json                                             | 340        | `7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/tokenizer.json                                                       | 2480617    | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/tokenizer_config.json                                                | 282843     | `844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/special_tokens_map.json                                              | 2186       | `baea4ea09372eb4fca86b4e4346139fd73cb807d5087e9de0948e971739c3e74` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/added_tokens.json                                                    | 34648      | `3c51f66c4c21f9e126970078f11ae77a78c74aee8df606ee9daba86e467108e0` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/merges.txt                                                           | 493869     | `2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/normalizer.json                                                      | 52666      | `bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/vocab.json                                                           | 1036558    | `e2aa043ef015641d363d8288e7c241c85e36a5c761fb303598e0710233344387` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/encoder_model_fp16.onnx                                         | 1274342603 | `fdadc70836e6b028fd5e580417c312208dad073d2d01e509e2d127c1373399d8` |
| https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/decoder_model_merged_q4.onnx                                    | 334147222  | `8b933ac24074a24a1635084d06a4ed37e387ef22d980f184a5fc27418e9ceeb8` |

复核时 51 个文件的 SHA-256 全部与记录一致。
