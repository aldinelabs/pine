# 文件预览渲染层

Pine 的预览链路分为两个注册点：主进程登记允许读取的二进制格式，renderer 登记负责显示该格式的组件。文件路径的授权、读取和 `pine-project-media://` URL 仍由主进程处理；预览组件只接收经过授权的内容描述。

## 格式与渲染器

- `apps/desktop/src/main/previewFormats.ts` 声明可经媒体协议提供的扩展名、MIME 类型和预览类型。未登记的文件仍按受限文本读取规则处理；无法解码时显示不支持。
- `apps/desktop/src/components/project/file-preview/previewRenderers.ts` 按顺序登记渲染器。第一个 `supports` 命中的渲染器负责该文件，因此新库可以只替换它支持的格式，其余格式继续使用现有实现。
- `previewRenderer.ts` 定义每个渲染器共同接收的 `PreviewRendererProps`、共同发出的 `PreviewRendererEvents`，以及工具栏读取的 `PreviewRendererCapabilities`。`ProjectFilePreview.vue` 只负责文件加载、通用工具栏、错误状态和发送到会话。

新增预览库时，先实现一个适配组件：接收 `preview`、文件信息、缩放、反色和显示模式；通过 `selectionChange` 返回 `AttachmentSelection`，通过 `metadataChange` 返回页数或媒体尺寸，通过 `failed` 报告加载失败。需要在菜单打开前同步读取文本选区时，可暴露 `readSelection()`。然后在 `previewRenderers.ts` 中登记它的匹配条件和能力声明。若库需要读取新的二进制扩展名，还要在 `previewFormats.ts` 中登记对应的 MIME 类型，不能绕过主进程的文件授权。

渲染器可以继续按需加载。代码、图片和视频使用直接组件；PDF 与 Office 适配器按需加载各自的库。替换某个库不应改变文件 tab、会话附件或媒体协议的接口。

## 内容刷新

打开的预览通过 `setWatchedFilePreview` 注册组件独立的监听，不依赖文件树组件的目录监听。主进程按窗口和 `watchId` 管理订阅，先使用预览读取相同的项目路径校验或 presented-file 授权解析路径，再建立文件元数据基线。每 500ms 比较文件的 mtime、ctime、大小、inode 和链接数；只读取元数据，实际内容刷新仍通过原有 IPC 重新校验授权。这样可以检测原地写入、替换保存、删除后重建，也不受原生目录事件漏报或监听器关闭影响。关闭预览、窗口或项目时释放订阅。

同一文件刷新期间保留现有内容和渲染器，读取完成后更新 props；文件切换才重置显示模式、缩放和反色。后台标签只标记待刷新，重新激活时读取最新内容；过时的读取响应不会覆盖新内容。二进制预览刷新时更新媒体 URL 的 revision，确保媒体组件重新加载。

文本渲染器在内容改变前记录纵向位置和源码的横向位置，在 Vue 更新、异步高亮与 Markdown 布局变化后恢复。内容变短时限制到新的可滚动范围。恢复监听在用户滚动、拖动滚动条或键盘操作时停止，也在显示模式切换、标签激活状态变化或组件卸载时清理。
