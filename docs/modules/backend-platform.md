# 模块：后端平台

> 状态：✅ MVP 已实现
> 最近更新：2026-09-26

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
- `POST /api/login`、`POST /api/logout`、`GET /api/me`
- `GET /api/dashboard`、`GET /api/graph`
- `GET/POST/PATCH /api/modules`
- `GET/POST/PATCH /api/rules`
- `GET/POST/PATCH /api/users`
- `GET /api/audit`
- `GET/POST /api/runs`
- `GET/POST /api/repairs`
- `GET/PATCH /api/project`
- `GET/POST /api/contracts`

## 设计决策
- SQLite 足以支撑单机 MVP；数据库文件位于 `data/giteehelper.db`。
- Session 当前存于进程内存，重启后需重新登录；生产化前应迁移到持久化 Session。
- 管理员密码由 `ADMIN_PASSWORD` 重置；未配置时使用本地开发默认值。
- 所有用户、规则、模块和修复操作写审计，外部写操作单独记录。

## 验证
- `npm run typecheck` 通过；
- `npm test` 8 项通过；
- `/api/health`、`/api/login`、`/api/dashboard`、`/api/graph` 冒烟通过；
- 未认证访问业务 API 返回 401。

## Bug 与问题记录

### BUG-001 SQLite 不支持并行测试进程的可选参数绑定/写锁（2026-09-25，已解决）
- 错误行为：WHEN 多个 Node Test 文件并行打开 SQLite THEN 初始化可能出现 `database is locked`。
- 期望行为：WHEN 测试文件共享本地数据库 THEN 系统 SHALL 在超时内串行完成写入。
- 不可破坏的行为：WHEN 业务请求并发 THEN 系统 SHALL CONTINUE TO 使用 WAL 和外键约束。
- 根因：测试文件并行持有数据库写事务，SQLite 默认 busy timeout 不足。
- 解决方式：设置 `PRAGMA busy_timeout = 5000`，并以 `--test-concurrency=1` 运行测试。
- 验证方式：`npm test` 8 项稳定通过。

## 已知限制
- 单项目、单组织、单进程 Session；
- 业务 API 尚未做分页和批量导入；
- 修复批准只记录授权，不直接执行外部写入。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-25 | 完成 schema、认证、RBAC、REST API、审计和种子数据 | 实施阶段 1 |
| 2026-09-25 | 修复 SQLite 并行测试锁冲突 | BUG-001 |
