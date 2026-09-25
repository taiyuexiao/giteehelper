# 模块：实施计划

> 状态：✅ MVP 已实施；真实 WebHook/飞书验收待接入环境
> 最近更新：2026-09-26

## 目标
按照产品规格和技术设计，交付一个可本地运行的 GiteeHelper MVP：完整 Web 控制台、Gitee WebHook/API 适配、飞书通知、增量联调、影响分析、Repair Bundle、用户/规则/审计管理和 CLI。

## 实施原则
1. 先让真实链路可运行，再增强分析能力；
2. 所有写入仓库的操作都经过人工批准；
3. 真实集成、契约验证和 Mock 验证分开记录；
4. 每完成一个模块，当轮更新文档和测试；
5. 凭据只进 `.env`，不进 Git、日志和文档。

## 阶段 0：基线与配置（✅ 已完成）
### 交付
- `.gitignore`、`.env.example`、`package.json`；
- Node/TypeScript/Vite/SQLite 启动；
- `npm run dev`、`npm test`、`npm run build`。

### 验收
- 启动健康检查 `/api/health`；
- 空数据可启动；
- `.env.example` 不含真实凭据。

## 阶段 1：数据与认证（✅ 已完成）
### 交付
- SQLite schema；
- 管理员初始化；
- 登录、Bearer Session；
- users/projects/modules/contracts/rules 数据访问。

### 验收
- 可创建用户、模块、规则；
- 角色权限生效；
- 密码使用 scrypt 加密。

## 阶段 2：Gitee 适配器与事件（✅ 代码完成，真实 WebHook 待公网回调）
### 交付
- Gitee API Client；
- WebHook 签名校验；
- Push/PR/Note/Issue 事件入库；
- 测试事件；
- PR 摘要评论。

### 验收
- 伪造 WebHook 可产生事件；
- 错误签名被拒绝；
- Gitee Token 只从环境读取；
- 可通过 API 测试连接。

## 阶段 3：影响分析与通知（✅ 已完成，飞书真实发送待 Webhook）
### 交付
- 规则引擎；
- 五级影响严重度；
- 模块/负责人/PR 证据链；
- 飞书群通知 dry-run/真实发送；
- 角色路由和去重。

### 验收
- 规范/需求/文档/评论/代码 PR 都能分类；
- 未提交、已提交未合并、已合并三种文档状态可区分；
- 影响结果包含 evidence 和 nextAction。

## 阶段 4：增量联调与修复（✅ MVP 已完成）
### 交付
- ModuleManifest；
- 一跳依赖和共享场景；
- Stub/真实模块区分；
- Integration Run；
- Repair Bundle；
- 本地 apply/test/review/approve CLI；
- 批准后创建修复 PR/追加 commit 的接口（默认不自动执行）。

### 验收
- 上游/下游已提交时产生真实联调结果；
- 依赖缺失时产生 `contract_verified`；
- 无关系模块不被强联；
- 修复必须本地测试并有人工批准。

## 阶段 5：完整 Web GUI（✅ 已完成）
### 交付页面：
- Action Inbox；
- 关系图；
- 模块与契约；
- 规则编辑器；
- 用户管理；
- 审计中心；
- 联调运行；
- 接入设置。

### 验收
- 可创建/编辑项目、模块、规则、用户；
- 关系图显示来源和置信度；
- 规则可保存、启停、dry-run；
- 审计可按资源和动作筛选；
- 运行详情显示真实/Stub、矩阵和日志。

## 阶段 6：CLI 与真实接入验收（◐ 部分完成）
### 交付
- `giteehelper doctor`
- `giteehelper manifest validate`
- `giteehelper contract test`
- `giteehelper integration run`
- `giteehelper status`
- `giteehelper repair ...`

### 验收
- Gitee 测试仓库可发送 WebHook；
- 飞书测试群收到卡片；
- 一个文档 PR 和一个代码 PR 产生影响结果；
- 一个修复 Bundle 可本地 apply/test；
- 全部关键操作进入审计。

## 阶段 7：文档收口（✅ 已完成）
- 更新每个代码模块的模块文档；
- 记录 Bug 三段式；
- 更新 `docs/PROJECT.md`；
- 输出运行手册和安全清单。

## 首版明确不做
- 自动合并；
- 直接写入主干；
- 跨组织多租户；
- 自动推断负责人；
- 原型工具适配；
- 生产级高可用。

## 每阶段完成定义
每阶段必须满足：
1. `npm test` 通过；
2. `npm run build` 通过；
3. 相关 API/页面可手动验证；
4. 相关文档已更新；
5. 没有真实 Token/密码进入 Git。

## 当前执行状态（2026-09-26）
- ✅ 阶段 0–5、7 完成，8 项自动化测试和完整构建通过；关系图已按反馈重构。
- ✅ Gitee Token、用户、目标仓库和最近 20 个 PR 同步已真实验证。
- ✅ 本地 Gitee WebHook、影响、联调 Run 和 Repair Bundle 链路已验证。
- ◐ 飞书真实发送和 Gitee 真实仓库 WebHook 等待测试群/公网回调地址。
- ✅ 实现说明已沉淀到 backend-platform、gitee-feishu-integrations、impact-and-integration、web-console、cli-and-packaging 模块文档。
