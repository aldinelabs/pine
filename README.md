<p align="center">
  <img src="./apps/desktop/resources/icon.png" alt="Pine logo" width="128" />
</p>

<h1 align="center">Pine</h1>

<p align="center">
  <strong>致力于为所有人提供更多可能性的 AI 代理工作区。</strong><br />
  <sub>Agentic workspace dedicated to expanding possibilities for everyone.</sub>
</p>

> [!CAUTION]
> Pine 目前是早期开发者预览版，不适合日常工作或重要数据。界面、数据格式、Agent 行为和项目结构都可能发生不兼容变更，不提供稳定版本、迁移或兼容性保证。

## 背景

多数 AI Agent 工具面向开发者：终端、编辑器插件、命令行参数。每天处理文档、表格、报表和资料的人，大多只能通过网页聊天框间接接触自己的文件。

Pine 尝试为这类场景提供一个桌面端 Agent harness：

- 常见办公文件（文本、图片、视频、PDF、DOCX、XLS/XLSX、PPTX）可在工作区内直接预览，Agent 操作的就是你看到的文件。
- Agent 的读取、思考、工具调用和文件修改都显示在会话记录中；需要审批的操作会先询问，运行过程中可以随时中止。
- 项目、会话和文件保存在本机。模型连接（API key / OAuth）由你自己配置，Pine 不做中转。
- 以 AGPL-3.0 开源。

## 当前状态

| 项目 | 情况                                                                  |
| ---- | --------------------------------------------------------------------- |
| 版本 | `0.8.1`（开发者预览）                                                 |
| 打包 | Electron Forge：macOS（Apple Silicon / Intel）DMG、Windows x64 安装包 |
| CI   | `main` 每次 push 构建 macOS / Windows 产物；正式版本仅手动发布        |

| 平台    | 支持情况 |
| ------- | -------- |
| macOS   | 支持     |
| Windows | 部分支持 |
| Linux   | 暂不支持 |

## 功能

**项目与会话**

- 启动后直接进入工作区。新会话所属的项目通过输入框旁的选择器（或输入 `@`）选择；“无项目”用于不属于任何项目的临时工作。
- 一个项目可关联多个文件夹，逐个设置只读 / 读写权限和默认工作目录；可设置图标和强调色。同一窗口的标签页可来自不同项目。
- 会话持久化，支持流式回复、中止、重命名、分组、全文搜索、追加指引（steering）、编辑已发送消息并从该处继续，以及上下文用量显示。多个会话可同时运行。
- Agent 可以给出选择题卡片供点选作答，也可在你确认后把会话移到更合适的项目。

**文件**

- 文件树支持新建、重命名、移动、删除，可多标签浏览。
- 可把文件或文件夹拖入 Pine，或拖到会话标签页作为附件；预览会随文件变化自动刷新。

**Agent 能力**

- 本地工具限制在授权的文件夹内：macOS 使用 `bash`，Windows 使用 `powershell`；越界操作需通过 privileged 工具单独审批。
- 任务清单（跨会话保留，含依赖关系）与后台命令显示在右侧栏；长时间运行的 shell 命令会转入后台，可查看日志和停止，完成后在对话中通知。
- 上下文压缩：默认由模型撰写摘要，也可选用不调用模型的“语义化算法（Beta）”。
- 图像生成：按需启用 `generate_image`，支持文本加多张参考图，结果保存到项目文件中。
- Skills（全局与项目级）和 MCP 服务器（全局或项目级）。
- Computer Use：带可见 review 流程的原生桌面控制，macOS 与 Windows 各内置对应运行时。
- 配置搜索 API key 后可使用 `web_search` / `web_fetch`。

**模型与界面**

- 内置 Provider / 模型目录，支持自定义提供商与模型、API key / OAuth 登录、模型切换和 thinking level。
- 中英文界面；浅色 / 深色 / 跟随系统；八种强调色。

### 权限模式

| 模式          | 行为                                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| Let Me Review | 需要审批的调用逐一交给用户确认。                                             |
| Auto Approve  | 在项目沙箱内自动执行；越过边界时由 AI 审核，必要时请求用户确认。             |
| Autonomous    | 越界操作由 AI 自行审核，理由不足时请 Agent 补充，不逐次打断用户。            |
| YOLO          | 关闭 Pine 的沙箱、文件夹限制和审批；使用原生权限，仅适合明确理解风险的实验。 |

自动审批默认由大模型审核，也可在偏好设置中改用 Decisions 初筛模型（Beta）。

## 快速开始

需要 [Bun](https://bun.sh/)，版本以根目录 `package.json` 的 `packageManager` 为准。

```bash
git clone https://github.com/phosphoros-works/pine.git
cd pine
bun install --frozen-lockfile
bun run dev
```

在应用中选择一个项目（或使用“无项目”），添加 Agent 可访问的文件夹，然后开始会话。

Windows 首次使用受限 Agent 工具前，需在“设置 → 通用 → Windows 沙箱”中点击“安装”。系统会弹出一次 UAC 请求，用于创建专用低权限账户并安装网络隔离规则。开发工具建议按机器范围安装，专用沙箱账户无法读取当前用户私有目录中的工具。

## 开发

| 命令                             | 用途                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `bun run dev`                    | 启动桌面端开发环境                                        |
| `bun run build`                  | 执行 Electron Forge 打包                                  |
| `bun run check`                  | 格式、Lint、类型检查与单元测试                            |
| `bun run test`                   | 运行单元测试                                              |
| `bun run test:coverage`          | 生成测试覆盖率报告                                        |
| `bun run typecheck`              | TypeScript / Vue 类型检查                                 |
| `bun run verify:pi`              | 用 mock provider 验证 Agent 带有 system prompt 与工具定义 |
| `bun run shadcn:add <component>` | 使用固定版本的 shadcn-vue CLI 添加组件                    |

### 架构

- Renderer 不直接访问 Node.js、文件系统或 shell，只通过最小的 preload IPC 与 Main process 通信。
- Agent runtime 运行在独立的 Electron utility process 中，基于 [Pi](https://github.com/earendil-works/pi-coding-agent)。
- 文件请求使用 `{ folderId, relativePath }`，由 Main process 校验路径边界。项目元数据和会话保存在 Electron `userData` 下，不写入用户的项目目录。
- Pine 不复制、移动或接管项目文件夹；删除项目只删除 Pine 自己的元数据。

详见 [`docs/project-system.md`](./docs/project-system.md)、[`docs/agent-execution-environment.md`](./docs/agent-execution-environment.md)，以及 [`docs/architecture/`](./docs/architecture/) 下的专题文档（并发会话、文件预览、Pi 扩展边界、沙箱审计等）。

### 仓库结构

```text
apps/
  desktop/                  Electron 桌面端
packages/
  computer-use-runtime/     Computer Use 的平台运行时与工具规格
  pi-background-tasks/      后台 shell 命令（bg_run / bg_status / bg_logs / bg_kill）
  rpiv-ask-user-question/   结构化提问（选项卡片）
  rpiv-todo/                任务清单协议与状态
docs/                       产品、架构与执行环境文档
```

技术栈：Electron Forge、Vue 3、TypeScript、Vue Router、Pinia、shadcn-vue / Reka UI、Tailwind CSS v4、Vitest、Bun workspace。

### 发布

版本号以 `apps/desktop/package.json` 为准。发布前在 [`CHANGELOG.zh-CN.md`](./CHANGELOG.zh-CN.md) 和 [`CHANGELOG.md`](./CHANGELOG.md) 中添加同版本、同日期、条目一一对应的章节，然后手动运行 GitHub Actions 的 `release` workflow。预检会拒绝已被使用的版本。

Release 正文先中文后英文；应用内更新提示按界面语言显示其中一种。可选的 Cloudflare R2 `latest` 镜像在 [`.pine/release.json`](./.pine/release.json) 中配置，自动更新检查和安装包下载走该域名。所需的 Secrets 与缓存规则见 [`.github/workflows/release.yml`](./.github/workflows/release.yml)。

## 参与贡献

欢迎 Issue、设计讨论和代码贡献。提交前请运行 `bun run check`。

约定：直接依赖使用精确版本，锁文件随依赖变更一并提交；提交遵循 [Conventional Commits](https://www.conventionalcommits.org/)，一个逻辑变更对应一个提交。更多约定见 [`AGENTS.md`](./AGENTS.md)。

## License

[GNU Affero General Public License v3.0](./LICENSE)
