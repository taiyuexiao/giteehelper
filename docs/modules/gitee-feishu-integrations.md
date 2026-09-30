# 模块：Gitee 与飞书接入

> 状态：✅ Web 配置与代码完成；Gitee WebHook 与飞书群卡片已在生产部署上跑真实事件
> 最近更新：2026-09-29

## 摘要
接入层负责 Gitee Open API、WebHook 事件、提交/PR 数据同步、修复 PR 和飞书通知；不自动回写 Gitee PR 评论。Gitee Token 从 `.env` 或服务器端 Secret Store 读取，WebHook 支持明文 Secret 和 HMAC-SHA256 验签（常量时间比较）；飞书未配置时执行 dry-run 并写审计。

WebHook 是实时分析的唯一入口：验签通过后立即返回 202，分析在后台完成，避免 Gitee 因回调超时重复投递。

## 关键文件
- `src/server/gitee.ts`（API 封装、事件统一化、提交提取、head 定位）
- `src/server/feishu.ts`（`buildCommitImpactCard()` 卡片格式）
- `src/server/ingest.ts`（WebHook 处理链：事件 → 提交 → 影响 → 联调 → 通知）
- `src/server/commits.ts`（提交入库、语义解析、冲突判定、投递日志）
- `src/server/pulls.ts`（PR 同步、引用挖掘、文件回填）
- `src/server/routes.ts` 中 `/api/webhooks/gitee`、`/api/webhooks/deliveries`、`/api/gitee/*`、`/api/pulls*`、`/api/commits*`、`/api/repo/graph`、`/api/integrations/*`

## Gitee 能力
- `GET /user` 连接测试；
- WebHook 接收 Push、PR、Note、Issue；Push 事件直接从负载 `commits[]` 取提交，无需回查 API；
- `/api/gitee/sync`（`only=pulls|commits|all`）：首次建图与断档回填，提交明细补齐有 20 次调用上限；
- `sync-pulls` / `POST /api/gitee/sync-pulls`：分页拉取全部 PR 建立依赖图（见影响模块的「PR 级依赖图」）；
- 事件统一化后进入影响分析，影响生成后创建最小联调 Run（Push 只为冲突模块创建，单次最多 5 条）；
- 影响摘要只发飞书；Gitee PR 不回写评论；
- 修复批准后可创建修复分支和 PR，默认不自动执行。

### 事件唯一标识
`source_id` 来自**被改动的实体**而非 `hook_id`（hook_id 是常量，会导致同类事件从第二条起被静默去重）：PR 用 `pull-<id>@<head sha 前 12 位>`（同一 PR 的新提交形成新事件）、note 用 `note-<id>`、issue 用 `issue-<id>`、push 用 `after` sha。

## PR 事件的补充查询（`enrichPullRequest`）
Gitee 的 PR 回调**不带变更文件清单**，只能拿 PR 标题/正文去猜影响谁——长正文会凑出大量假影响（实测一个 docs PR 命中 20 个工作项）。因此 PR 事件到达时回查：

- `GET /pulls/{number}/files` → 真实变更文件，改用**按路径归属模块**；
- `GET /pulls/{number}/commits` → 定位本次推进的提交，拿提交者邮箱。

**head 定位陷阱（2026-09-29 修复）**：`/pulls/{n}/commits` 是**新提交在前**且会分页，取 `at(-1)` 拿到的是最老提交（实测 PR !309 的一次 update 被写成"提交者 Yuan Yitang"，真实新提交作者是另一个人、时间差一天）。`pickHeadCommit()` 优先按 PR head sha 精确定位，拿不到 head sha 才按提交时间取最新，绝不按列表位置猜。

**历史数据修正**：该修复只对新事件生效，已落库 payload 里的 `pullHead` 还是错的（控制台回看旧事件时身份不对）。用 `backfill-pull-head` 重算：按事件 payload 里存的 head sha 精确匹配（拿不到才退回「事件时刻之前的最新提交」，都不行如实记 unresolved），默认只预览、`--apply` 才写库；PR 的「分支」也按 payload 里的源分支一并修正。

任何一步失败都不阻断主流程，只是退回语义匹配。历史事件缺文件用 `backfill-files` 回填（详见影响模块「归属三支柱」）。

## 飞书通知
- 自定义机器人 Webhook 文本卡片；未配置时 `feishu_dry_run`；
- 统一格式（`buildCommitImpactCard()`）：**首行标注事件类型**（`【GiteeHelper】新提交影响 - 「提交Commit」/「提交PR」/「评论」/「议题」`，未知类型标「其他」）、**概要**（大模型生成，未配置/失败时整行省略）、提交作者（姓名 + 邮箱）、推送账号、PR 作者、内容、可点击链接、分支，`-------` 分割线之后是按负责人分组的影响清单；每一次推送都广播（影响为空也照发），让群里持续看到"谁提交了什么、影响了谁"；
- **三种身份分开写，缺一不可**（Gitee 账号常被多人共用）：
  - **提交作者**：提交里的邮箱是唯一可靠身份，与 `.githooks/contributors.tsv` 口径一致；只写账号会让人以为是他写的；
  - **推送账号**（sender）：谁按下的推送/更新；只写作者又追不到是谁推的；
  - **PR 作者**：谁开的这个 PR——往往既不是提交作者也不是推送账号，找人对齐时他是第一联系人（与提交作者不同才额外列出）；
- **PR 事件的「分支」显示源分支**（head ref），不再显示目标分支 main，避免让人以为直接推了主干；
- **依据分档**：卡片头部写明「N 项有文件路径证据（确定），M 项仅语义匹配（线索）」；线索条目标「（线索）」且不挂 ⚠；只有 **grounded（有路径证据）的契约/阻塞级**才算「需确认」冲突；
- **主干前进**：Push 到 main 时若影响在飞 PR，卡片尾部列出它们（编号、标题、共同改动文件数）并提示需要合并同步后重跑门禁；
- 不输出控制台链接：提交/PR 链接是 Gitee 绝对地址，不依赖 `PUBLIC_BASE_URL`（该配置保留备用，当前通知不使用）；
- 消息上限 1400 字符，超出截断；
- 后续可升级企业自建应用，支持私聊和交互卡片。

### 行为概要（大模型，可选）
卡片头部的「概要：…」由大模型把标题/描述/变更文件总结成一句话（`src/server/summarize.ts`）。设计约束：

- **OpenAI 兼容接口**，三个环境变量：`LLM_API_BASE`（如 `https://open.bigmodel.cn/api/paas/v4`）、`LLM_API_KEY`、`LLM_MODEL`（默认 `glm-4-flash`）；只走 `.env`，接入设置页暂不支持编辑；
- **绝不因概要挂掉通知**：未配置、超时（25 秒）、限流、返回畸形，一律回退为不带概要行的卡片；
- **只影响后台延迟**：WebHook 已先回 202 给 Gitee，概要的等待发生在后台分析链路里；
- 提示词只喂元数据（标题、描述截断 1500 字、文件列表前 30 条、push 的提交主题前 10 条），不喂代码内容。

## 投递可观测性
`webhook_deliveries` 记录每次回调：钩子名、事件类型、动作、状态（`processing` / `processed` / `rejected` / `error`）、提交数、影响数、冲突数与说明。被拒绝的投递也写原因。

- `GET /api/webhooks/deliveries` 最近 20 条；`GET /api/integrations` 最近 10 条 + 提交统计；
- 回调地址：`{服务地址}/api/webhooks/gitee`。

## 真实验证
- Gitee Token 只读验证通过（用户 `mortisspl`），目标仓库 `shanghai-bank_1/agent-evaluation-platform`；
- 生产部署（Docker，2026-09-27 起）已接收真实 WebHook：2026-09-29 的两处通知身份修复（最老提交被当成提交者、提交作者与推送账号混淆）均来自真实回调数据；
- 本地构造 Gitee WebHook 可复现事件、影响和联调 Run 全链路；
- 飞书群卡片按真实事件发出；未配置的环境仍走 dry-run 审计。

## Web 配置
「接入设置」支持编辑 `GITEE_API_BASE` / `GITEE_TOKEN` / `GITEE_WEBHOOK_SECRET` / `GITEE_REPO` / `GITEE_DEFAULT_BRANCH` / `FEISHU_WEBHOOK_URL`，经 `PATCH /api/settings` 保存。敏感值存服务器端 Secret Store，界面只显示"已配置/未配置"，留空提交表示保持不变。

## 安全
- `.env` 已加入 `.gitignore`；Gitee 账号密码未使用、未保存；
- Token 不进入日志、API 响应、文档或前端；
- WebHook 未通过验签返回 401；验签比较为常量时间；
- 外部 PR 创建只允许修复批准后触发。

## 已知限制
- 飞书当前只支持群 Webhook 文本消息（无私聊、无交互卡片、无按角色私发）；
- 影响反馈以飞书卡片和 GiteeHelper 证据链为唯一出口；
- PR 回查按需发起，Gitee API 限流时段可能退回语义匹配。

## Bug 与问题记录

### BUG-001 Push 通知的依据分档完全失效（2026-09-29，已解决）
- 错误行为：WHEN Push 事件触发飞书影响卡片 THEN 卡片头部恒显示「0 项有文件路径证据（确定）」，即使提交带完整文件列表、影响有路径证据，也不显示「依据：文件」。
- 期望行为：WHEN 提交影响有路径证据 THEN 卡片 SHALL 写「确定」并列出具体文件；只有语义证据才标「（线索）」。
- 不可破坏的行为：WHEN 非 push 事件（PR/评论/Issue）走 `describeImpacts()` THEN 分档行为 SHALL CONTINUE TO 保持不变（该路径一直是好的）。
- 根因：「确定 vs 线索」修复（2026-09-28）只落在 `describeImpacts()`；Push 路径的 `ImpactLine` 从 `CommitAnalysis.affectedModules` 构造，`grounded`/`evidenceHint` 字段根本没被填充。Push 是最高频路径，等于分档在生产卡片上不可见。
- 解决方式：`ingestCommit()` 组装 `affectedModules` 时复用与 `describeImpacts` 相同的分档口径（新增共享的 `ownerNameOf`/`areaNameOf`），`ingest.ts` 把两个字段穿进 `ImpactLine`；新增回归测试「提交影响自带依据分档」锁住该行为。
- 验证方式：`npm test` 55 项通过，含新回归测试。

### BUG-002 联调 Run 无上限 + 明文验签分支（2026-09-29，已解决）
- 错误行为：WHEN 一条 PR 事件产生 20 条影响 THEN 自动创建 20 条联调 Run 把列表冲成单事件刷屏；WHEN 攻击者发送 `X-Gitee-Token` 等于 Secret 的请求 THEN `token === secret` 直接字符串比较，非常量时间。
- 期望行为：单事件自动创建的联调 Run 上限 5 条（与 Push 路径一致）；验签所有分支 SHALL 常量时间比较。
- 解决方式：非 push 路径按去重后的模块 id `slice(0, MAX_RUNS_PER_EVENT)`；`verifyGiteeSignature` 抽出 `safeEqual()` 统一使用。另把未知事件类型的 `source_id` 从随机 UUID 改为 payload 内容哈希，使重发投递能被唯一约束去重。
- 验证方式：typecheck + 全量测试通过。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成 Gitee API、WebHook、同步、修复 PR 接口和飞书通知 | 实施阶段 2、3、6 |
| 2026-09-26 | Gitee/飞书配置改为 Web 可编辑，使用加密 Secret Store | 接入配置 |
| 2026-09-28 | 禁止自动回写 PR 评论；WebHook 快速确认 + 后台分析 + 投递日志 | 通知降噪、实时性 |
| 2026-09-28 | 新增提交级同步与冲突飞书提醒（含负责人与下一步） | 仓库全景与实时分析 |
| 2026-09-28 | 事件标识改用被改动实体，修复 hook_id 常量导致的静默去重 | 事件不丢失 |
| 2026-09-28 | 通知改为"提交者邮箱 + 链接 + 按负责人分组"并每次推送广播；PR 事件回查真实文件；新增 `PUBLIC_BASE_URL` | 通知可读性 |
| 2026-09-28 | 新增 sync-pulls / pulls / backfill-files 与 `/api/pulls/graph` | PR 级依赖图 |
| 2026-09-28 | 通知按依据分档：确定列文件，线索只标注计数 | 通知可信度 |
| 2026-09-29 | 修复提交者定位：按 PR head sha（回退按时间取最新），不再按列表位置取最老提交 | 通知准确性 |
| 2026-09-29 | 卡片区分「提交作者 / 推送账号 / PR 作者」三种身份；PR 分支显示源分支 | 通知准确性 |
| 2026-09-29 | Push 通知补齐依据分档（确定/线索）与证据文件；`/api/gitee/sync` 的 PR 事件复用 pull_requests 文件缓存；联调 Run 单事件限额 5；验签常量时间 | BUG-001、BUG-002 |
| 2026-09-29 | 新增 `backfill-pull-head`：按事件当时的 head sha 重算历史 PR 事件的提交者身份（预览/`--apply`） | 历史数据修正 |
| 2026-09-29 | 卡片格式优化：首行标注事件类型、头部与影响清单用 `-------` 分隔、移除控制台链接；新增大模型「概要」（OpenAI 兼容，未配置/失败回退，只影响后台延迟） | 通知可读性 |
