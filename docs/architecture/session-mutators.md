# Session mutator 与“和 Pine 协作创建”

技能、自动化和 MCP 服务器的“新建”入口都提供两种方式：手动界面，以及“和 Pine 协作创建”。后者打开一个新的 draft，在第一条消息发出前把对应的编写工具和编写说明预先激活，用户不用先说“帮我激活某某工具”。

## Session mutator

Session mutator 是从对话之外改变会话状态的声明式操作，定义在 `shared/sessionMutators.ts`：

```ts
type PineSessionMutator = {
  kind: "activate-authoring";
  target: "skill" | "automation" | "mcp";
};
```

- 可序列化，原样经过 renderer → main → agent worker。
- renderer 把 mutator 挂在 draft tab 上（`contentTabs` 的 `mutators`），发送第一条消息时随 `PromptSessionRequest.mutators` 一起提交。composer 上方以标签显示，用户可以移除，移除后就是普通 draft。
- main 在会话创建或恢复之后、发送消息之前调用 worker 请求 `session:mutate`。会话正在运行（steer、follow-up）或改写消息时不接受 mutator。
- worker 的 `PineAgentRuntime.mutateSession` 只在空闲会话上执行；自动化运行会话不接受。已经激活的目标会跳过。

## 预激活的效果

`activate-authoring` 与模型自己调用激活工具的结果相同：

1. 追加激活条目（`pine.skill-authoring-active`、`pine.automation-authoring-active`、`pine.mcp-authoring-active`），恢复会话后仍然有效，动态工具随之显示。
2. 追加一条自定义消息 `pine.session-mutation`，内容是对应的编写说明，作为模型上下文；`details.mutator` 记录来源。

会话记录里这条消息显示为对应激活工具的 marker（`sessionMutationToolCall`），和模型自己激活时看起来一样。

## MCP 编写工具

此前 Pine 没有让 agent 配置 MCP 的工具。现在由常驻的 `activate_mcp_authoring` 激活以下工具，编写说明位于 `agent/mcp/mcp-authoring/SKILL.md`，包括配置文件位置、格式、凭据处理和工作流程。

| 工具                     | 审批               | 说明                                       |
| ------------------------ | ------------------ | ------------------------------------------ |
| `mcp_config_list`        | 否                 | 全局与项目范围的服务器、配置路径和连接状态 |
| `mcp_config_save`        | 是，任何模式都询问 | 新增、替换或改名；先校验定义               |
| `mcp_config_set_enabled` | 启用时是，停用时否 | 保留定义，切换启用状态                     |
| `mcp_config_remove`      | 否                 | 删除服务器                                 |

- 配置写入 pi-mcp-adapter 的文件：全局 `~/.config/mcp/mcp.json`，项目 `<默认文件夹>/.mcp.json`。实际读写由 main 通过宿主请求 `mcp` 完成（`main/core/requests/mcp.ts`），worker 不直接写文件。
- MCP 服务器会在 Pine 沙箱之外运行程序或携带用户凭据访问服务，所以保存和启用在 YOLO 模式下也询问用户。
- 交给模型的定义会把 `env`、`headers`、`bearerToken`、`oauth.clientSecret` 中的字面值替换为 `<redacted>`；`${VAR}` 等环境变量引用保留。保存时 `<redacted>` 还原为原值，模型不需要也看不到凭据原文。
- 修改后 MCP 连接在本次运行结束后重新加载，下一条消息即可使用新服务器。
