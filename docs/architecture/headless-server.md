# 无头服务端的代码结构

无头服务端的用户文档（构建、选项、部署、远程控制、与桌面端的差异）已移到[文档站](https://docs.aldine.cn/zh/pine/advanced/server/)。本文只记录代码结构。

无头服务端与桌面端是同一套应用核心（`apps/desktop/src/main/core`），区别只在宿主能力。

```text
src/main/core/pineCore.ts   应用核心：项目、会话、agent 事件、浏览器服务
src/main/core/requests/     按领域注册的共享请求处理器
src/main/core/host.ts       宿主需要提供的平台能力（PineHost）
src/main.ts + main/desktop/ Electron 宿主：窗口、通知、快速输入框、原生对话框
src/server.ts + server/     Node 宿主：参数、fork 出的 agent、文件凭据、终端配对
```

`vite.server.config.ts` 构建服务端时禁止引入 `electron`，桌面代码误入核心会直接让构建失败。
