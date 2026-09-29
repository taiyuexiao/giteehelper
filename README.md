# GiteeHelper

> Gitee 上游变化的下游影响路由、增量联调与安全修复助手。

GiteeHelper 面向多人协作研发项目。它监听 Gitee 中规范、需求、开发文档、Review 评论和代码提交的变化，分析这些变化影响哪个模块、哪位负责人和哪些未完成工作，并通过 Gitee 与飞书给出可执行的下一步。新提交到达后会立即分析，冲突对象即时收到飞书提醒，并同步呈现在 3D 仓库全景上。

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

### 影响原因与责任到人

只报「谁被影响了」还不够，通知必须回答「为什么是他、他哪一部分」。

- 每条影响的依据可追溯：优先给出**具体文件的路径证据**；路径模式被多个工作项共用时，路径证据照旧保留，
  只在证据里额外注明「区域共用模式」，不会因为模式公用就退化成纯语义推断；
- 路径模式无法定位到具体工作项时收敛成**一条区域级影响**，不会给区域内几十个负责人同时发通知；
- 影响原因按 4 种性质、13 个代码分类，直接写进通知的「影响原因」和「下一步」：
  指令性（契约字段、接口面、跨端）、时序性（迁移、合入顺序、并行改同文件）、
  认知性（口径不一致、术语改名、文档漂移、基线漂移）、合规性（门禁/工具链、自证盲区、依据作废、越权缝隙）；
- 飞书通知写明**提交人邮箱**（同一 Gitee 账号多人共用时按邮箱区分）、可点击的提交/PR 链接、每条影响的负责人、原因与动作；
- 影响条目里同时列出该提交触碰到的**在飞 PR**，提示先对齐再合。

### 路径模式体检

模块路径模式（「这个工作项对应哪些文件」）与仓库实际结构一旦不一致，路径匹配会全部落空，归属只能退回语义猜词。

```bash
npm run cli -- pattern-health          # 哪些模块的模式一个文件都命中不了
npm run cli -- pattern-fix             # 预览可安全修复的前缀（只读）
npm run cli -- pattern-fix --apply     # 应用机械修复（语义不变的 backend/ 冗余前缀）
npm run cli -- pattern-fix --apply --include-review   # 连文档侧改写一起应用（会改变匹配语义，需人工确认）
```

实测某仓库：142 个模块的模式**全部失效**（`backend/src/main/java/**`、`docs/modules/**` 两个目录都不存在）。
机械修复后 41 个模块恢复命中；连文档侧改写一起应用后覆盖文件 732 → 947、覆盖到的事件 7% → 33%。
该命令同时暴露真实缺口：仓库里 `docs/rfcs/*.mdx` 是主要变更面，而模块模式里的英文 slug 与 RFC 文件名并不一一对应，
剩余文件仍需靠语义匹配——这是「按模式命中归属」的边界，见「当前限制」。

### 契约即代码：从 RFC meta 反查归属

人写的路径模式会腐烂（实测某仓库 142 个模块的模式全部失效），但仓库里的 RFC meta 是活的契约：

```bash
npm run cli -- rfc-sync                  # 只读拉取 docs/rfcs/meta/*.json
npm run cli -- rfc-coverage              # 哪些模块有契约背书、哪些没有（无背书返回非零退出码）
npm run cli -- rfc-apply [--apply]       # 预览/应用反查出来的模式
npm run cli -- backfill-files [--fetch]  # 把 PR 文件列表补回历史事件（--fetch 才回查 Gitee）
```

归属关系直接读自契约，不是猜的：

- `tasks[].ref` = `BOSC-0100#T1` → 反查工作项 `work-bosc-0100` → 负责人；
- meta 文件自身的路径 → RFC 文档三件套（正文 / meta / 附件），这是文档驱动仓库最大的变更面；
- `authors` → 责任人，可与工作项负责人交叉校验（`rfc-coverage` 给出吻合比例）；
- `tasks[].scope` 里已经落地到仓库的类名与迁移文件 → 精确代码模式（没落地的不生成死模式，
  同名类也不生成，交给人工补）；
- `related` / `requires` → 契约依赖边，是「跨模块语义未对齐」的机器可读来源。

实测效果：事件覆盖率 6% → 38%，且每条模式都能追到某个 RFC 的某个任务。

### PR 级依赖图与主干前进检测

- 拉取全部 PR 及其文件、提交、评论，建立 PR 级依赖图（谁依赖谁、谁堆叠在谁上面、谁引用了谁的编号）；
- 从评论里挖掘 `!123` 形式的 PR 互引，识别堆叠 PR 与跨 PR 的口径约定；
- 主干前进时重算在飞 PR 的影响：分支落后主干、head 已变化导致旧结论作废，都会作为独立原因报出来。

### 仓库全景与实时提交同步

- WebHook 收到 Push 后立即确认并后台分析，不会因为回调超时被 Gitee 重投；
- 按提交粒度入库：谁提交、改了什么文件、处理了什么问题、影响了哪个模块，逐条可追溯；
- 从提交信息解析「处理了什么问题」：约定式提交类型、scope、正文中的问题描述、`#123`/`WS-2283` 需求编号；
- 只有 `blocking` / `contract` 级冲突才发飞书，并直接点名模块与负责人，无冲突不打扰群；
- 3D 仓库全景图：按负责人用低饱和度浅色分区着色，新提交带脉冲特效，悬停/点击即可查看提交作用与影响结论；
- WebHook 投递日志可见每次回调的状态与结果，未被公网回调覆盖的时段可用「补齐提交」手动回填。

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
- React Flow（2D 关系图）
- three.js + 3d-force-graph（3D 仓库全景）
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

> 8787 与 5173 很容易被本机其他项目占用。被占用时用 `PORT=8876 npm run dev:server` 换端口，并同步修改 `vite.config.ts` 里的代理目标。

首次登录使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`。未配置 `ADMIN_PASSWORD` 时，系统不会写入固定默认口令，而是生成一个随机初始密码并在启动日志中打印一次。

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

实时性完全由 WebHook 驱动，系统不做轮询。回调地址必须是 Gitee 能访问到的公网地址；「接入设置 → 实时接收状态」会列出最近 10 次投递的时间、事件、状态、提交数和冲突数，被拒绝的投递也会记录原因，便于确认回调是否真的打通。没有公网回调时，可在「仓库全景」点击“补齐提交”（或调用 `POST /api/gitee/sync`）手动回填最近 30 个提交。

## 飞书接入

MVP 使用飞书群自定义机器人：

1. 在目标飞书群添加 Custom Bot；
2. 获取 Webhook URL；
3. 写入 `FEISHU_WEBHOOK_URL`；
4. 在“接入设置 → 发送测试消息”验证。

未配置飞书时，通知会进入 dry-run 审计，不会产生外部消息。

通知只有一类：按提交给出「谁提交（邮箱）+ 提交链接 + 按负责人分组的影响清单」，每条影响带原因、动作与依据，
并列出该提交触碰到的在飞 PR。推送只要有新提交就广播（影响为空也照发，群里能看到「提交了什么、暂时没人受影响」）；
PR、评论、Issue 事件在产生了影响时同样按这套格式发。

正式产品可升级为飞书企业自建应用，以支持私聊、用户身份映射和交互卡片。

## CLI

```bash
npm run cli -- doctor
npm run cli -- manifest validate
npm run cli -- contract test
npm run cli -- integration run <module-key>
npm run cli -- status <run-id>
```

仓库侧运营：

```bash
npm run cli -- sync-pulls [--with-comments]   # 拉取 PR、文件、提交与评论，建立 PR 级依赖图
npm run cli -- pulls                          # PR 统计与依赖概览
npm run cli -- pattern-health                 # 模块路径模式体检（会返回非零退出码表示存在失效模式）
npm run cli -- pattern-fix [--apply] [--include-review]
npm run cli -- rfc-sync                       # 只读拉取 RFC meta，反查工作项归属
npm run cli -- rfc-coverage                   # 契约覆盖缺口清单
npm run cli -- rfc-apply [--apply]            # 把契约反查出的模式并进模块
npm run cli -- backfill-files [--fetch]       # 回填历史事件缺失的文件列表
npm run cli -- reanalyze                      # 用当前规则和路径模式重算历史影响
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

`npm test` 会自动把数据库指向 `data/test/giteehelper-test.db`（`pretest` 先清空），不会触碰 `data/giteehelper.db` 里的真实数据。

当前 25 个自动化测试用例覆盖：

- WebHook 签名与事件标准化；
- 影响匹配精度（深层路径、无关路径、中文分词、停用词剪枝）；
- 提交语义解析、提交入库幂等与冲突判定；
- 契约版本语义化范围兼容；
- 负责人配色与 3D 图谱数据结构；
- 规范/Review 影响分析；
- 增量联调与契约 Stub；
- 密码加密与数据种子；
- Repair Bundle 与批准边界；
- 误导数据清理。

## 项目文档

- [项目总览](docs/PROJECT.md)
- [仓库全景与实时提交同步](docs/modules/repo-panorama.md)
- [产品规格](docs/modules/product-spec.md)
- [技术设计](docs/modules/technical-design.md)
- [实施计划](docs/modules/implementation-plan.md)
- [Gitee/飞书接入](docs/modules/gitee-feishu-integrations.md)
- [影响、联调与修复](docs/modules/impact-and-integration.md)
- [Web 控制台](docs/modules/web-console.md)
- [CLI 与打包](docs/modules/cli-and-packaging.md)
- [使用指南](docs/modules/usage-guide.md)

## 安全边界

- Gitee 只使用 Private Access Token，不使用账号密码；
- Token、Secret 和飞书 Webhook 只能保存在 `.env` 或 Secret Store；
- 日志、API 响应和界面不得显示秘密；
- 自动修复必须经过本地测试和人工批准；
- 修复只能通过 PR 进入主干；
- 关键配置、通知、联调和修复操作均进入审计。

## 当前限制

- 单项目、单组织 MVP；
- 规则驱动的影响分析，不依赖外部大模型，因此「提交处理了什么问题」取决于提交信息本身写得是否清楚；
- 归属精度取决于**能不能拿到变更文件**和**模式能不能命中它**。实测某仓库的分步改进：
  路径证据覆盖的影响 24 → 190 → 554 条，其中最大的一步不是调模式，而是
  **把 PR 与评论类事件缺失的文件列表补回来**（284 个事件里 207 个没有文件，占全部影响的 60%）；
- 仍有约 1500 条影响只有语义证据。它们来自「事件带了文件、但文件指向别处，模块是被词面拉进来的」——
  这类里既有真实的跨模块语义未对齐，也有噪声，**无法自动区分**，所以通知里如实标成「（线索）」，
  等人工判断，而不是删掉或伪装成结论；
- 只有 17/142 个模块有 RFC 契约背书（`rfc-coverage` 会列出其余 125 个）。没有契约的模块只能靠语义匹配，
  精度上限就在这里——要提升得补契约，不是继续放宽 glob；
- 文档侧模式改写（`docs/modules/<领域>/**` → `docs/rfcs/*<slug>*`）会改变匹配语义，默认不自动应用，
  需人工确认；其中 `*run*` 一类短 slug 有过度匹配风险；
- 实时性依赖 Gitee WebHook 可达，没有公网回调时只能手动补齐；
- 3D 仓库全景需要 WebGL，单次最多渲染 300 个提交节点；
- 负责人颜色由名称哈希派生，人数很多时可能出现相近色；
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
- 容器化隔离 Runner 与长 E2E 调度；
- 提交与 PR 的语义摘要接入大模型，进一步降低对提交信息书写质量的依赖；
- 3D 图谱按时间轴回放仓库演进过程。
