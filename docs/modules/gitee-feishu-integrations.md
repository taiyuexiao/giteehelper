# 模块：Gitee 与飞书接入

> 状态：✅ Web 配置与代码完成；真实 Gitee 已验证，飞书待测试群配置
> 最近更新：2026-09-28

## 摘要
接入层负责 Gitee Open API、WebHook 事件、提交同步、修复 PR 和飞书通知；不自动回写 Gitee PR 评论。Gitee Token 从 `.env` 或服务器端 Secret Store 读取，WebHook 支持明文 Secret 和 HMAC-SHA256 验签；飞书未配置时执行 dry-run 并写审计。

WebHook 是实时分析的唯一入口：验签通过后立即返回 202，分析在后台完成，避免 Gitee 因回调超时重复投递。

## 关键文件
- `src/server/gitee.ts`
- `src/server/feishu.ts`
- `src/server/ingest.ts`（WebHook 处理链：事件 → 提交 → 影响 → 联调 → 通知）
- `src/server/commits.ts`（提交入库、语义解析、冲突判定、投递日志）
- `src/server/routes.ts` 中 `/api/webhooks/gitee`、`/api/gitee/*`、`/api/commits`、`/api/repo/graph`、`/api/integrations/*`

## Gitee 能力
- `GET /user` 连接测试；
- 拉取最近 PR 用于 `/api/gitee/sync`；
- WebHook 接收 Push、PR、Note、Issue；
- Push 事件直接从负载的 `commits[]` 取出提交，无需回查 API，逐条进入影响分析；
- 提交信息被解析为「处理了什么问题」：约定式提交类型、scope、正文中的问题描述、`#123`/`WS-2283` 需求编号；
- 事件统一化后进入影响分析；
- 影响生成后创建最小联调 Run（Push 事件只为冲突模块创建，单次最多 5 条）；
- 影响摘要只发送到飞书；Gitee PR 不回写评论；
- `/api/gitee/sync` 支持 `only=pulls|commits|all`，用于首次建图与断档回填（提交明细补齐有 20 次调用上限）；
- 修复批准后可创建修复分支和 PR，默认不自动执行。

## 飞书能力
- 自定义机器人 Webhook 文本卡片；
- 未配置时 `feishu_dry_run`；
- 统一使用 `buildCommitImpactCard()`：**提交者（姓名 + 邮箱）、提交内容、可点击链接、按负责人分组的影响清单**。每一次推送都会广播，让群里持续看到"谁提交了什么、影响了谁"，冲突项用 ⚠ 标出；
- **提交者身份以提交里的邮箱为准**：仓库存在多人共用一个 Gitee 账号的情况，账号名没有区分度；邮箱是唯一可靠身份（与 `.githooks/contributors.tsv` 的口径一致）；
- 消息里的链接需要 `PUBLIC_BASE_URL` 配置（例如 `http://your-host/giteehelper`），未配置时省略链接；
- **冲突提醒按对象发送**：只有 `blocking` / `contract` 级影响才发消息，并直接给出模块、严重度和负责人，例如 `产品需求与规范｜阻塞｜负责人 张三 → 更新模块设计并确认验收条件`；无冲突的提交只入库与审计，不打扰群；
- 消息长度上限 1200 字符，超出按提交与模块截断；
- 后续可替换为企业自建应用，支持私聊和交互卡片。

## PR 事件的补充查询
Gitee 的 PR 回调**不带变更文件清单**，只能拿 PR 标题/正文去猜影响谁——长正文（整篇 RFC）会凑出大量假影响，实测一个 docs PR 命中 20 个工作项。因此 PR 事件到达时会回查两个接口：

- `GET /repos/{owner}/{repo}/pulls/{number}/files` → 真实变更文件，用于**按路径归属模块**
- `GET /repos/{owner}/{repo}/pulls/{number}/commits` → 取最新提交的邮箱作为提交者身份

任何一步失败都不阻断主流程，只是退回语义匹配。

## 投递可观测性
`webhook_deliveries` 记录每次回调：钩子名、事件类型、动作、状态（`processing` / `processed` / `rejected` / `error`）、提交数、影响数、冲突数与说明。被拒绝的投递也会写入原因，因此「事件到底有没有到」不再需要翻服务器日志。

- `GET /api/webhooks/deliveries` 查询最近 20 条；
- `GET /api/integrations` 返回最近 10 条与提交统计，接入设置页直接展示成表格；
- 回调地址：`{服务地址}/api/webhooks/gitee`。

## 真实验证
- Gitee Token 验证通过，只读用户为 `mortisspl`；
- 目标仓库连接验证通过：`shanghai-bank_1/agent-evaluation-platform`；
- `/api/gitee/sync` 成功读取最近 20 个 PR；
- 本地构造 Gitee WebHook 成功生成事件、影响和联调 Run；
- 飞书未提供测试 Webhook，仅验证 dry-run 路径。

## Web 配置
“接入设置”支持编辑以下配置，并通过 `PATCH /api/settings` 保存：

- `GITEE_API_BASE`
- `GITEE_TOKEN`
- `GITEE_WEBHOOK_SECRET`
- `GITEE_REPO`
- `GITEE_DEFAULT_BRANCH`
- `FEISHU_WEBHOOK_URL`

Token、WebHook Secret 和飞书 Webhook 使用服务器端 Secret Store；界面只显示“已配置/未配置”，不回显原值。留空提交表示保持不变。

## 安全
- `.env` 已加入 `.gitignore`；
- Gitee 账号密码未使用、未保存；
- Token 不进入日志、API 响应、文档或前端；
- WebHook 未通过验签返回 401；
- 外部 PR 创建只允许修复批准后触发。

## 已知限制
- 未在 Gitee 真实仓库创建 WebHook，因为本地服务没有公网回调地址；
- 飞书当前只支持群 Webhook 文本消息；
- 影响反馈以飞书精简摘要和 GiteeHelper 证据链为唯一出口。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成 Gitee API、WebHook、同步、修复 PR 接口和飞书通知 | 实施阶段 2、3、6 |
| 2026-09-28 | 禁止自动回写 PR 评论，并将飞书消息压缩为模块级摘要 | 通知降噪 |
| 2026-09-26 | 将 Gitee/飞书配置改为 Web 可编辑，并使用加密 Secret Store | 接入配置 |
| 2026-09-28 | WebHook 改为快速确认 + 后台分析，并记录投递日志用于排错 | 实时性与可观测性 |
| 2026-09-28 | 新增提交级同步与冲突飞书提醒（含负责人与下一步） | 仓库全景与实时分析 |
| 2026-09-28 | 验签改为常量时间比较，分支名统一去掉 refs/heads/ 前缀 | 安全与展示 |
| 2026-09-28 | 事件标识改用被改动实体（PR id + head sha / note id / issue id / push after），修复用 hook_id 导致同类事件被静默去重 | 事件不丢失 |
| 2026-09-28 | 通知改为"提交者邮箱 + 链接 + 按负责人分组"，每次推送都广播；PR 事件回查真实文件列表改用路径归属；契约判定排除测试文件 | 通知可读性与准确性 |
