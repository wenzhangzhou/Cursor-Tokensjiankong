# Cursor 用量工作台

本机页面，用来看 Cursor 账单用量，并按**对话标题 / Agent 标题**归到任务。不挂在别的工作台里。

## 如何启动

1. 安装并登录 Cursor（本机需要已有会话）。
2. 双击 `启动工作台.bat`，或在此目录执行：

```bat
"C:\Program Files\nodejs\node.exe" server.js
```

3. 浏览器打开 http://127.0.0.1:3790/ （只监听本机，不绑 `0.0.0.0`）。
4. 点击「同步用量」。

Node 使用 `C:\Program Files\nodejs\node.exe`。读 SQLite 用 Node 自带的 `node:sqlite`，没有原生编译依赖。

## 数据从哪来

两层，都只留在本目录 `data/`：

1. **账单层（准）**  
   只读 `%APPDATA%\Cursor\User\globalStorage\state.vscdb` 的 `cursorAuth/accessToken`。  
   用它拼 `WorkosCursorSessionToken`，请求 Cursor 自己的仪表盘接口（`/api/auth/me`、`/api/usage`、`get-aggregated-usage-events`、`get-filtered-usage-events`）。  
   结果写入 `data/usage-events.json`。Token 不落盘、不发给第三方。

2. **任务层（细）**  
   任务 = Cursor 对话标题。标题来自同一数据库里的 `composerHeaders.name`。  
   没有标题时显示「未命名会话」。  
   另外在用户级 `~\.cursor\hooks.json` 增加了 `stop` 和 `sessionEnd`，调用 `hooks/record-task.js`，把时间、工作区、标题（查得到才有）和 payload 里若存在的 tokens 追加到 `data/task-events.jsonl`。  
   账单事件如果带有 `conversationId`，优先对上本机同 id 的对话标题。对不上时，再按对话的创建时间到最后更新时间对齐；多个窗口重叠时，取得更短的那条。

## 局限

- 用量接口是社区验证过的**非官方**接口，Cursor 随时可能改。失败时页面只显示原因（未登录、HTTP 状态、字段对不上），**不会编造数字**。
- `crsr_…` User API Key 不能用来拉用量。
- 标题对齐不是 100%。事件里没有 `conversationId` 时只能靠时间窗，并行对话会偶发归错。有 id 但本机已经删掉该对话时，仍会显示「未命名会话」。
- hooks 里的 token 字段目前经常是空的，任务上的 token / 费用以账单明细为准，避免和 hooks 重复相加。
- 改完 hooks 后，已经打开的 Cursor 需要重载窗口或重启，之后的会话结束才会写 `task-events.jsonl`。
