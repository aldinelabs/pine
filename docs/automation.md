# Pine Automation v1

> 状态：设计草案（第 4 版），待评审
> 范围：自动化的定义格式、检测与执行模型、脚本触发器、密钥、存储、权限，以及供 agent 创建和编辑自动化的工具

## 1. 目标

- 用户用自然语言描述需求，由 agent 编写自动化；界面只提供列表、启停、运行历史和批准。
- 自动化在用户的本地文件、本地时间与电脑状态上触发，这是云端产品做不到的部分。
- 无人值守运行有明确、可审查的权限边界；超出边界的操作交给审批模型判断，不等待用户，也不静默放行。
- 交付以产出物为准：更新文件、生成草稿、发送通知，没有新内容时不打扰用户。

非目标（v1）：

- 不使用 Git worktree。
- 不提供脚本形式的执行层（§2）。
- 脚本触发器只做定期轮询，不做常驻监听（WebSocket、IMAP IDLE 等）。
- 不做邮件、IM 等需要第三方账号授权的事件触发；这类来源以后通过 MCP 接入。使用固定令牌的接口可以用脚本触发器加密钥轮询（§3.2、§7.4）。
- 不代替用户发送消息或提交表单；自动化最多生成草稿。

## 2. 模型：检测层与执行层

```text
trigger ──► detector + state ──► when ──► payload ──► action ──► delivery
  (何时检查)  (有没有新东西)    (值不值得)  (交给谁什么)  (agent 运行)  (结果去哪)
└──────────────── 检测层：确定性，不调用模型 ────────────────┘└──── 执行层 ────┘
```

检测层频繁运行，必须便宜、确定、可离线验证：它读取文件元数据、时间和系统状态，或运行只读的轮询脚本，计算出事件列表。只有在检测层产生了值得处理的事件时，才启动一次 agent 运行。这样每分钟检查一次文件夹也不会产生模型费用，并且可以在不调用模型的情况下用 `dry_run` 验证自动化是否按预期触发。

**设计原则：代码只决定何时唤醒 agent，工作始终由 agent 完成。** 检测层可以是 agent 编写的代码，但它只读、只产出事件，不做任何决定或修改。执行层只有 agent 一种：读懂非结构化内容、判断是否值得报告、处理格式变化和例外、写出给人看的结果，这些正是 Pine 与系统自带的自动化工具（快捷指令、Hazel 等）的区别。触发和执行都是代码的自动化，用那些工具更合适，Pine 不重复提供。

## 3. 定义格式

定义用 TypeBox 声明 schema 并校验，与现有工具参数一致；下文用 TypeScript 类型表述。每个定义都带 `version`，格式变更通过显式迁移完成。

```ts
interface AutomationSpec {
  version: 1;
  name: string; // 1–100 字符，用户可见
  description?: string; // 给人看的说明，不参与执行
  enabled: boolean;

  triggers: Trigger[]; // 至少一个；任意一个触发即进入检测
  when?: CelExpression; // 对整批事件求值，返回 bool
  payload?: Record<string, CelExpression>;
  action: AgentAction;
  delivery: Delivery;
  secrets?: SecretUse[]; // 本自动化使用的密钥（§7.4）
  limits?: Limits;
}
```

### 3.1 触发器

```ts
type Trigger =
  | {
      kind: "schedule";
      rrule: string; // RFC 5545 RRULE，按项目时区展开
      timezone?: string; // 默认使用系统时区
      missed: "run-once" | "skip"; // 睡眠或关机错过时；默认 run-once
    }
  | {
      kind: "folder";
      folderId: string; // Project Folder ID，路径不越出该文件夹
      path?: string; // 文件夹内相对目录，默认根目录
      include?: string[]; // glob，例如 ["**/*.pdf"]
      exclude?: string[];
      events: ("added" | "changed" | "removed")[];
      settleSeconds?: number; // 文件大小与 mtime 稳定多久后才算完成，默认 5
      batchSeconds?: number; // 合并多久内的事件为一次运行，默认 30
    }
  | {
      kind: "system";
      event: "resume" | "unlock" | "app-start" | "idle";
      idleMinutes?: number; // event 为 idle 时必填
      window?: TimeWindow; // 例如只在工作日 8:00–11:00 生效
      oncePer?: "day" | "week"; // 例如“每天第一次开盖时”
    }
  | {
      kind: "script";
      every: string; // ISO 8601 时长，最短 PT5M
      window?: TimeWindow;
      source: string; // JavaScript 模块源码，最长 64 KiB（§3.2）
      capabilities: ScriptCapabilities;
    }
  | { kind: "manual" }; // 只能从界面或 agent 手动运行

interface TimeWindow {
  days?: ("MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU")[];
  from: string; // "HH:mm"，本地时间
  to: string;
}
```

`schedule` 用 RRULE，可以表达“每月第 3 个工作日”“每周一 9:00”这类办公节律。`system` 触发器依赖宿主能力（§6.2）；宿主不支持时校验失败，而不是静默不触发。

### 3.2 脚本触发器

脚本触发器用于声明式触发器表达不了的检测：网页或公告栏是否更新、内部接口是否有新单据、RSS 是否有新条目。脚本是一个无状态的轮询函数：输入上一次的 `cursor`，输出事件列表和新的 `cursor`。

```js
export default async function poll(ctx) {
  const res = await ctx.fetch("https://erp.example.com/api/orders?status=new", {
    headers: { Authorization: `Bearer ${ctx.secrets["erp-token"]}` },
  });
  const orders = await res.json();
  const lastId = ctx.cursor?.lastId ?? 0;
  const fresh = orders.filter((o) => o.id > lastId);
  return {
    events: fresh.map((o) => ({ id: String(o.id), data: o })),
    cursor: { lastId: Math.max(lastId, ...orders.map((o) => o.id)) },
  };
}
```

**运行环境。** 脚本在 QuickJS（WASM）中运行，没有 Node API、模块加载、定时器或全局 `fetch`，只能使用 Pine 注入的 `ctx`。安全边界因此就是 `ctx` 的接口面，在桌面端和 Linux 无头服务端上行为一致，不依赖 OS 沙箱，内存与执行时间也可以精确限制。v1 只接受 JavaScript；类型约定写在编写说明里，不做 TypeScript 转译。

```ts
interface ScriptCapabilities {
  network: string[]; // 允许访问的主机名，精确匹配
  read: FolderGrant[]; // 允许读取的项目文件夹
}

interface ScriptContext {
  cursor: JsonValue | null;
  now: string; // ISO 时间
  secrets: Record<string, string>; // 只包含 spec.secrets 中声明的密钥（§7.4）
  fetch(url: string, init?: ScriptFetchInit): Promise<ScriptResponse>;
  fs: {
    list(
      grant: FolderGrant,
      options?: { include?: string[] },
    ): Promise<FileEntry[]>;
    stat(grant: FolderGrant, path: string): Promise<FileEntry | null>;
    readText(grant: FolderGrant, path: string): Promise<string>; // 最多 1 MiB
  };
  parse: {
    xml(text: string): JsonValue; // 也用于 RSS / Atom
    csv(text: string): string[][];
  };
  log(...values: unknown[]): void; // 写入运行记录
}

interface ScriptFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface ScriptResult {
  events: { id: string; data: JsonValue }[];
  cursor?: JsonValue;
}
```

- `fetch` 由主进程代发，按 `capabilities.network` 检查主机，不限制请求方法；重定向到白名单外的主机时请求失败。
- `fs` 只读，路径按 Project Folder 规则解析，不能越出授权的文件夹。办公文件（xlsx、docx、PDF）的内容不在脚本里解析：脚本用 `list` / `stat` 发现变化，判断内容交给 agent。
- 事件 `id` 由脚本提供，Pine 据此去重，保留最近 5 000 个。
- `cursor` 只由脚本写入，与 agent 通过 `automation_report` 写入的 `cursor` 分开存放。

**上限。** 每次执行 30 秒、64 MiB 内存；每次最多 10 个请求，单个响应最多 5 MiB；返回结果最多 256 KiB、100 个事件。超出上限、抛出异常或返回值不合 schema 都算一次失败，连续 5 次失败后自动化暂停并通知用户。

### 3.3 检测与状态

检测层为每个触发器产出事件：

```ts
interface AutomationEvent {
  id: string; // 去重键
  trigger: Trigger["kind"];
  at: string; // ISO 时间
  file?: {
    folderId: string;
    path: string; // 文件夹内相对路径
    name: string;
    ext: string;
    size: number;
    mtime: string;
    change: "added" | "changed" | "removed";
  };
  system?: { event: string };
  script?: { data: JsonValue }; // 脚本返回的事件数据
}
```

- 文件事件的去重键是 `folderId + path + size + mtime`。已经处理过的键记录在状态中，重复的文件系统通知不会再次触发运行。
- 正在写入的文件（例如下载中）在 `settleSeconds` 内大小与 mtime 都不变后才产生事件。
- 网络盘、云盘目录上 `fs.watch` 不可靠，这类目录退回轮询；`dry_run` 结果中会注明使用的是哪种方式。
- 每个自动化有一份 `state`，内容由 Pine 维护（去重键、上次运行时间、上次成功时间），agent 也可以通过 `automation_report` 写入一个由它自定义、有大小上限的 `cursor` 对象，例如“已汇总到第 42 行”。脚本触发器的 `cursor` 单独存放（§3.2）。
- **首次启用不回溯。** 启用自动化或修改了它的触发器时，Pine 先记录现状作为基线：文件夹触发器把范围内已有的文件记为已处理，脚本触发器执行一次基线轮询，保留返回的 `cursor`、丢弃事件。用户可以在启用时选择“同时处理现有内容”，这时现有内容按每批最多 100 个事件分批处理，并计入 `limits`。
- 运行期间产生的事件如何处理，见 §6.6。

### 3.4 `when` 与 `payload`

过滤条件和 payload 映射使用 CEL（Common Expression Language）。CEL 没有循环和副作用，求值时间有上限，可以在保存前做静态类型检查，适合由 AI 编写、由 Pine 执行。

可用变量：

| 变量         | 内容                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| `events`     | 本次批次的 `AutomationEvent` 列表                                            |
| `state`      | 当前状态，包括 `cursor`、`lastRunAt`、`lastSuccessAt`；不包含脚本的 `cursor` |
| `now`        | 求值时刻的 timestamp                                                         |
| `automation` | `name` 与 `id`                                                               |

Pine 额外提供少量纯函数：`glob(path, pattern)`、`isWorkday(ts)`、`formatDate(ts, pattern)`。CEL 求值不能读取文件内容；需要文件内容判断时，交给执行层的 agent。

示例：

```text
when:    events.exists(e, e.file.size > 0 && !e.file.name.startsWith("~$"))
payload: { "files": events.map(e, e.file.path), "month": formatDate(now, "yyyy-MM") }
```

`payload` 的每个值都是 CEL 表达式，固定文本写成 CEL 字符串字面量（`"'报销/2026.xlsx'"`），避免同一个字段既可能是文本又可能是表达式。payload 以结构化数据的形式放进 agent 的首条消息，并单独标注来源，与用户指令分开（§7.3）。

### 3.5 执行

```ts
interface AgentAction {
  kind: "agent";
  instructions: string; // 每次运行的固定指令，最长 20 000 字符
  skills?: string[]; // 运行时预先调用的技能
  model?: string; // 缺省时使用项目默认模型
  session: "new" | "continue"; // 每次新会话，或接续同一个会话
  permissions: PermissionEnvelope;
}

interface PermissionEnvelope {
  read: FolderGrant[]; // 只能是本项目已有的文件夹或其子目录
  write: FolderGrant[];
  network: string[]; // 允许的域名；默认为空
  tools: string[]; // 允许使用的工具；默认是不需要审批的文件工具（§8.4）
  mcp?: { server: string; tools: string[] }[];
}

interface FolderGrant {
  folderId: string;
  path?: string;
}
```

`session: "continue"` 用于需要累积上下文的任务（例如每天补充同一份周报）。上下文过长时按现有的压缩逻辑处理。

权限范围会编译成本次运行的沙箱策略（§6.7），文件工具和 shell 受同样的限制。需要审批的原生执行工具（`privileged_bash` / `privileged_powershell`）只有列在 `tools` 中才会提供。

### 3.6 交付与上限

```ts
interface Delivery {
  notify: "on-findings" | "always" | "never"; // 默认 on-findings
  outputs?: FolderGrant[]; // 产出物所在位置，用于在运行记录里展示与比较
}

interface Limits {
  maxRunsPerDay?: number; // 默认 24
  maxTokensPerRun?: number;
  maxMinutesPerRun?: number; // 默认 30
}
```

邮件草稿等产出物也只是 agent 写入 `outputs` 位置的文件（例如 `.eml`），Pine 不提供发送能力。

是否有值得报告的内容，由运行中的 agent 调用 `automation_report` 说明（§8.3），而不是让 Pine 去猜测 agent 的回复。没有报告就结束的运行按 `findings` 处理，宁可多一条通知，也不漏掉一条结果；但如果声明了 `outputs` 而产出物都没有变化，这次运行算失败（§6.5）。

触及 `limits` 时，自动化自动暂停，并通知用户暂停原因。

## 4. 示例

用户在对话中说：“以后下载文件夹里出现发票 PDF，就帮我把金额和日期登记到报销表。”agent 生成：

```json
{
  "version": 1,
  "name": "发票登记",
  "enabled": true,
  "triggers": [
    {
      "kind": "folder",
      "folderId": "downloads",
      "include": ["**/*.pdf"],
      "events": ["added"]
    }
  ],
  "when": "events.exists(e, e.file.size > 0)",
  "payload": { "files": "events.map(e, e.file.path)" },
  "action": {
    "kind": "agent",
    "instructions": "读取 payload.files 中的每个 PDF。是发票的，把开票日期、金额、销售方追加到 报销/2026.xlsx；不是发票的跳过。最后用 automation_report 列出登记了哪些发票。",
    "session": "new",
    "permissions": {
      "read": [
        { "folderId": "downloads" },
        { "folderId": "docs", "path": "报销" }
      ],
      "write": [{ "folderId": "docs", "path": "报销" }],
      "network": [],
      "tools": ["read", "edit", "write"]
    }
  },
  "delivery": {
    "notify": "on-findings",
    "outputs": [{ "folderId": "docs", "path": "报销" }]
  }
}
```

批准卡片（§7.1）的事实部分：

> **发票登记**
> 触发：文件夹“下载”中新增 `**/*.pdf`
> 执行时可读取：下载、文档/报销 可写入：文档/报销 网络：无
> 工具：读取、编辑、写入 超出权限时：由审批模型判断，不会询问你

事实部分下面是审批模型生成的说明，例如“每当下载文件夹里出现新的 PDF，agent 会逐个判断是否为发票，并把发票信息追加到报销表；它不会联网，也不会修改报销文件夹以外的文件”。

第二个例子使用脚本触发器和密钥。用户说：“ERP 里有新的待审批采购单时，帮我整理成一份审批摘要。”agent 生成的触发器与执行部分如下（脚本源码即 §3.2 的示例）：

```json
{
  "triggers": [
    {
      "kind": "script",
      "every": "PT15M",
      "window": {
        "days": ["MO", "TU", "WE", "TH", "FR"],
        "from": "08:00",
        "to": "19:00"
      },
      "source": "export default async function poll(ctx) { … }",
      "capabilities": {
        "network": ["erp.example.com"],
        "read": []
      }
    }
  ],
  "secrets": [{ "name": "erp-token" }],
  "payload": { "orders": "events.map(e, e.script.data)" },
  "action": {
    "kind": "agent",
    "instructions": "为 payload.orders 中的每张采购单写一段审批摘要，标出金额超过 5 万或供应商首次出现的单据，结果追加到 采购/待审批.md。",
    "session": "new",
    "permissions": {
      "read": [{ "folderId": "docs", "path": "采购" }],
      "write": [{ "folderId": "docs", "path": "采购" }],
      "network": [],
      "tools": ["read", "edit", "write"]
    }
  }
}
```

批准卡片的事实部分：

> **采购单摘要**
> 触发：检测脚本，工作日 08:00–19:00 每 15 分钟（可展开源码）
> 检测脚本可访问：erp.example.com 可读取：无
> 执行时可读取：文档/采购 可写入：文档/采购 网络：无
> 使用密钥：erp-token ⚠ 检测脚本可以联网，密钥可能被发送到 erp.example.com
> 超出权限时：由审批模型判断，不会询问你

## 5. 存储

按 [Project System](project-system.md) 的约定，Pine 不在用户文件夹中写入元数据，自动化存放在 Project 的应用数据目录下：

```text
<userData>/projects/<project-id>/automations/
└── <automation-id>/
    ├── automation.json        # 当前定义，含 revision
    ├── revisions/<n>.json     # 历史定义，用于展示变更和回退
    ├── state.json             # 去重键、时间戳、agent 与脚本各自的 cursor
    ├── polls.jsonl            # 脚本触发器最近的执行记录：耗时、请求、日志、错误，滚动保留
    └── runs/<run-id>.json     # 每次运行：事件、payload、会话 ID、结果、耗时、用量
```

- 脚本源码是定义的一部分，存放在 `automation.json` 中，随 revision 一起保留历史。
- 密钥的元数据与值分开存放（§7.4），不进入 `automation.json`、运行记录和会话。
- 写入使用同目录临时文件加 rename。
- 运行的完整对话仍是 Pi JSONL 会话，`runs/*.json` 只引用会话 ID。
- 运行的会话文件直接写在项目的会话目录里，和普通会话放在一起。
- 运行记录默认保留 90 天或 200 条；过期的运行记录连同它的会话一起删除，用户在其中发过消息或标为保留的会话除外（§9）。删除自动化时，用户没有发过消息的运行会话一并删除。
- v1 只支持项目级自动化。全局自动化需要跨项目的权限模型，留到以后。

## 6. 运行时

### 6.1 服务与会话归属

`AutomationService` 位于 `main/core/`，由 `pineCore` 持有，桌面端与无头服务端共用。无头服务端可以 7×24 运行自动化，不受电脑睡眠影响，这一点可以作为部署建议写进 [无头服务器](headless-server.md)。

`ProjectRuntimeRegistry` 按 client ID 持有项目运行时，浏览器访问已经用伪 client `WEB_CLIENT_ID` 接入同一套机制。自动化沿用这种做法，不另建一套运行时：

- `AutomationService` 以伪 client `AUTOMATION_CLIENT_ID` 通过 `share()` 获取项目运行时：项目已在某个窗口打开时复用同一个运行时，否则单独打开一个。
- 运行会话的 `controllerId` 是 `AUTOMATION_CLIENT_ID`，并记录 `origin: "automation"`、automation ID 与 run ID。发给这个 client 的事件交给 `AutomationService` 处理（`automation_report`、结束、失败），不发往界面。
- 共享同一项目运行时的窗口通过现有的 `clientsOfSession` 路由收到这些会话的事件，可以实时查看。运行中的会话在界面上只读，只能查看和停止。
- 运行结束后，用户在该会话里发出第一条消息时，它转为普通会话：运行记录标为已接续并保留，此后由界面的项目运行时打开它。运行中发消息会被拒绝。
- 自动化仍持有运行中的会话时，界面关闭、移动或删除它都不会结束这次运行；运行结束后自动化释放会话，界面下次使用时从磁盘重新打开。
- 没有运行中的自动化、也没有其他 client 持有该项目时，自动化 client 释放运行时，与关闭窗口的语义一致。
- 关闭项目窗口不会停止自动化运行；退出 Pine 会停止运行，运行记录标为 `interrupted`。

v1 的自动化会话与交互式会话共用同一个 agent utility process。按[并发会话](architecture/concurrent-sessions.md)的现状，它本来就是共享的故障边界；进程崩溃时运行记录标为 `interrupted` 并计为一次失败。为自动化单独起进程需要重复启动 MCP 服务器、占用更多内存，等有崩溃数据再决定。

### 6.2 宿主能力

在 `PineHost` 上增加可选能力：

```ts
interface PineHost {
  // ...
  powerEvents?: {
    on(event: "resume" | "unlock" | "lock", listener: () => void): () => void;
    idleSeconds(): number;
  };
  launchAtLogin?: {
    get(): boolean;
    set(enabled: boolean): void;
  };
}
```

桌面端基于 Electron `powerMonitor` 与 `app.setLoginItemSettings` 实现；无头服务端两者都不提供，因此 `system` 触发器在服务端校验时报错。

### 6.3 Pine 没有运行时

桌面端只有 Pine 在运行时才会执行自动化。关闭最后一个窗口后能否继续运行，取决于已有的“后台保持运行”设置。

- 启用自动化时，如果“后台保持运行”已关闭，Pine 提示关闭窗口后自动化不会运行，并提供两个开关：开启后台保持运行、登录时启动 Pine。
- 后台保持运行关闭期间，自动化页面顶部常驻同样的提示。
- 错过的运行按 §6.4 的规则在下次启动时补上。

### 6.4 调度规则

- 每个自动化同一时间只有一次运行；运行期间到达的事件按 §6.6 处理，不排起长队。
- `schedule` 按 RRULE 计算下一次时间，用单个 `setTimeout` 等待；收到 `resume` 后重新计算并处理错过的运行（`missed`）。
- 启动 Pine 时，对上次退出期间错过的运行按同样规则处理，最多补一次。
- 全局同时运行的自动化不超过 2 个（Windows 上为 1 个，见 §6.7），超出的排队。脚本触发器的执行另有并发上限 4，不占用运行名额。
- 脚本触发器按 `every` 间隔执行，间隔从上一次执行结束时开始计算；睡眠恢复后只补执行一次。

### 6.5 运行与失败

一次运行就是用正常的 agent harness 跑一轮会话。provider 限流、网络错误等沿用交互式会话现有的重试规则，自动化不另加一层重试。

满足以下任一条件时，这次运行算失败：

- 会话以错误结束、被中止，或超过 `limits.maxMinutesPerRun`；
- 没有调用 `automation_report` 就结束，且声明了 `delivery.outputs`，而这些位置的文件都没有变化。

`automation_report` 报告 `nothing` 的运行是成功的。

定义引用的东西在运行开始时逐项检查：模型不在当前模型目录里、技能被删除、工具已移除（§8.4）、密钥缺失或未填写、文件夹缺失。任何一项不满足时，运行直接失败并记录原因，不启动 agent，也不做替换或降级。

项目权限变化时，同样立即检查所有自动化。权限范围要求的文件夹被移除、重新定位或改成只读时，自动化暂停，并说明是哪一项权限不再满足；用户恢复项目权限后重新启用，启用按 §7.1 需要批准。Pine 不会用缩小后的权限继续运行：那样会让 agent 在运行中途才遇到拒绝，结果更难预料。

连续 5 次失败后，自动化暂停并通知用户。脚本轮询的失败单独计数（§3.2）。

其他约定：

- 文件被其他程序占用（例如正在 Excel 中打开）等冲突由 agent 自行处理，Pine 不加文件锁；编写说明提醒 agent 在指令里写明遇到占用时怎么做。
- 运行中没有用户可问，不提供 `ask_user_question`。

### 6.6 防止自我触发

自动化写入的位置如果恰好是它自己监听的范围，每次运行都会触发下一次。判断一段脚本会观察什么不可行，但判断两组授权是否相交是确定的：一次运行只能写入它的写入授权（沙箱保证），只能访问它的网络授权。Pine 据此归因，不分析脚本语义。

**运行期间锁定。** 从运行开始，到运行结束后再过一个稳定窗口（文件夹触发器的 `settleSeconds`，默认 5 秒），本自动化的触发器照常检测，但产生的事件先暂存，不启动新的运行。

**归因。** 锁定结束时，逐个判断暂存的事件是否可能由本次运行造成：

| 触发器 | 可能由本次运行造成                                                                                | 处理                                                |
| ------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 文件夹 | 事件路径落在本次运行的写入授权内                                                                  | 记为已处理，丢弃                                    |
| 文件夹 | 事件路径在写入授权外                                                                              | 不可能，保留到下一批                                |
| 脚本   | 脚本的读取授权与执行层的写入授权相交，或脚本访问的主机与执行层的网络授权相交，或执行层有 MCP 工具 | 锁定结束后执行一次基线轮询：保留 `cursor`，丢弃事件 |
| 脚本   | 以上都不相交                                                                                      | 不可能，照常处理                                    |

本次运行用过经批准的原生执行（不受沙箱约束）时，所有暂存事件都按“可能”处理。被丢弃的事件数写入运行记录，例如“运行期间有 3 个变化被视为本次运行的产出”。

**熔断。** 10 分钟内由事件触发的运行达到 5 次时，自动化暂停，原因记为“疑似自我触发”。

**校验提示。** `automation_validate` 和批准卡片在文件夹触发器的范围与写入授权重叠时给出提示，但不阻止保存：有些自动化本来就要在原地处理文件。

### 6.7 沙箱

现状：沙箱配置由 `createSandboxConfig` 从 `PineToolAccessPolicy` 生成，读写授权来自项目文件夹，网络的 `allowedDomains` 始终为空。macOS 与 Linux 每次调用独立隔离；Windows 只有一个全局的持久监督进程和一条全局串行队列，按 cwd、配置和环境变量生成 key，key 不同就销毁重建。[执行环境](agent-execution-environment.md)要求专用沙箱账户不能同时持有多个项目的授权，所以 Windows 不能为不同权限并存多个监督进程。

决定：

- **每次运行单独生成策略。** 用权限范围里的文件夹（包括子目录）创建本次运行的 `PineToolAccessPolicy`。文件工具和 shell 都经由这一个策略授权，权限范围因此同时约束两者。
- **运行的工作目录。** `PineToolAccessPolicy.create` 要求默认工作目录位于一个可写授权内。自动化运行以该自动化在项目临时存储下的独立目录作为 cwd，并作为可写授权加入，这样只读的自动化也能运行，临时文件也不会和用户的会话混在一起。
- **网络。** 自动化运行的沙箱配置把 `allowedDomains` 设为权限范围的 `network`；交互式会话不变。
- **Windows。** 保持“同一时间只有一个权限快照”的约束，不做监督进程池。自动化运行与交互式会话交替使用沙箱时，监督进程会重建，因此 Windows 上同一时间只运行 1 个自动化。密钥按单条命令传入，不放进监督进程的环境变量，避免每个自动化都产生不同的 key；实施时要确认监督进程支持按请求传入环境变量。发布前用 `PINE_SANDBOX_PERF=1` 实测快照切换的开销。

## 7. 权限与安全

自动化是 agent 写出的、在用户不在场时持续运行的程序，主要风险是提示注入被持久化：agent 读到一份恶意文档后，顺手建了一个定期向外发送文件的自动化。

### 7.1 创建与修改

- 创建、修改定义、扩大权限和启用都必须经过用户批准，**任何批准模式下都不例外，包括 YOLO**。YOLO 是用户对当前会话的授权，不能延伸到以后的无人值守运行。这一点与技能编写工具不同。
- **只能在本机批准。** 这些批准只能在这台电脑的 Pine 桌面窗口中完成。远程控制和浏览器访问中会显示请求，但只能查看，并提示“请在这台电脑上批准”。
- 暂停、删除和缩小权限不需要批准。
- 用户在本机的定义编辑器（§9）里亲手保存，本身就是批准，不再弹出批准卡片；编辑器同样只在本机提供，保存前仍做与 `automation_validate` 相同的校验。

批准卡片分三部分：

1. **事实**：由 Pine 从定义确定性地生成，包括触发器类型与参数、读写的文件夹、可访问的主机、使用的密钥、工具列表。这些都是名称和枚举值，只需要按界面语言翻译标签。这一部分是权威的。
2. **说明**：Pine 只把定义（不含当前对话）交给设置中的审批模型，由它按用户的界面语言说明这个自动化在什么时候运行、检测脚本和 CEL 表达式检查什么、agent 会做什么、有哪些值得注意的行为。卡片上标明“由审批模型生成”。指令和脚本里可能夹带针对模型的文字，所以说明只作参考，权限以事实部分为准。
3. **警示**：确定性生成。包括：脚本同时能读文件和联网；使用密钥且检测层或执行层可以联网（列出密钥可能被发往的主机）；文件夹触发器的范围与写入授权重叠（§6.6）；本次修改发生在读取外部内容之后（§7.3）。

修改时显示与上一版定义的差异，重点标出权限扩大的部分；脚本源码可以展开，有改动时显示源码差异。

### 7.2 运行时权限

自动化运行使用“自主工作”模式（`autonomous`）：

- 权限范围就是本次运行的沙箱策略（§6.7），范围内的操作直接执行。
- 沙箱拒绝、命中危险命令规则、需要原生执行的调用，都交给审批模型判断，不询问用户。审批模型拒绝时，拒绝原因返回给 agent，由它调整做法或在报告中说明。
- 审批模型收到的上下文包括该自动化的定义与权限范围，据此判断这次调用是否符合自动化声明的用途。
- 审批模型不可用时，相应调用一律拒绝。
- 运行中不会有等待用户的审批，因此 Pine 重启时也没有需要恢复的审批状态。

### 7.3 防止提示注入

- 自动化运行中不提供 `activate_automation_authoring`，自动化不能创建或修改自动化。
- payload 和文件内容是数据。系统提示和首条消息格式明确区分固定指令与 payload，与现有对附件的处理一致。
- 会话中读取了外部内容（网页、下载的文件、MCP 结果）后，`automation_create` / `automation_update` 的批准卡片上额外显示一条警示，说明本次修改发生在读取外部内容之后。
- 脚本返回的事件数据同样是外部内容，经 payload 进入 agent 时按数据处理。

### 7.4 密钥

密钥是用户保存的一段机密文本，可以是在线服务的令牌，也可以是本地命令需要的数据库密码、解密口令或 CLI 令牌。Pine 不关心它用在哪里，只负责保存、按声明提供，以及在输出中脱敏。

```ts
interface AutomationSecret {
  name: string; // 小写字母、数字和连字符，项目内唯一
  description?: string; // 给人看的用途说明
  // 值不在这条记录里
}

interface SecretUse {
  name: string;
  env?: string; // 执行层中的环境变量名，默认 PINE_SECRET_<NAME>，例如 PINE_SECRET_ERP_TOKEN
}
```

**提供方式。** 自动化在 `spec.secrets` 中声明要用的密钥，声明过的密钥在两处可用：

- 检测层：脚本通过 `ctx.secrets[name]` 读取。
- 执行层：本次运行中 shell 命令（包括需要审批的原生执行）的环境变量。值不出现在 agent 的上下文里，agent 只知道变量名。

只在自动化运行中提供，交互式会话不提供。引用不存在或未填写值的密钥时校验失败，界面提示用户补填。

**创建与填写。** 只有用户能创建密钥和填写值，入口在项目设置的“自动化密钥”中。agent 只能按名称引用，不能设置或读取值。编写说明要求 agent 引导用户在设置中填写，而不是把密钥贴进对话，因为对话会保存在会话记录里。

**脱敏。** 工具输出在交给模型之前，以及会话记录、运行记录、脚本日志、事件、cursor 和错误信息中，出现的密钥原值一律替换为 `[secret:<name>]`。

**边界。** 脱敏只按原值匹配，挡不住 base64、拆分等刻意变形。密钥能否被外传，取决于自动化的网络权限：检测层与执行层的网络默认关闭，只能访问声明过的主机。所以批准卡片会列出使用的密钥以及它们可能被发往的主机（§7.1）。Pine 不对单个密钥另做主机限制。

**存储。** 桌面端使用现有的 `credentialStorage`（系统钥匙串）；无头服务端沿用模型密钥的方式，保存为仅本用户可读的文件。元数据存放在 `<userData>/projects/<project-id>/automation-secrets.json`。删除项目时一并删除；删除一个仍被引用的密钥时，相关自动化暂停。

## 8. Agent 工具

沿用 `activate_skill_authoring` 和 `activate_media_generation` 的模式：常驻的只有一个激活工具，激活结果记录为会话条目，恢复会话后仍然有效；动态工具由 `toolNamesForAutomationAuthoringState` 控制显隐。激活时返回一份编写说明（`automation-authoring/SKILL.md`），内容包括 schema、CEL 变量表、`ctx` 接口、示例和编写流程。

“和 Pine 协作管理”打开的 draft 会通过 session mutator 在第一条消息前预先激活这些工具（见 [session-mutators.md](architecture/session-mutators.md)），效果与调用 `activate_automation_authoring` 相同。

### 8.1 激活

| 工具                            | 说明                               |
| ------------------------------- | ---------------------------------- |
| `activate_automation_authoring` | 无参数；返回编写说明并启用以下工具 |

### 8.2 编写工具（激活后可用）

| 工具                      | 参数                                | 审批             | 说明                                                                                                                                                                                                |
| ------------------------- | ----------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automation_list`         | —                                   | 否               | 本项目自动化的 ID、名称、启用状态、下次运行时间、最近一次结果                                                                                                                                       |
| `automation_get`          | `id`                                | 否               | 完整定义、revision 与状态                                                                                                                                                                           |
| `automation_validate`     | `spec`                              | 否               | schema、CEL 类型检查、脚本语法检查、文件夹、工具名与密钥名解析、自我触发重叠检查；返回错误、警示和事实摘要                                                                                          |
| `automation_dry_run`      | `spec` 或 `id`，可选 `sampleEvents` | 视情况           | 只跑检测层：基于当前真实状态或样例事件，返回会不会触发、事件列表、`when` 结果和 payload；不启动 agent。脚本触发器会真正执行一次，并返回请求与日志；脚本要联网或读取文件时，按普通工具调用的规则审批 |
| `automation_secrets_list` | —                                   | 否               | 本项目密钥的名称、说明与是否已填写值；不返回值                                                                                                                                                      |
| `automation_create`       | `spec`                              | 是，仅本机       | 校验通过后请求批准；批准后保存，按 §3.3 建立基线                                                                                                                                                    |
| `automation_update`       | `id`、`baseRevision`、`spec`        | 是，仅本机       | `baseRevision` 与当前不一致时拒绝，避免覆盖用户在界面上的改动                                                                                                                                       |
| `automation_set_enabled`  | `id`、`enabled`                     | 启用时是，仅本机 | 暂停不需要批准                                                                                                                                                                                      |
| `automation_run_now`      | `id`                                | 否               | 立即按当前状态触发一次；权限仍按定义执行                                                                                                                                                            |
| `automation_delete`       | `id`                                | 否               | 删除定义；状态与运行记录一并删除                                                                                                                                                                    |
| `automation_runs`         | `id`，可选 `limit`、`runId`         | 否               | 运行记录：触发事件、payload、结果、错误、暂停原因、因自我触发被丢弃的事件数；用于排查“为什么没触发”                                                                                                 |

编写说明要求 agent 按以下顺序工作：先 `automation_validate`，再 `automation_dry_run` 并把结果告诉用户，最后 `automation_create`。

### 8.3 运行时工具（只在自动化运行中可用）

| 工具                | 参数                                                                | 说明                                                                                         |
| ------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `automation_report` | `status: "findings" \| "nothing"`、`summary`、`outputs?`、`cursor?` | 结束本次运行并给出结果；`nothing` 且 `notify` 为 `on-findings` 时静默归档；`cursor` 写入状态 |

### 8.4 工具 ID

`tools` 中的工具由 agent 按名称书写，保存时 Pine 换成工具 ID，读取时再换回当前名称：

- 每个 Pine 工具在代码中有一个写死的 UUID，集中登记在一张注册表里（名称 → ID）。
- 工具改名只改注册表里的名称，已保存的定义不受影响。
- 工具移除时，注册表保留它的 ID 作为墓碑记录；引用它的运行失败，并说明“工具已移除”（§6.5）。
- 单元测试检查 ID 唯一、不复用、不从注册表删除。
- MCP 工具由外部服务器提供，没有稳定 ID，仍按 `server` 与工具名引用；找不到时运行失败。

## 9. 界面

侧边栏新增“自动化”入口，带未读数。收件箱与自动化管理合并在同一个页面里，分两个标签页：

- **动态**（默认）：所有运行按时间倒序排列。每条显示自动化名称、时间、状态和报告摘要的第一行，未读的带圆点。筛选项为“未读”“需要处理”（失败与暂停）和“全部”；报告 `nothing` 的运行默认隐藏，只在“全部”中出现。打开即标为已读，支持全部标为已读。
- **自动化**：自动化列表，显示启用开关、下次运行时间和最近一次结果。点开一项会在上层打开独立的详情对话框，包括批准卡片同款的事实与说明、运行历史、立即运行、暂停和删除；管理对话框本身不做页内跳转。

不单独做运行详情页。每次运行都是项目侧边栏里一条带自动化图标的会话，标题为自动化名称；在“动态”、详情对话框或通知里点开一次运行，就用普通对话界面打开这条会话，运行中可以实时查看。会话搜索同样包含运行会话。用户发过消息的运行会话转为普通会话，不随运行记录过期删除（§5、§6.1）。

通知：

- 有结果的运行按 `notify` 设置发送系统通知；失败和暂停总会通知，不受 `notify` 影响。
- 点击通知打开运行详情。

其他：

- 批准卡片复用现有审批组件，增加事实、说明、警示、权限差异和脚本源码视图；远程控制与浏览器访问中只读（§7.1）。
- 后台保持运行关闭时，页面顶部显示提示（§6.3）。
- 项目设置中的“自动化密钥”：新增、修改值与说明、删除，并列出引用它的自动化。值写入后不再显示。
- 新建自动化有两种方式：“和 Pine 协作管理”打开一个预先激活编写工具的新会话；“手动创建”打开定义编辑器。详情对话框中的“编辑定义”也打开同一个编辑器。
- 定义编辑器直接编辑 JSON 定义，“检查”执行校验并试运行检测层，显示事实、警示与试运行结果；“保存”即视为用户批准（§7.1）。只在本机提供。
- v1 不提供图形化的触发器编辑器。

## 10. 依赖

新增三个直接依赖，按仓库约定固定版本：

| 包                     | 职责                     | 边界                                                | 验证                                               |
| ---------------------- | ------------------------ | --------------------------------------------------- | -------------------------------------------------- |
| `rrule`                | RRULE 解析与展开         | 只在 `AutomationService` 的调度模块中使用           | 时区、夏令时、月末、错过补跑的单元测试             |
| `@marcbachmann/cel-js` | CEL 解析、类型检查、求值 | 只在检测层使用；启用 parse limits 与超时            | 变量表、自定义函数、恶意表达式（深度、长度）的测试 |
| `quickjs-emscripten`   | 脚本触发器的 JS 运行环境 | 只在脚本执行模块中使用；不注入 `ctx` 以外的宿主能力 | 内存、时间、输出上限，越权访问与逃逸尝试的测试     |

`rrule` 与 `quickjs-emscripten` 的维护状态需要在实施前再次核实；`rrule` 的备选是它的加固 fork `@spiandorello/rrulejs`。文件监听复用 `node:fs` 的 `watch`。仓库目前没有 XML / CSV 解析库，`ctx.parse` 的实现方式见 §13。

## 11. 验证

单元测试（Vitest，放在相邻模块的 `__tests__/`）：

- 调度：用假时钟覆盖 RRULE 展开、时区与夏令时、月末、时间窗口、错过补跑与睡眠恢复。
- 文件夹检测：稳定窗口、批次合并、去重、首次启用的基线、退回轮询。
- 自我触发：运行期间锁定、按授权归因的四种情况、原生执行后的全量丢弃、熔断。
- CEL：类型检查、自定义函数、解析与求值上限、恶意表达式。
- QuickJS：内存、时间与输出上限；`ctx` 之外没有宿主能力；`fetch` 的主机白名单与重定向；`fs` 越出授权的拒绝。
- 密钥：所有输出位置的脱敏；未声明的密钥不可见。
- 权限：权限范围编译成 `PineToolAccessPolicy` 与沙箱配置（独立 cwd、子目录授权、`allowedDomains`）；项目权限下调时暂停。
- 失败判定：§6.5 的各项条件与连续失败暂停。
- 工具 ID 注册表的不变量；定义 schema 与版本迁移。

集成验证：新增 `bun run verify:automation`，与 `verify:pi` 一样用 mock provider 真跑。至少覆盖两条完整链路：

1. 文件夹触发：放入文件 → 产生事件 → agent 调用工具 → `automation_report` → 生成运行记录和通知事件。
2. 脚本触发：脚本访问本地 mock HTTP 服务并使用密钥 → 事件进入 payload → 断言会话记录与运行记录中没有密钥原值。

沙箱实测：沿用现有真实沙箱测试的方式，验证按运行收窄的策略在 macOS 上拒绝范围外的写入；Windows 上用 `PINE_SANDBOX_PERF=1` 记录自动化与交互式会话交替时的快照切换开销。

桌面端手动验证：睡眠恢复后补跑、后台保持运行关闭时的提示、远程控制中批准卡片只读。

## 12. 以后的扩展

- **常驻监听器**：WebSocket、IMAP IDLE 等长连接来源，需要单独处理进程生命周期、断线重连与睡眠恢复。
- **更多凭据形式**：OAuth 刷新、Cookie 会话；在交互式会话中使用密钥。
- **MCP 事件源**：轮询 MCP 工具的结果，把差异作为事件，用于邮件、日历等来源。
- **独立的自动化 agent 进程**：根据崩溃数据决定是否把自动化与交互式会话的故障边界分开。
- **陪跑生成权限**：第一次运行有人值守，从实际调用记录推导 `PermissionEnvelope`，以修改的形式提交批准。
- **从对话生成**：在已完成的对话上提供“每周做一次”，由 agent 提炼参数并生成定义。
- **全局自动化与自动化之间的链式触发。**

## 13. 第一阶段实现决定

原待决问题的处理：

1. `session: "continue"` 不进入 v1，定义只接受 `"new"`。需要延续时，直接在该次运行的会话里继续发消息，它随之转为普通会话。
2. agent 发起的删除、启用都要在本机批准卡片上确认；用户在管理界面里直接删除用确认对话框，启停用开关。
3. 不做跨端提示。无头服务端没有本机批准入口，见下一条，实际上无法在服务端新建自动化。
4. 批准、启用、删除和密钥编辑只接受桌面窗口（`source === "desktop"`）的请求；浏览器与经配对设备的请求返回明确错误，卡片只读。服务端终端确认留到以后。
5. 产出物只按大小与修改时间快照判断是否变化，运行记录列出变化的文件，不做差异视图。
6. 脚本运行环境用 QuickJS（`quickjs-emscripten-core` + 单文件同步 release 变体）。
7. 短于 6 个字符的密钥值不脱敏，密钥设置界面会提示。
8. 脚本不读取办公文件内容。
9. XML（`fast-xml-parser`）与 CSV 解析在宿主侧执行，限 5 MiB，解析错误作为脚本内的异常抛出。
10. Windows 上同时只运行 1 个自动化（其他平台 2 个），shell 仍按运行权限收窄；脚本轮询全平台最多 4 个并发。
11. 无项目自动化：允许建在内置的临时工作区上，文件授权只能指向它的工作区文件夹。

其他实现中确定的做法：

- MCP：`action.permissions.mcp` 按服务器列出可调用的工具名。运行只加载这些服务器（程序化配置，关闭 install、自动 OAuth、sampling、elicitation 与 Jev），未列出的工具调用一律拒绝，列出的调用与交互式 autonomous 一样由审批模型审查。批准卡片标注这些服务器不受沙箱限制。
- 删除 `maxTokensPerRun` 与按时间窗的自我触发熔断；上限只保留时长与 `maxRunsPerDay`（默认 100）。达到每日上限时当天后续触发被跳过并只通知一次，不暂停。
- payload 以隐藏的自定义消息送入会话，不作为用户指令；系统提示说明其来源不可信。
- 批准卡片上的说明由批准模型在校验通过后生成（不超过 120 词，按界面语言），生成失败时省略；卡片上的事实列表才是权威内容。
- 当前回合读取过 `web_fetch`、`web_search` 或 MCP 结果时，批准卡片显示“读取外部内容后提出”警告。
- 脚本触发器的 dry run（`automation_check`）在非 YOLO 模式下走特权调用审查。
- 批准在 30 分钟后过期，或在发起它的会话回合结束时失效。
- 失败与暂停总是通知，不受 `delivery.notify` 影响。
- 运行后锁定与基线对账只对文件夹和脚本触发器生效；连续失败 5 次暂停。
- 模型：定义不写 `action.model` 时，新建的自动化记录创建它的会话当时的模型与思考强度，更新沿用原有模型。只有用户明确要求时才指定模型，agent 用 `ui_list_models` 查看当前模型、用户默认模型与所有可用模型的元数据。`thinkingLevel` 可选，缺省时用用户的默认思考强度；不支持的强度按模型能力回落。
- 系统事件支持 `app-start`、`resume`、`unlock`、`idle`（每 60 秒检查一次空闲时间）。
- 实时查看即运行详情视图，收到变更事件时刷新。
