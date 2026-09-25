# GiteeHelper

> Gitee 上游变化的下游影响路由、增量联调与安全修复助手。

GiteeHelper 面向多人协作研发项目。它监听 Gitee 中规范、需求、开发文档、Review 评论和代码 PR 的变化，分析这些变化影响哪个模块、哪位负责人和哪些未完成工作，并通过 Gitee 与飞书给出可执行的下一步。

它不是另一个简单的 AI Code Review，而是连接“变化 → 影响 → 联调 → 修复 → 协作”的工程基础设施。

## 为什么需要 GiteeHelper

多人开发时，各模块完成时间不一致，上游规范、需求和设计经常变化：

- Reviewer 合并新的规范或需求后，下游开发者没有及时收到影响说明；
- 模块文档尚未提交时，开发者不知道原始需求已经变化；
- 模块文档已经提交后，PR 设计可能与新主干产生冲突；
- 代码 PR 尚未合并，也可能已经受到新主干变化影响；
- 所有模块全部完成后才开始联调，问题集中爆发；
- 修复建议散落在评论里，缺少测试、审批和审计。

GiteeHelper 将这些过程变成可追踪、可验证、可协作的工作流。

## 核心能力

### 变化影响分析

- 监听 Push、PR、评论和 Issue；
- 区分需求、规范、契约、实现和 Review 变化；
- 生成五级影响：`blocking`、`contract`、`implementation`、`clarification`、`informational`；
- 输出影响对象、负责人、证据和下一步；
- 支持未提交文档、已提交 PR、已合并设计和代码 PR 等不同状态。

### 增量联调

- 模块提交后只测试一跳上下游；
- 直接依赖已提交时使用真实模块；
- 依赖缺席时使用契约 Stub；
- 无直接依赖但共享业务场景时生成最小场景切片；
- 完全无关模块只对齐发布基线，不强行联调；
- `contract_verified` 与 `slice_integrated` 分开记录。

### 安全修复

- 生成 Repair Bundle：diff、测试补丁、测试报告、命令和来源；
- 用户在本地执行 apply、test、review；
- 人工批准后才允许创建修复分支和 PR；
- 永不直接写入 `main`，永不自动合并。

### 完整控制台

- 待处理与影响证据；
- 事件聚焦关系图；
- 模块、契约、负责人和场景；
- 增量联调矩阵；
- Repair Bundle；
- 版本化规则编辑器；
- 用户、角色和 Gitee/飞书身份映射；
- 审计中心；
- Gitee/飞书接入设置。

## 架构

```text
Gitee WebHook/Open API        Feishu Webhook/API
          │                         │
          └────────────┬────────────┘
                       ▼
              ┌────────────────┐
              │  Express API   │
              │  Event Router  │
              └───────┬────────┘
                      │
       ┌──────────────┼───────────────┐
       ▼              ▼               ▼
 Event Store    Impact Engine   Integration Engine
       │              │               │
       └──────────────┼───────────────┘
                      ▼
             SQLite / Audit Store
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   React Console    CLI/MCP     Gitee/飞书反馈
```

## 技术栈

- Node.js 26
- TypeScript
- Express
- SQLite
- React + Vite
- React Flow
- Node Test
- Docker Compose

## 快速开始

### 1. 安装

```bash
git clone https://github.com/taiyuexiao/giteehelper.git
cd giteehelper
npm install
```

### 2. 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```dotenv
PORT=8787
DATABASE_PATH=./data/giteehelper.db

GITEE_API_BASE=https://gitee.com/api/v5
GITEE_TOKEN=your-minimal-scoped-token
GITEE_WEBHOOK_SECRET=your-webhook-secret
GITEE_REPO=owner/repository
GITEE_DEFAULT_BRANCH=main

FEISHU_WEBHOOK_URL=

ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
SESSION_SECRET=change-this-session-secret
```

> `.env` 已被 Git 忽略。不要提交真实 Token、密码或 Webhook Secret。

### 3. 启动开发环境

```bash
npm run dev
```

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`
- 健康检查：`http://127.0.0.1:8787/api/health`

首次登录使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`。

### 4. 生产构建

```bash
npm run build
npm start
```

服务会在 `http://127.0.0.1:8787` 同时提供 API 与 Web 控制台。

## Gitee 接入

1. 创建最小权限 Private Access Token；
2. 配置 `GITEE_TOKEN` 和目标仓库 `GITEE_REPO`；
3. 在 Gitee 仓库中添加 WebHook；
4. 回调地址设置为：

```text
https://your-host.example.com/api/webhooks/gitee
```

5. 配置 `GITEE_WEBHOOK_SECRET`；
6. 建议订阅：
   - Push
   - Pull Request
   - Issue
   - Note / 评论
7. 使用“接入设置 → 测试 Gitee”验证 API 连接。

Gitee WebHook 支持两种验证：

- `X-Gitee-Token` 等于配置的 Secret；
- `X-Gitee-Token` 为基于时间戳和 Secret 的 HMAC-SHA256 签名。

## 飞书接入

MVP 使用飞书群自定义机器人：

1. 在目标飞书群添加 Custom Bot；
2. 获取 Webhook URL；
3. 写入 `FEISHU_WEBHOOK_URL`；
4. 在“接入设置 → 发送测试消息”验证。

未配置飞书时，通知会进入 dry-run 审计，不会产生外部消息。

正式产品可升级为飞书企业自建应用，以支持私聊、用户身份映射和交互卡片。

## CLI

```bash
npm run cli -- doctor
npm run cli -- manifest validate
npm run cli -- contract test
npm run cli -- integration run <module-key>
npm run cli -- status <run-id>
```

修复工作流：

```bash
npm run cli -- repair create <impact-id>
npm run cli -- repair review <repair-id>
npm run cli -- repair apply <repair-id>
npm run cli -- repair test <repair-id>
npm run cli -- repair approve <repair-id>
```

批准只授权创建修复分支和 PR，不授权直接写主干。

## Docker

```bash
docker compose up --build
```

服务地址：`http://127.0.0.1:8787`。

## 质量检查

```bash
npm run typecheck
npm test
npm run build
npm run cli -- manifest validate
```

当前自动化测试覆盖：

- WebHook 签名与事件标准化；
- 规范/Review 影响分析；
- 增量联调与契约 Stub；
- 密码加密；
- 数据种子；
- Repair Bundle 与批准边界。

## 项目文档

- [项目总览](docs/PROJECT.md)
- [产品规格](docs/modules/product-spec.md)
- [技术设计](docs/modules/technical-design.md)
- [实施计划](docs/modules/implementation-plan.md)
- [Gitee/飞书接入](docs/modules/gitee-feishu-integrations.md)
- [影响、联调与修复](docs/modules/impact-and-integration.md)
- [Web 控制台](docs/modules/web-console.md)
- [CLI 与打包](docs/modules/cli-and-packaging.md)

## 安全边界

- Gitee 只使用 Private Access Token，不使用账号密码；
- Token、Secret 和飞书 Webhook 只能保存在 `.env` 或 Secret Store；
- 日志、API 响应和界面不得显示秘密；
- 自动修复必须经过本地测试和人工批准；
- 修复只能通过 PR 进入主干；
- 关键配置、通知、联调和修复操作均进入审计。

## 当前限制

- 单项目、单组织 MVP；
- 规则驱动的影响分析，不依赖外部大模型；
- 飞书目前支持群机器人文本通知；
- Repair.diff 的真实代码生成需要接入编码 Agent；
- 原型工具版本差异分析属于后续适配器；
- 尚未实现多租户、高可用和完整 SemVer 求解。

## 后续方向

- 飞书企业自建应用、私聊和交互卡片；
- Figma / 蓝湖 / MasterGo / Pixso 原型差异分析；
- CODEOWNERS、OpenAPI、目录和历史共变自动推断；
- Agent 生成真实修复代码和 stacked PR；
- 跨仓库关系与组织级 WebHook；
- 规则 dry-run、发布审批和版本 diff；
- 容器化隔离 Runner 与长 E2E 调度。
