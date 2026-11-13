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

## 微信远程

无头服务端与桌面端共用同一个桥接器（`main/wechat/`，见[微信远程](wechat-remote.md)），区别在于绑定和设置没有图形界面：

- **绑定。** `pine-server --wechat-bind` 在终端里画出二维码（不打印成链接），再提示输入微信要求的验证码和微信发来的 6 位配对码。只有 stdin 和 stdout 都是终端时才绑定；否则打印说明，照常提供服务但不连接微信（作为服务运行时，先停掉服务，在前台运行一次，或用 `docker run -it`）。从不自动批准任何东西。
- **查看与修改。** 以下命令直接读写数据目录里的两个文件，可以在服务端停止时运行：

  ```text
  pine-server wechat status [--data-dir <dir>]
  pine-server wechat unbind [--data-dir <dir>]
  pine-server wechat config [--data-dir <dir>] [options]
  ```

  `config` 的选项：`--ceiling <mode>`、`--default-mode <mode>`（`let-me-review`、`auto-approve`、`autonomous`、`yolo`；默认模式会被钳制到上限以内并提示）、`--default-project <id|none>`（项目必须存在，`none` 表示临时工作区）、`--allow-high-risk <yes|no>`、`--allow-files <yes|no>`（只接受 `yes` 或 `no`）、`--language <zh|en|auto>`、`--pause`、`--resume`（二选一）。上限设为 `yolo` 时会打印警告；默认模式也是 `yolo` 时，警告会说明从微信新建的每个会话都直接以 YOLO 运行。`unbind` 清除绑定，并把权限设置恢复默认。

- **生效。** 运行中的服务端在收到 `SIGHUP`（`kill -HUP <pid>`）或重启时读取改动。`unbind` 后收到 `SIGHUP` 的服务端会停止微信通道，中止只有桥接器持有的会话。
- **存储。** 密封数据（`<data-dir>/wechat-remote-secure`：bot token、主人身份、权限设置、暂停状态）在服务端**不加密**，只靠 `0600` 文件权限保护；普通状态在 `<data-dir>/agent/wechat-remote.json`。
- **语言。** 服务端没有界面语言，`auto` 时回复英文。`--language` 写在普通状态文件里，运行中的服务端在收到 `SIGHUP` 之前的下一次写入可能把它覆盖；可靠的方式是在微信里发 `.lang`，或在服务端停止时修改。
- **本机通知与审批。** 本应弹出的系统通知写进服务端日志。服务端没有本机审批界面，所以微信里的 `.auto N on` 被拒绝。
