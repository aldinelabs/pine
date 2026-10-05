<p align="center">
  <img src="./apps/desktop/resources/icon.png" alt="Pine logo" width="128" />
</p>

<h1 align="center">Pine</h1>

<p align="center">
  <strong>致力于为所有人提供更多可能性的 AI 代理工作区。</strong><br />
  <sub>Agentic workspace dedicated to expanding possibilities for everyone.</sub>
</p>

> [!CAUTION]
> Pine 仍是超级早期的开发者预览版，不适合日常工作或重要数据。界面、数据格式、Agent 行为和项目结构都可能发生不兼容变更；当前不提供稳定版本、迁移或兼容性保证。

## Pine 想解决什么问题

现在的 AI Agent 大多是为开发者设计的：终端 TUI、编辑器插件、命令行参数。会用它们的人已经得到了效率红利，而每天处理文档、表格、报表、资料整理的大多数人，只能通过网页聊天框间接触碰自己的文件。

Pine 是这些人的桌面 harness：

- **办公文件是一等公民**。文本、图片、视频、PDF、DOCX、XLS/XLSX、PPTX 都能在工作区内直接预览和编辑，Agent 操作的正是你看到的文件。
- **看得见、管得住**。Agent 的每次读取、思考、工具调用和文件修改都完整呈现在会话 transcript 中；执行前可以审批、拒绝或给指引，随时中止。
- **本地优先**。项目、会话和文件都留在你的电脑上；模型连接（API key / OAuth）由你自己配置，Pine 不做中转。
- **界面向 Codex 这类优秀的 Agent 体验看齐**，并且完全开源（AGPL-3.0）——这套「普通人可用的 Agent 桌面工作区」不该是闭源产品独有的。

一句话概括使用方式：

```text
创建 Project → 授权文件夹 → 和 Agent 对话 → 审批 / 接管 → 文件与结果
```

## 当前状态

| 项目     | 当前情况                                                                                      |
| -------- | --------------------------------------------------------------------------------------------- |
| 版本     | `0.4.7`，开发者预览版                                                                         |
| 核心闭环 | Project Library → 文件夹授权 → 持久化会话 → Agent 工具调用 → 结果回显                         |
| 已验证   | `bun run check` 与平台构建 CI 覆盖格式、Lint、类型、单测及安装包启动冒烟检查                  |
| 打包     | Electron Forge 构建 macOS Apple Silicon / Intel DMG 与 Windows x64 Squirrel 安装包            |
| 发行     | `main` 每次 push 构建 macOS / Windows artifacts；正式版本仅通过手动 workflow 发布             |

### 平台支持

| 平台    | 支持状态             |
| ------- | -------------------- |
| macOS   | 完全支持             |
| Windows | 部分支持 / 尽力支持 |
| Linux   | 暂不支持             |

## 现在能做什么

- **项目管理**：创建、搜索、打开、删除 Project；一个 Project 可关联多个文件夹，逐个设置只读 / 读写权限和默认工作目录。
- **Agent 会话**：流式回复、工具调用事件、持久化会话；继续 / 中止 / 重命名 / 删除、会话分组、全文搜索、steering 消息、上下文用量展示；Agent 可以在会话中给出结构化的选择题卡片，直接点选作答。
- **文件工作区**：文件树（新建、重命名、移动、删除）、路径复制、多标签浏览；支持把项目文件原生拖入 Pine，图片 / HTML 预览支持触控板缩放。
- **审批与权限**：Agent 的本地工具严格限制在授权范围内；macOS 使用 `bash`，Windows 使用 `powershell`，越界操作必须通过对应的 privileged 工具单独审批。
- **模型与认证**：Provider / model catalog、API key / OAuth 登录、模型切换、thinking level；配置搜索 API key 后还可使用 `web_search` / `web_fetch`（带 URL、域名和大小校验）。
- **Skills**：全局与项目级 Skill 管理；Agent 检测到可复用的工作流时可将其沉淀为 Skill，并在 transcript 中以本地化条目呈现 Skill 活动。
- **Computer Use**：原生 computer-use 控制，操作过程带可见的 review 流程；macOS 与 Windows 内置对应平台的运行时。
- **桌面体验**：中英文界面、浅色 / 深色 / 跟随系统主题、多标签、窗口快捷键、macOS 侧栏模糊。

### 权限模式

| 模式              | 行为                                               | 适合场景                 |
| ----------------- | -------------------------------------------------- | ------------------------ |
| **Let Me Review** | 需要审批的调用逐一交给用户确认                     | 希望逐步审查 Agent 行动  |
| **Auto Approve**  | 在项目沙箱内自动执行；越过边界时请求审批           | 日常使用                 |
| **YOLO**          | 关闭 Pine 的沙箱、文件夹限制和审批门；使用原生权限 | 仅适合明确理解风险的实验 |

## 快速开始

需要 [Bun](https://bun.sh/)，版本以根目录 `package.json` 的 `packageManager` 为准。

```bash
git clone https://github.com/phosphoros-works/pine.git
cd pine
bun install --frozen-lockfile
bun run dev
```

在应用中创建一个 Project，选择 Agent 可以访问的文件夹，然后新建 Session 开始工作。

Windows 首次使用受限 Agent 工具前，在“设置 → 通用 → Windows 沙箱”点击“安装”；系统会弹出一次 UAC 请求，用于创建专用低权限账户并安装网络隔离规则。开发工具建议按机器范围安装，专用沙箱账户无法读取当前用户私有目录中的工具。

### 常用命令

| 命令                             | 用途                                   |
| -------------------------------- | -------------------------------------- |
| `bun run dev`                    | 启动桌面端开发环境                     |
| `bun run build`                  | 执行 Electron Forge 打包流程           |
| `bun run check`                  | 格式、Lint、类型检查与单元测试         |
| `bun run test`                   | 运行单元测试                           |
| `bun run test:coverage`          | 生成测试覆盖率报告                     |
| `bun run typecheck`              | 运行 TypeScript / Vue 类型检查         |
| `bun run shadcn:add <component>` | 使用固定版本的 shadcn-vue CLI 添加组件 |

### 发布

正式版本以 `apps/desktop/package.json` 的 SemVer 版本为准。发布前在
[`CHANGELOG.zh-CN.md`](./CHANGELOG.zh-CN.md)（中文）和 [`CHANGELOG.md`](./CHANGELOG.md)（英文）
各添加同版本、同日期、条目一一对应的章节，然后手动运行 GitHub Actions 的 `release`
workflow。Release 正文先列中文、再列英文；`update.json` 同时带两种语言，应用内更新提示按界面语言显示。预检会拒绝已被任一 GitHub Release 使用的版本；
安装包名称同时包含外部版本和构建 commit 的七位短 hash。

可选的 Cloudflare R2 latest 镜像在 [`.pine/release.json`](./.pine/release.json)
配置，其中 `publicBaseUrl` 应使用绑定到 R2 bucket 的生产自定义域名。启用后需在仓库 Secrets 中设置 `R2_ACCESS_KEY_ID` 和
`R2_SECRET_ACCESS_KEY`。Windows 正式发布还要求 `WINDOWS_CERTIFICATE_BASE64`（PFX 的 Base64）和 `WINDOWS_CERTIFICATE_PASSWORD`，预览构建可保持未签名。每次正式发布会覆盖配置 prefix 下的
`latest/Pine-darwin-arm64.dmg`、`latest/Pine-darwin-x64.dmg`、
`latest/Pine-win32-x64.exe`、`latest/win32-x64/RELEASES`、对应 NuGet 包、
`latest/SHA256SUMS` 和 `latest/update.json`；首次发布时会直接创建这些对象。
自动更新检查和安装包下载完全通过这个 R2 域名，不依赖 GitHub 可用性。
发布 workflow 会对 `latest/update.json` 设置 `no-store`，对固定 latest 安装包设置
`no-cache`，并让 manifest 指向长期缓存的不可变版本文件。Cloudflare Cache Rule 也应
明确 bypass `*/latest/update.json`；生产分发应使用 R2 自定义域名而非 `r2.dev`。

## 架构要点

- Renderer 不直接访问 Node.js、文件系统或 shell，只通过最小 preload IPC 与 Main process 通信。
- Agent runtime 运行在独立的 Electron utility process 中，基于 [Pi Agent Core](https://github.com/earendil-works/pi-coding-agent)。
- 文件请求使用 `{ folderId, relativePath }`，由 Main process 校验路径边界；Project 元数据和会话存放在 Electron `userData` 下，不写入用户项目目录。
- Pine 不复制、移动或接管项目文件夹；删除 Project 只删除 Pine 自己的元数据目录。

完整文档见 [`docs/project-system.md`](./docs/project-system.md) 与 [`docs/agent-execution-environment.md`](./docs/agent-execution-environment.md)。

## 仓库结构

```text
apps/
  desktop/                        Electron 桌面端
packages/
  computer-use-runtime/           Computer Use 的平台运行时与工具规格
  rpiv-ask-user-question/         Agent 结构化提问（选项卡片）运行时
  rpiv-todo/                      Agent 任务清单协议与状态运行时
docs/                            产品、架构与执行环境文档
```

技术栈：Electron Forge · Vue 3 · TypeScript · Vue Router · Pinia · shadcn-vue · Reka UI · Tailwind CSS v4 · Vitest · Bun workspace · Pi Agent Core。

## 参与贡献

Pine 仍在快速迭代，欢迎 Issue、设计讨论和代码贡献。提交改动前请运行：

```bash
bun run check
```

项目约定：直接依赖使用精确版本，锁文件随依赖变更提交；提交遵循 [Conventional Commits](https://www.conventionalcommits.org/)；一个逻辑变更对应一个提交。更多约定见 [`AGENTS.md`](./AGENTS.md)。

## License

Pine is free software licensed under the [GNU Affero General Public License v3.0](./LICENSE).
