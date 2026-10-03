# 模块：后端平台

> 状态：✅ MVP 已实现
> 最近更新：2026-09-29

## 摘要
后端平台提供单机 MVP 的数据、认证、权限、REST API、审计和运行入口。使用 Node.js 26 + TypeScript + Express + SQLite，所有业务模块共享统一数据库、Bearer Session 和审计函数。

## 范围
- 用户、项目、模块、契约、规则、事件、影响、联调、修复和审计存储；
- 管理员初始化、scrypt 密码、登录/登出、角色权限；
- Dashboard、Graph、Modules、Rules、Users、Audit、Runs、Repairs、Integrations API；
- 静态前端托管和健康检查。

## 关键文件
- `src/server/config.ts`：环境变量和路径；
- `src/server/db.ts`：SQLite schema、查询、事务基础和审计；
- `src/server/auth.ts`：密码、内存 Session、RBAC；
- `src/server/routes.ts`：全部 REST API；
- `src/server/seed.ts`：管理员、示例项目、模块、契约和规则；
- `src/server/index.ts`：Express 入口。

## 关键接口
- 认证与总览：`POST /api/login`、`POST /api/logout`、`GET /api/me`、`GET /api/dashboard`、`GET /api/graph`
- 模块/契约/规则/用户：`GET/POST/PATCH /api/modules`、`GET/POST /api/contracts`、`GET/POST/PATCH /api/rules`、`GET/POST/PATCH/DELETE /api/users/:id`、`GET/PATCH /api/project`
- 事件与影响：`GET /api/events/:id`、`POST /api/impacts/:id/ack`、`POST /api/notifications/:id/ack`
- 提交与仓库图谱（3D 全景数据源）：`GET /api/commits`、`GET /api/commits/:sha`、`GET /api/repo/graph`、`GET /api/reasons`
- PR 数据：`GET /api/pulls`、`GET /api/pulls/graph`、`GET /api/pulls/:number`、`POST /api/gitee/sync-pulls`
- 归属运营：`GET /api/repo/pattern-health`、`GET/POST /api/repo/pattern-fix`（admin）、`GET /api/repo/rfc-contracts`、`POST /api/repo/rfc-sync`（admin）
- 联调与修复：`GET/POST /api/runs`、`POST /api/modules/:id/integrate`、`GET/POST /api/repairs`、`POST /api/repairs/:id/{test,approve,create-pr}`、`GET /api/repairs/:id/bundle`
- 接入：`GET /api/integrations`、`GET/PATCH /api/settings`（admin）、`POST /api/integrations/{gitee,feishu}/test`、`POST /api/gitee/sync`、`GET /api/gitee/status`、`GET /api/webhooks/deliveries`、`POST /api/webhooks/gitee`（唯一免鉴权业务端点，走验签）
- 管理：`GET /api/audit`、`POST /api/admin/cleanup-misleading-data`、`POST /api/admin/reanalyze`、`POST /api/admin/backfill-pull-head`（后两者 202 受理后后台执行）

写操作普遍要求 admin/maintainer（规则、模块）或 admin（用户、设置、模式修复），runs/repairs 的执行类操作允许 developer 以上，observer 全程只读；403 文案为中文。

## 设计决策
- SQLite 足以支撑单机 MVP；数据库文件位于 `data/giteehelper.db`，共 16 张表。除核心业务表外，2026-09-28 起新增：`commits`（提交粒度，`(project_id, sha)` 唯一保证幂等）、`webhook_deliveries`（投递日志）、`pull_requests`（含 `remote_id` 反查与 `files_json`）、`pull_references`（`!NN` 互引）、`repo_state`、`rfc_contracts`（契约即代码）。
- Session 当前存于进程内存，重启后需重新登录；创建会话时会顺带清理过期条目。生产化前应迁移到持久化 Session。
- `PATCH /api/users/:id` 与 DELETE 共享同一条底线：不能降级或停用最后一个可用管理员；role 校验白名单，非法值返回 400 而不是 SQLite CHECK 报 500。
- Secret Store 的加密密钥由 `SESSION_SECRET` 派生。使用默认值时启动会打警告（拿到数据库文件即可解密）；`SESSION_SECRET` 变更后旧密文解不开时逐项跳过并提示重新保存，不再让服务启动崩溃。
- 管理员密码可由 `ADMIN_PASSWORD` 在启动时重置；未配置该变量时不再写入固定默认口令，而是生成随机密码并仅在控制台打印一次。
- 所有用户、规则、模块和修复操作写审计，外部写操作单独记录。
- 环境变量：`PORT`、`DATABASE_PATH`、`GITEE_*`、`FEISHU_WEBHOOK_URL`、`ADMIN_USERNAME/PASSWORD`、`SESSION_SECRET`、`LLM_API_BASE/LLM_API_KEY/LLM_MODEL`（可选，OpenAI 兼容大模型，用于通知概要）、`PUBLIC_BASE_URL`（当前通知不使用，保留备用）；Web 端保存的同名配置存 Secret Store 并覆盖 `.env`（LLM 三项暂只能走 `.env`）。

## 验证
- `npm run typecheck` 通过；
- `npm test` 73 项通过（`tests/` 下 14 个测试文件）；测试使用独立数据库 `data/test/giteehelper-test.db`，由 `pretest` 脚本先重置，因此不会触碰 `data/giteehelper.db`；
- `/api/health`、`/api/login`、`/api/dashboard`、`/api/graph` 冒烟通过；
- 未认证访问业务 API 返回 401；
- 误导性联调记录和 `[旧导入]` 数据可通过管理员清理接口或 CLI 删除。

## Bug 与问题记录

### BUG-001 SQLite 不支持并行测试进程的可选参数绑定/写锁（2026-09-25，已解决）
- 错误行为：WHEN 多个 Node Test 文件并行打开 SQLite THEN 初始化可能出现 `database is locked`。
- 期望行为：WHEN 测试文件共享本地数据库 THEN 系统 SHALL 在超时内串行完成写入。
- 不可破坏的行为：WHEN 业务请求并发 THEN 系统 SHALL CONTINUE TO 使用 WAL 和外键约束。
- 根因：测试文件并行持有数据库写事务，SQLite 默认 busy timeout 不足。
- 解决方式：设置 `PRAGMA busy_timeout = 5000`，并以 `--test-concurrency=1` 运行测试。
- 验证方式：`npm test` 稳定通过（当前 73 项）。

## 已知限制
- 单项目、单组织、单进程 Session；
- 业务 API 尚未做分页和批量导入；
- 修复批准只记录授权，不直接执行外部写入。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-25 | 完成 schema、认证、RBAC、REST API、审计和种子数据 | 实施阶段 1 |
| 2026-09-25 | 修复 SQLite 并行测试锁冲突 | BUG-001 |
| 2026-09-27 | 增加用户负责模块汇总和用户删除接口 | 用户与身份 |
| 2026-09-27 | 增加误导运行和旧导入数据清理接口 | 数据清理 |
| 2026-09-28 | 新增 commits/webhook_deliveries/pull_requests/pull_references/rfc_contracts 表及对应 API；补齐 runs/integrate/repairs 角色校验 | 仓库全景、PR 依赖图、权限一致性 |
| 2026-09-29 | `PATCH /api/users/:id` 禁止降级/停用最后一个管理员并校验 role 白名单；`/api/admin/reanalyze` 改 202 受理后台执行；Session 创建时清理过期条目；SESSION_SECRET 默认值警告与解密失败降级；删除未用的 `author_email_key` 列 | 管理安全、健壮性 |
| 2026-09-29 | 新增 `POST /api/admin/backfill-pull-head`，重算历史 PR 事件的提交者身份 | 通知身份修复 |
| 2026-09-29 | 新增可选大模型配置（`LLM_API_BASE/KEY/MODEL`），飞书卡片接「概要」；`PUBLIC_BASE_URL` 通知侧不再使用 | 通知可读性 |
| 2026-09-29 | 文档同步 API 清单与测试数（60 项 / 12 文件） | 文档同步 |
