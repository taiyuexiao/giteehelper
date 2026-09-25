# 模块：开发准备

> 状态：✅ 已完成
> 最近更新：2026-09-25

## 摘要
开发准备阶段已完成：产品、技术和实施文档已定稿；工程已具备 Node.js 26 + TypeScript + React/Vite + SQLite 的可运行骨架、依赖管理、数据模型基础、认证基础、示例数据、CLI Doctor、测试与生产构建流程。真实 Gitee/飞书连接和产品功能实现均等待下一道开发指令。

## 动机
在进入功能开发前，先固定技术基线、目录约定、质量门禁和凭据边界，避免实现过程中反复更换框架、遗漏测试或将敏感凭据写入仓库。

## 范围与非范围
- 范围内：工程骨架、依赖、配置、数据库、认证基础、示例模型、基础服务、测试、构建、CLI Doctor、开发文档。
- 不包括：完整 API、完整 GUI、真实 Gitee WebHook、飞书发送、影响分析 UI、增量联调 UI、修复 PR。
- 明确不保存 Gitee 账号密码；只预留 Private Access Token 配置位。

## 上下游依赖
- 上游：产品规格、技术设计、实施计划、Node.js 26、npm registry、SQLite。
- 下游：功能 API、Gitee 适配器、飞书适配器、完整 React 控制台、联调引擎、修复工作流。

## 关键接口与运行时信息
### 命令
```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run cli -- doctor
```

### 运行地址
- Vite Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`
- 健康检查：`GET /api/health`
- 准备状态：`GET /api/preparation`
- 若本机 8787 被占用，使用 `PORT=8876 npm run dev:server`。

### 已准备目录
```text
src/server/       服务端、数据库、认证、Gitee/飞书/影响/联调/修复基础模块
src/shared/       前后端共享类型
src/client/       React/Vite 基础界面
src/cli/          CLI Doctor
tests/            Node Test 冒烟测试
docs/modules/     产品、技术、实施和开发准备文档
```

### 数据与配置
- SQLite：`data/giteehelper.db`
- 环境变量模板：`.env.example`
- 真实凭据：仅放 `.env`，已加入 `.gitignore`
- 当前未创建 `.env`，未使用用户提供的真实凭据发起外部请求。

## 已完成的准备项
| 项目 | 状态 | 验证 |
|---|---|---|
| Node.js 26 / npm 依赖 | ✅ | `npm install` 成功 |
| TypeScript 严格检查 | ✅ | `npm run typecheck` 通过 |
| React/Vite 客户端构建 | ✅ | `npm run build:client` 通过 |
| Node 服务端构建 | ✅ | `npm run build:server` 通过 |
| SQLite schema | ✅ | 健康检查与准备接口返回数据 |
| 示例项目/模块/契约/规则 | ✅ | `GET /api/preparation` 显示 4 users、4 modules、3 rules |
| 密码加密与校验 | ✅ | Node Test 通过 |
| CLI Doctor | ✅ | 只显示配置状态，不输出秘密 |
| 开发服务器冒烟 | ✅ | `/api/health`、`/api/preparation`、`/` 均返回 200 |
| Git 忽略规则 | ✅ | `.env`、数据库、`dist`、`node_modules` 被忽略 |

## 安全约定
1. Gitee 只使用 Private Access Token，不使用账号密码。
2. Token、WebHook Secret、飞书 Webhook 不进入源码、文档、日志或 Git。
3. `.env.example` 只含空配置位。
4. Doctor 对凭据只显示“已配置/未配置”。
5. 未完成产品接入前，不主动连接真实 Gitee/飞书。

## 编码约定
- 后端使用 ESM TypeScript；共享类型放在 `src/shared`。
- SQLite 字段使用 snake_case；TypeScript 对象使用 camelCase，由查询别名转换。
- 外部副作用必须写审计记录。
- 自动修复不得直接写主干。
- 每完成一个功能模块，同轮更新 `PROJECT.md` 和对应模块文档。

## Bug 与问题记录

### BUG-001 SQLite 无法绑定可选字段 `undefined`（2026-09-25，已解决）
- 错误行为：WHEN 初始化示例模块且 `testCommand` 未提供 THEN 系统在第 10 个参数绑定时抛出 `ERR_INVALID_ARG_TYPE`。
- 期望行为：WHEN 可选字段未提供 THEN 系统 SHALL 使用空字符串或 `NULL` 完成初始化。
- 不可破坏的行为：WHEN 模块已存在 THEN 系统 SHALL CONTINUE TO 幂等跳过，不重复创建项目、用户、模块、契约或规则。
- 根因：Node SQLite 不接受 JavaScript `undefined` 作为绑定参数。
- 解决方式：在 `src/server/seed.ts` 中将 `testCommand`、`description` 显式转换为 `""`。
- 验证方式：`npm test` 中“development seed creates models and example project data”通过，并可重复运行。

### BUG-002 Express 5 不接受通配路由 `*`（2026-09-25，已解决）
- 错误行为：WHEN 启动生产服务并启用静态前端回退 THEN Express 5 在 `app.get("*")` 处抛出 `PathError`，服务退出。
- 期望行为：WHEN 请求非 API 路径 THEN 系统 SHALL 返回前端 `index.html`，服务保持运行。
- 不可破坏的行为：WHEN `/api/health` 或 `/api/preparation` 被请求 THEN 系统 SHALL CONTINUE TO 返回 JSON，不被前端回退覆盖。
- 根因：Express 5 使用新版 `path-to-regexp`，不再接受裸 `*` 路由。
- 解决方式：在 `src/server/index.ts` 中改用静态资源后的 catch-all middleware。
- 验证方式：使用 `PORT=8876 node dist/server/index.js`，三个请求均成功，服务日志正常。

## 已知限制与待办
- [ ] 默认端口 8787 可能被本机其他服务占用；开发脚本需按需设置 `PORT`。
- [ ] 当前 `src/server` 中的业务模块只是开发基础，不代表功能已经完成。
- [ ] 完整 API、GUI、Gitee/飞书真实接入、联调与修复功能等待开发指令。
- [ ] `.env` 尚未创建；接入测试前由开发流程安全写入，不得粘贴到日志。
- [ ] 生产部署前需替换默认管理员密码和 Session Secret。

## 变更历史
| 日期 | 变更 | 关联需求 / bug |
|---|---|---|
| 2026-09-25 | 完成工程骨架、依赖、数据/认证基础、测试、构建、CLI Doctor 和冒烟验证 | 开发准备 |
| 2026-09-25 | 修复 SQLite 可选参数绑定和 Express 5 回退路由问题 | BUG-001、BUG-002 |
