# Project Instructions

## 用户偏好

- 默认使用 Bun 作为包管理器。
- 回复保持简洁、准确，避免 hype。
- 修改项目结构或代码前先说明将要改什么。

## 项目约定

- 这是一个 monorepo，应用放在 `apps/`，共享包放在 `packages/`。
- 桌面端第一版位于 `apps/desktop`。
- 使用 TypeScript 严格模式。
- 测试文件放在 `__tests__/` 目录。
- Electron 渲染进程不直接访问 Node.js、文件系统或 shell；通过 preload 暴露的最小 IPC API 访问主进程能力。
- 项目级 Pine 元数据放在 `.pine/` 目录。
- 应用基础设施和横切能力应在功能开发初期统一规划，避免随着页面推进零散引入依赖；新增包必须有明确职责、稳定边界和验证方式。
- Renderer 的可导航 UI 状态使用 Vue Router，跨视图应用状态使用 Pinia；文件系统和 Electron 原生能力仍只通过 preload IPC 访问。
- 代码默认使用分号、双引号和两个空格缩进，由 ESLint 与 Prettier 共同校验。
- 单元测试使用 Vitest；Vue 组件使用 Vue Test Utils，Pinia store 测试可使用 `@pinia/testing`。测试统一放在相邻模块的 `__tests__/` 目录。
- shadcn-vue 生成的 `src/components/ui/` 与 `src/styles/shadcn-vue.css` 不做全局格式化改写；组件升级继续以 CLI 生成结果为准。
- 提交前运行 `bun run check`，统一执行格式、Lint、类型和单元测试检查；需要覆盖率报告时运行 `bun run test:coverage`。
- 提交遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，使用 `feat(scope): ...`、`fix(scope): ...`、`docs:`、`chore:` 等格式；scope 指向受影响的包或模块，如 `desktop`、`session`。
- 提交保持原子化：一个逻辑变更对应一个提交，不要混合不相关改动。涉及 `shadcn:add`、依赖升级（如 `package.json` / `bun.lock`）等基础设施类改动时，与功能改动拆分提交。
- 本地开发分支保持可推送状态，变更经 `bun run check` 通过后提交并推送。
- 当 Bun 长时间停在 `Resolving dependencies`，且请求经过本地代理时，临时绕过代理并降低网络并发后重试：

  ```sh
  env -u http_proxy -u https_proxy -u all_proxy \
    -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    bun install --network-concurrency 8
  ```

- 直接依赖使用精确版本，不使用 `latest`、`*`、`^` 或 `~`；新增依赖由 `bunfig.toml` 的 `install.exact = true` 默认保存精确版本。唯一例外是 `@earendil-works/pi-ai`：它因依赖稳定 API 并高频更新内置模型目录，故意使用 `latest`，以免反复手动修改 manifest。依赖升级仍必须同步提交 `package.json` 和 `bun.lock`，并通过完整检查。
- Bun 版本以根目录 `package.json` 的 `packageManager` 为准；首次安装、CI 和复现构建使用 `bun install --frozen-lockfile`。
- 依赖安装默认不使用 `--force`；强制安装会重新解析并可能更新无关传递依赖。仅在确认需要完整重建依赖时使用。

## Pi 依赖同步

- Pine 运行的 `@earendil-works/pi-*` 以 `bun.lock` 里解析出的 npm 发布版本为准，包括 `pi-ai` 自带的模型目录；不对 `node_modules` 做任何覆盖或回填，本地 `dev` / `build` 与 CI 打包都不改动已安装的包。
- 想拿到新模型，升级依赖（更新 `bun.lock`）即可；不要重新引入从上游 `main` 回填目录或整包的机制（曾让 agent 静默丢失全部工具和 system prompt）。
- `bun run verify:pi` 会用 mock provider 真跑一轮 agent 并断言请求里带 system prompt 和工具定义（需要绑定本地端口）；排查"agent 没有工具"这类问题时先跑它。

## CHANGELOG 与发布记录

- CHANGELOG 只写“和上一个已发布版本相比，用户能感知到的差异”，不写实现过程。
- 写用户视角的结果：用户在什么场景下会看到界面、行为、可用模型、性能或错误信息发生变化。不写内部机制、脚本与 CI 步骤、提交顺序、排查过程、失败的尝试，也不写“重构了 X”“同步了 Y 目录”这类只有参与者看得懂的内容。
- 每条记录必须能在没有对话上下文时被单独读懂。避免“修复了某通道”“改了某流程”这种读者无法判断意义的表述，改成读者能验证的现象。
- 平台和流程细节不是卖点。只有当它确实改变用户拿到的东西时才提（例如“新模型会随版本一起到来”）。
- 分类沿用 Keep a Changelog 的 新增 / Added、变更 / Changed、修复 / Fixed，每条中英双语、先中文后英文。宁可少写一条，也不要写用户看不懂的一条。

## shadcn-vue 组件流程

- 默认 UI 基底使用 shadcn-vue 官方 `reka-luma` style，配置在 `apps/desktop/components.json`。
- 标准添加组件命令从仓库根目录运行：

  ```sh
  bun run shadcn:add <component>
  ```

- 不要直接把 shadcn Studio / React shadcn 的 `style: "radix-rhea"` 写进 `components.json`。Studio 来源和映射记录在 `apps/desktop/shadcn-studio.json`。
- 组件添加后保持 shadcn-vue 生成结果，不套用 React shadcn 的 Rhea patch。
- `shadcn:add` 遇到已存在的文件提示覆盖时直接覆盖（可传 `--overwrite`）；CLI 带来的依赖升级、lockfile 与 CSS 变量等副作用一并保留，不回退。
- `shadcn:add` 使用 workspace 已安装的固定版本 CLI；生成后检查依赖约束，将直接依赖固定到本次锁文件解析出的版本，保留升级结果。
- 当 skill、生成代码与当前 shadcn-vue 官方文档或用例存在分歧时，先核对当前官方用例；以官方用例和项目实际需求为准，并记录偏离原因，不为迎合 skill 机械修改官方生成结果。

- 添加或修改组件后运行：

  ```sh
  bun run typecheck
  ```

- 如果 Bun 下载或安装在当前环境里很慢，把需要运行的命令列给用户手动执行。
