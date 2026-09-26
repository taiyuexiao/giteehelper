# 模块：Gitee 与飞书接入

> 状态：✅ Web 配置与代码完成；真实 Gitee 已验证，飞书待测试群配置
> 最近更新：2026-09-26

## 摘要
接入层负责 Gitee Open API、WebHook 事件、PR 评论、修复 PR 和飞书通知。Gitee Token 只从 `.env` 读取，WebHook 支持明文 Secret 和 HMAC-SHA256 验签；飞书未配置时执行 dry-run 并写审计。

## 关键文件
- `src/server/gitee.ts`
- `src/server/feishu.ts`
- `src/server/routes.ts` 中 `/api/webhooks/gitee`、`/api/gitee/*`、`/api/integrations/*`

## Gitee 能力
- `GET /user` 连接测试；
- 拉取最近 PR 用于 `/api/gitee/sync`；
- WebHook 接收 Push、PR、Note、Issue；
- 事件统一化后进入影响分析；
- 影响生成后创建最小联调 Run；
- 可回写 PR 摘要评论；
- 修复批准后可创建修复分支和 PR，默认不自动执行。

## 飞书能力
- 自定义机器人 Webhook 文本卡片；
- 未配置时 `feishu_dry_run`；
- 后续可替换为企业自建应用，支持私聊和交互卡片。

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
- Gitee Check 以 PR 摘要评论作为 MVP 反馈面。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成 Gitee API、WebHook、同步、PR 评论、修复 PR 接口和飞书通知 | 实施阶段 2、3、6 |
| 2026-09-26 | 将 Gitee/飞书配置改为 Web 可编辑，并使用加密 Secret Store | 接入配置 |
