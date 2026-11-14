# 预览批注组 · 第一期设计

> 状态：第一期已实现（2026-11-14）。范围：文本／代码、Markdown（源码与渲染视图）、HTML。
>
> 与下文草案相比，实现时改了三处：
> 1. **消息格式**：不新增 `<pine_annotations>` 块。批注作为 `PineQuote` 走现有的 `<pine_quotes>` 块，额外带 `file`（绝对路径）、`lines`（"12" 或 "12-18"）、`comment`，原文已不在文件中时带 `stale: true`。发送时文件本身也作为附件放进输入框。这样对话记录、排队消息、导出、侧聊都能直接复用。输入框里的引用改由 `contentTabs` store 按标签页保存（`quotesFor` / `addQuotes`）。
> 2. **状态**：只有 `orphaned` 一个布尔值，不区分「已移动」。重新定位在每次重新渲染后进行：找到了就更新偏移和行号，找不到就标为失效，之后再找到会自动恢复。
> 3. **锚点**：统一按渲染出的文本节点计算字符偏移，再加前后各 32 个字符的上下文（`lib/annotationAnchors.ts`）。行号只作为发给模型的位置信息，由渲染器的 `annotationLines(range)` 提供。批注记录了它是在哪个视图（源码或渲染）里创建的，只在该视图里高亮；从面板点击时会切换到那个视图。
> 第二期（docx / pdf / pptx / xlsx，`@file-viewer`）与第三期（图片、SVG、图表的区域批注）复用本期的数据模型与发送格式，只新增锚点类型。

## 1. 目标

在预览标签页里选中一段内容，就地写一条修改意见；同一文件可以攒多条，最后作为一组一次性交给某个会话，让 AI 逐条处理。

不做：多人协作、批注写回文件、跨应用重启持久化（见 §13 待定）。

## 2. 现状与约束

| 现状 | 位置 | 对本设计的影响 |
|---|---|---|
| 渲染器已上报选区：`selectionChange` 事件 + `readSelection()` | `file-preview/previewRenderer.ts` | 扩展这个契约，不另起一套 |
| Markdown 渲染视图的选区已能映射回源码行号 | `lib/filePreviewSelection.ts` | Markdown 两种视图都能用行号锚点 |
| 代码视图不是虚拟滚动，全文都在 DOM 里 | `TextPreviewRenderer.vue` | 任意批注的 `Range` 都能直接构造 |
| HTML 预览是 `sandbox="allow-same-origin"` 的 `srcdoc` iframe，无脚本 | `HtmlFrame.vue` | 父页面可读 `contentDocument` 的选区，也能在 iframe 的 `CSS.highlights` 上设高亮 |
| 会话附件按 `path` 去重 | `stores/contentTabs.ts` `setAttachments` | **同一文件的多段选区不能当多条附件发**，需要独立的批注块 |
| 消息里的结构化块：`<pine_attachments>` → `<pine_quotes>` → 正文 | `shared/attachments.ts`、`shared/quotes.ts` | 新增 `<pine_annotations>`，沿用同样的 JSON 块写法 |
| Electron 44（Chromium 支持 CSS Custom Highlight API） | `apps/desktop/package.json` | 高亮不改动渲染出来的 DOM |

## 3. 数据模型

新文件 `src/shared/annotations.ts`（主进程、渲染进程、微信远程、导出共用）：

```ts
/** 选区前后各取 32 个字符，用于文件变化后重新定位。 */
export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

export type AnnotationAnchor =
  /** 代码、纯文本、Markdown（两种视图都落到源码行）。 */
  | { kind: "lines"; startLine: number; endLine: number; quote: TextQuote }
  /** HTML 渲染视图：按可见文本定位；ordinal 区分同一文本的第几次出现。 */
  | { kind: "text"; quote: TextQuote; ordinal: number };
// 第二期：{ kind: "page"; page; quote } / { kind: "cells"; sheet; range } / { kind: "slide"; index; quote }
// 第三期：{ kind: "region"; page?; rect: [x, y, w, h] }（相对坐标 0–1）

export interface PreviewAnnotation {
  id: string;
  anchor: AnnotationAnchor;
  /** 人读的位置，如 "L12–18"、"第 2 段"。 */
  label: string;
  comment: string;
  createdAt: string;
  /** 文件变化后：仍在原处 / 找到了新位置 / 找不到原文。 */
  status: "anchored" | "moved" | "orphaned";
}

/** 一个文件上的一组批注。 */
export interface AnnotationGroup {
  projectId: string;
  folderId: string;
  relativePath: string;
  /** 建组时文件的 modifiedAt，用于判断是否需要重新定位。 */
  modifiedAt: string;
  annotations: PreviewAnnotation[];
}
```

限制：每组最多 50 条；`quote.exact` 最长 2 000 字符（超出截断并加 `…`，沿用 `normalizeQuoteText` 的写法）；`comment` 不能为空。

## 4. 状态归属

新增 Pinia store `src/stores/previewAnnotations.ts`：

- 以 `projectId + relativePath` 为键，而不是标签页 id。这样关掉预览标签页再打开，批注还在；同一文件在两个标签页里打开时，看到的是同一组批注。
- 操作：`add`、`update(id, comment)`、`remove`、`clear(fileKey)`、`reanchor(fileKey, source, modifiedAt)`、`take(fileKey)`（发送时取出并清空）。
- 项目关闭时清掉该项目的所有组。
- 第一期只存在内存里，见 §13。

## 5. 渲染器契约扩展

在 `previewRenderer.ts` 中：

```ts
export interface PreviewRendererCapabilities {
  // …现有字段
  /** 支持批注：能把选区转成锚点，也能把锚点还原成 Range。 */
  annotate?: boolean;
}

export interface PreviewRendererHandle {
  readSelection?: () => AttachmentSelection | undefined;
  fitWidth?: () => void;
  /** 当前选区 → 锚点、位置文案和选中文本。 */
  readAnnotationAnchor?: () =>
    | { anchor: AnnotationAnchor; label: string; text: string }
    | undefined;
  /** 锚点 → 当前 DOM 里的 Range；找不到返回 undefined。 */
  resolveAnnotationRanges?: (
    anchors: readonly AnnotationAnchor[],
  ) => (Range | undefined)[];
  /** 滚动到锚点并短暂闪烁。 */
  revealAnnotation?: (anchor: AnnotationAnchor) => void;
}

export type PreviewRendererEvents = {
  // …现有事件
  /** 内容重新渲染完毕（Markdown 异步渲染、切换视图、缩放后），外壳据此重算高亮。 */
  contentRendered: [];
};
```

各渲染器的实现：

- **TextPreviewRenderer（代码视图）**：锚点用 `filePreviewSelection` 已算出的行号，再加上 `TextQuote`。还原时在 `pre code` 内按行偏移构造 Range。
- **TextPreviewRenderer（Markdown 渲染视图）**：锚点同样是 `lines`。还原时先找出覆盖这些源码行的渲染块，再在块内按 `quote.exact` 搜索。找不到就高亮整块，不报失败。
- **HtmlPreviewRenderer / HtmlFrame**：锚点是 `text`。在 iframe 文档上用 `TreeWalker` 拼接可见文本，按 `exact + prefix/suffix` 和 `ordinal` 定位。

纯函数（锚点生成、文本搜索、重新定位打分）放在 `src/lib/annotationAnchors.ts`，便于单测。

## 6. 高亮与命中

- 使用 CSS Custom Highlight API：`CSS.highlights.set("pine-annotation", new Highlight(...ranges))`，当前选中的批注另设 `pine-annotation-active`。样式写 `::highlight(pine-annotation)`，颜色用主题 token，深色模式单独调。
- HTML iframe 用其自身 `contentWindow.CSS.highlights`。`::highlight` 样式由 `sandboxHtml` 注入 srcdoc，不需要脚本权限。
- 重算时机：`contentRendered`、批注增删、`status` 变化、标签页重新激活。
- Highlight API 不派发事件。点击高亮区域时，在 `pointerup` 中判断坐标是否落在某个 Range 的 `getClientRects()` 内，命中就在面板里选中对应批注并滚动过去。
- 测试环境（jsdom）没有 `CSS.highlights`：封装 `src/lib/annotationHighlights.ts`，不支持时直接空操作。

## 7. 文件变化后的重新定位

文件被 AI 或用户改动后（`preview.modifiedAt` 变化），对每条批注依次尝试：

1. **原位校验**：原行号范围或原 ordinal 处的文本仍等于 `exact` → 状态为 `anchored`。
2. **搜索**：在新内容里找所有 `exact` 的出现，按前缀和后缀的匹配长度打分；分数相同时取离原位置最近的 → 状态为 `moved`，同时更新行号。
3. **找不到** → 状态为 `orphaned`。批注保留，卡片显示「原文已变化」，发送时一并带上并标明。

只处理精确匹配，不做模糊匹配；模糊匹配的误报对「修改意见」危害更大。

## 8. 界面

### 8.1 添加批注

- 预览中有非空选区、且当前渲染器 `annotate` 为真时，选区末端旁浮出一个小工具条：`Comment` 按钮，加上已有的发送选区菜单（从现在的顶栏菜单复用）。
- 点击 `Comment` 后，在选区旁弹出 `Popover`，内含 `Textarea`：⌘/Ctrl+Enter 保存，Esc 取消。保存后出现高亮，选区清除。
- 快捷键：选中内容后按 ⌘/Ctrl+Alt+M 打开批注框。需要先和 `ProjectView.vue`、`useWindowTabShortcuts.ts`、`main/windowShortcuts.ts` 核对是否冲突。

### 8.2 批注面板

- 预览顶栏加一个开关按钮 `Comments`，有批注时带数量 `Badge`。面板停靠在预览区右侧，可拖宽（`resizable`），宽度不够时改为 `Sheet`。
- 面板按文档顺序列出卡片：位置文案（`L12–18`）、选中文本前两行（引用样式）、意见正文，以及编辑、删除按钮。`moved` / `orphaned` 状态用小标签提示。
- 点击卡片：`revealAnnotation` 滚动到对应位置并闪烁。
- 面板底部：`Send 3 comments to…`，目标列表与现有「发送选区」菜单一致（当前项目的会话标签页 + 新会话）；另有 `Clear all`，需要二次确认。
- 没有批注时，面板显示 `Empty` 并说明用法。

### 8.3 发送

发送不会直接提交消息，而是**放进目标会话的输入框**，与现有附件流程一致，用户可以补一句总体说明再发：

1. 从 store 中 `take` 出这组批注。
2. 文件本身照常作为附件加入输入框（`inspectProjectAttachments`，按 path 去重，一个文件只占一条）。
3. 批注组放进 `contentTabs` 新增的 `composerAnnotations[tabId]`。输入框上方显示一个附件式的标签（如「3 条批注 · report.md」），可以展开查看或移除。
4. 切换到目标会话并聚焦输入框。

发出去之后批注组就清空了。如果用户在输入框里移除了这个标签，批注**退回** store，不会丢失。

## 9. 消息格式

在 `src/shared/annotations.ts` 中新增：

```
<pine_attachments version="1">…</pine_attachments>

<pine_annotations version="1">
{"files":[{"path":"/abs/report.md","name":"report.md","annotations":[
  {"location":"L12–18","startLine":12,"endLine":18,
   "quote":"……选中的原文……","comment":"这里的数据口径要改成年度"},
  {"location":"L40","startLine":40,"endLine":40,
   "quote":"……","comment":"删掉这句","stale":true}
]}]}
</pine_annotations>

<pine_quotes version="1">…</pine_quotes>

用户补充的正文
```

- 块的顺序为附件 → 批注 → 引用 → 正文。`serialize*` / `parse*` 依次剥离，与现有两个块的写法相同。
- `stale: true` 对应 `orphaned`：原文已不在文件中，AI 应先确认，不要直接修改。
- agent 侧：在系统提示中补一句说明，例如「`<pine_annotations>` 是用户对文件中指定段落的修改意见；逐条处理，`stale` 的先核对」。具体放在哪个文件，实施时再确认（`agent/` 下系统提示的拼装处）。
- 需要同步识别这个块的消费方（都会调用 `parseAttachmentMessage` / `parseQuoteMessage`）：`ProjectTranscriptMessage.vue`（显示为可折叠的批注卡片）、`ProjectSessionComposer.vue`、`ProjectStagedSteering.vue`、`useSteeringMessageTransition.ts`、`shared/sessions.ts`、`attachmentMessagePreview`（会话列表摘要显示「3 条批注」）、`shared/sessionExport.ts`、`main/sideChats.ts`、`main/wechat/sessionDirectory.ts`。

## 10. 测试

均放在相邻目录的 `__tests__/` 下：

- `shared/__tests__/annotations.test.ts`：序列化往返、与附件块和引用块组合的顺序、非法 JSON 回落为纯文本、长度截断。
- `lib/__tests__/annotationAnchors.test.ts`：生成 TextQuote；原位校验；同一文本多次出现时按前缀和后缀选中正确的一处；行号漂移后找到 `moved`；文本删除后得到 `orphaned`。
- `stores/__tests__/previewAnnotations.test.ts`（`@pinia/testing`）：按文件键共享、项目关闭时清理、`take` 后清空、移除输入框标签后退回。
- 渲染器（Vue Test Utils）：TextPreviewRenderer 和 HtmlPreviewRenderer 的 `readAnnotationAnchor` / `resolveAnnotationRanges`；高亮模块在 jsdom 中为空操作。
- 端到端手动验证：Markdown 渲染视图加三条批注 → 让 AI 改文件 → 高亮跟随或标为失效 → 发送 → 记录中显示批注卡片，AI 回复逐条对应。

## 11. 同步文档与文案

- 8 个语言包都新增文案（`Comment`、`Comments`、`Send {n} comments to…`、`Clear all`、`Original text changed` 等）。
- `PINE_UI.md`：在 Content area 的文件预览部分说明批注入口、面板和发送行为；文末 Keyboard shortcuts 加上快捷键。与功能放在同一个提交。
- docs 仓库：在预览相关页面新增中文和英文说明，两边 PR 互相链接。
- CHANGELOG：发版时写一条「新增」。

## 12. 提交拆分

1. `feat(desktop): add the preview annotation message block`：shared 格式、解析和测试
2. `feat(desktop): anchor preview annotations to text and lines`：锚点库、store、重新定位
3. `feat(desktop): let text and HTML previews take comments`：渲染器契约、两个渲染器、高亮
4. `feat(desktop): collect preview comments and send them to a session`：浮动工具条、面板、输入框标签、记录显示、agent 提示，以及 `PINE_UI.md` 和 i18n

如果需要新增 shadcn 组件，单独提交（目前所需的 popover、textarea、badge、resizable、sheet、empty、scroll-area 都已存在，预计不需要）。

## 13. 待定

1. **是否持久化**：第一期只放内存，重启应用后丢失。如果要保留，可写入 `.pine/annotations/<hash>.json`，需要新增 IPC。建议等第一期用过之后再决定。
2. **发送后是否保留为「已发送」**，便于对照 AI 的修改：第一期直接清空。
3. **快捷键**：⌘/Ctrl+Alt+M 是否冲突，待核对。
4. **是否允许一次发送多个文件的批注组**：格式已支持多文件（`files` 数组），第一期 UI 只从单个预览发出。
