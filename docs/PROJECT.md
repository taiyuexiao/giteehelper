# GiteeHelper 项目总览

> 本文件是项目文档的入口：先读这里，再按需读 `docs/modules/` 下的模块文档。
> 更新纪律：每完成一个模块或处理一个变更，当轮更新「变更日志」和受影响的索引条目。

## 一句话说明
面向 Gitee 多人协作研发，将主干合并、PR 评论、开发规范与前端原型变化解析为跨模块影响，并通过飞书向相关开发者预警或生成修复建议/PR。

## 技术栈与关键约定
- 技术栈：Node.js 26 + TypeScript + Express + SQLite + React/Vite；部署为单机 Docker Compose，CLI 作为补充。
- 产品约束：优先复用 Gitee Webhook、Open API、飞书开放平台和设计工具 API，不自建代码托管平台。
- 时效目标为分钟级，不为低延迟做额外架构投资。
- 自动修复默认必须经过测试/CI 和人工审批后才能进入主干。
- 当前目标仓库已通过只读 API 验证：`shanghai-bank_1/agent-evaluation-platform`。
- 详细调研及选型依据见 [modules/similar-projects-research.md](modules/similar-projects-research.md)。

## 模块索引
| 模块 | 文档 | 状态 | 一句话摘要 |
|---|---|---|---|
| 类似项目与产品调研 | [modules/similar-projects-research.md](modules/similar-projects-research.md) | ✅ | 调研 Gitee 通知、AI 审查/修复、影响分析、设计变更通知及学术依据 |
| 增量联调与契约对齐 | [modules/incremental-integration.md](modules/incremental-integration.md) | 🚧 | 模块异步提交后自动组装最小联调切片，按契约/场景解决进度不一致 |
| 产品形态与接入体验 | [modules/product-form-and-onboarding.md](modules/product-form-and-onboarding.md) | ✅ | Web 控制台配置诊断，Gitee/飞书承载日常交互，CLI 服务高级用户与 CI |
| 产品规格 | [modules/product-spec.md](modules/product-spec.md) | ✅ | 定义角色、开发流程、功能范围、界面、通知、安全边界和验收场景 |
| 技术设计 | [modules/technical-design.md](modules/technical-design.md) | ✅ | 定义 Node/SQLite/React 架构、数据模型、API、影响分析、联调和修复机制 |
| 实施计划 | [modules/implementation-plan.md](modules/implementation-plan.md) | 🚧 | 将 MVP 分为数据、Gitee、通知、联调、GUI、CLI 和验收阶段 |
| 开发准备 | [modules/development-preparation.md](modules/development-preparation.md) | ✅ | 工程骨架、配置、数据库、测试、构建、CLI 与安全基线已经验证 |
| 飞书资料一次性导入 | [modules/feishu-import.md](modules/feishu-import.md) | ✅ | 导入产品、设计、技术、模块文档和真实分工映射 |
| 使用指南 | [modules/usage-guide.md](modules/usage-guide.md) | ✅ | 快速启动、影响查看、增量联调、修复和真实事件接入 |
| 后端平台 | [modules/backend-platform.md](modules/backend-platform.md) | ✅ | SQLite、认证、RBAC、REST API 与审计 |
| Gitee/飞书接入 | [modules/gitee-feishu-integrations.md](modules/gitee-feishu-integrations.md) | ✅ | Gitee API/WebHook/同步/PR 与飞书通知 |
| 影响、联调与修复 | [modules/impact-and-integration.md](modules/impact-and-integration.md) | ✅ | 规则影响、证据链、增量联调、Repair Bundle |
| Web 控制台 | [modules/web-console.md](modules/web-console.md) | ✅ | 完整管理界面、关系图、规则、用户和审计 |
| CLI 与打包 | [modules/cli-and-packaging.md](modules/cli-and-packaging.md) | ✅ | 本地命令、修复工作流和 Docker 基线 |
| 仓库全景与实时提交同步 | [modules/repo-panorama.md](modules/repo-panorama.md) | ✅ | 提交级实时分析、冲突飞书提醒与 3D 仓库全景图 |

## 变更日志
| 日期 | 类型 | 摘要 | 涉及模块 |
|---|---|---|---|
| 2026-09-24 | 新增 | 完成 GitHub、Google、arXiv 及官方文档调研，形成产品矩阵、机会缺口与 MVP 建议 | 类似项目与产品调研 |
| 2026-09-25 | 新增 | 形成异步提交后的增量联调、契约对齐与最小场景切片方案 | 增量联调与契约对齐 |
| 2026-09-25 | 新增 | 明确 Web + Gitee + 飞书 + CLI 的产品形态和两端接入体验 | 产品形态与接入体验 |
| 2026-09-25 | 新增 | 定稿产品规格、技术设计和分阶段实施计划 | 产品规格、技术设计、实施计划 |
| 2026-09-25 | 准备 | 完成工程骨架、数据/认证基础、测试、构建和冒烟验证 | 开发准备 |
| 2026-09-26 | 开发 | 完成后端、Gitee/飞书、影响分析、增量联调、修复、GUI、CLI 与打包 MVP | 实施计划阶段 1–7 |
| 2026-09-26 | 文档 | 重写面向公开仓库的 README，补齐架构、接入、CLI、安全和限制 | 项目文档 |
| 2026-09-26 | 发布 | 将 MVP 与完整文档发布到公开 GitHub 仓库 | 项目文档、CLI 与打包 |
| 2026-09-26 | 文档 | 新增面向日常使用的快速开始和工作流指南 | 使用指南 |
| 2026-09-26 | 功能 | Gitee/飞书接入配置支持 Web 编辑，Secret 采用服务器端加密存储 | Gitee/飞书接入、Web 控制台 |
| 2026-09-26 | 优化 | 为目标仓库增加可访问的帮助浮窗和填写示例 | Web 控制台 |
| 2026-09-27 | 修复 | 帮助浮窗改为 Portal 顶层渲染，解决父容器截断 | Web 控制台 |
| 2026-09-27 | 部署 | 部署到 Ubuntu/Docker 服务器并修复生产容器监听地址 | CLI 与打包 |
| 2026-09-27 | 导入 | 从飞书云盘/多维表格一次性导入 16 份资料、8 个模块、134 个真实工作项和 13 位技术负责人 | 飞书资料一次性导入 |
| 2026-09-27 | 修正 | 负责人显示名统一，忽略产品负责人，按技术负责人口径重建映射 | 飞书资料一次性导入 |
| 2026-09-27 | 优化 | 关系图改为架构视图，用户模块自动同步并删除示例账号 | Web 控制台、后端平台 |
| 2026-09-27 | 优化 | 使用 Archify 重做系统架构图，校验通过并发布到 Web 控制台 | Web 控制台 |
| 2026-09-27 | 清理 | 删除误导性联调记录与 `[旧导入]` 数据，并禁止契约检查误报通过 | 影响、联调与修复、飞书资料一次性导入 |
| 2026-09-28 | 优化 | 禁止自动评论 Gitee PR，收紧影响匹配并压缩飞书摘要 | Gitee/飞书接入、影响、联调与修复 |
| 2026-09-28 | 修复 | 修复 glob 把 `**` 拆坏导致深层路径永不匹配；中文改 n-gram 分词；无区分度语义词剪枝 | 影响、联调与修复 |
| 2026-09-28 | 修复 | `/api` 未知路由返回 SPA HTML 改为 JSON 404；前端错误态不可达；下载 diff 丢失鉴权；客户端零角色门禁 | Web 控制台、后端平台 |
| 2026-09-28 | 修复 | 测试改用独立数据库，不再污染真实数据；移除管理员固定默认口令 | CLI 与打包、后端平台 |
| 2026-09-28 | 功能 | 契约版本改为语义化范围判断，`contractVerified` 由真实校验计算 | 影响、联调与修复 |
| 2026-09-28 | 功能 | 新增提交级实时同步、冲突飞书提醒与 3D 仓库全景（负责人分区 + 新提交特效） | 仓库全景与实时提交同步 |
| 2026-09-28 | 修复 | 3D 图改用 trackball 控件消除 OrbitControls 与节点拖拽的指针冲突；装饰气泡退出拾取与取景包围盒 | 仓库全景与实时提交同步 |
| 2026-09-28 | 修复 | 架构关系图在缺少 `module-*` 顶层模块时回退展示全部模块，不再白屏 | Web 控制台 |
| 2026-09-28 | 修复 | CLI `doctor` 先加载 Secret Store，不再把 Web 端已配置的飞书报成 missing | CLI 与打包 |
| 2026-09-28 | 安全 | `/runs`、`/modules/:id/integrate`、`/repairs/:id/test` 补齐角色校验，observer 只读；403 文案中文化 | 后端平台、Web 控制台 |
| 2026-09-28 | 修复 | 事件唯一标识不再用 hook_id（常量会导致同类事件从第二条起被静默去重），改用 PR id+head sha / note id / issue id / push after | Gitee/飞书接入 |
| 2026-09-28 | 修复 | 按真实仓库校准匹配精度：弃用描述匹配、2 字中文词精确匹配、语义词按 5% 频率剪枝、区域级共用路径收敛为单条区域影响；实测平均影响 22.4→0.8 条/提交 | 影响、联调与修复 |
| 2026-09-28 | 功能 | 新增 `reanalyze` 命令与 `/api/admin/reanalyze`，生产库重算后影响 510→67 条 | 影响、联调与修复 |
| 2026-09-28 | 优化 | 3D 仓库全景重做：仓库→负责人枢纽→模块两级结构、负责人玻璃球分区、结构化锚点布局、按投影取景；修复 three.js 不解析 hsl 导致的节点全白、脉冲动画丢失、侧栏与画布不等高 | 仓库全景与实时提交同步、Web 控制台 |
| 2026-09-28 | 功能 | 仓库全景增加 DOM 标签层（分区常驻标题+防重叠）、＋/－/适配全图/全屏、三级下钻与面包屑、聚焦展开圆盘、未读计数与"跳到最新"、60 秒自动刷新与到达爆发动画 | 仓库全景与实时提交同步 |
| 2026-09-28 | 优化 | 飞书通知改为"提交者邮箱 + 可点击链接 + 按负责人分组的影响清单"，每次推送都广播；PR 事件回查真实文件列表与提交邮箱；丢弃跨虚词的切词碎片；契约判定排除测试文件 | Gitee/飞书接入、影响、联调与修复 |
| 2026-09-28 | 新增 | `PUBLIC_BASE_URL` 配置，用于通知里的控制台链接 | Gitee/飞书接入 |
| 2026-09-28 | 功能 | 影响原因分类：4 种性质 13 个代码（契约字段、口径不一致、迁移时序、合入顺序、并行改同文件、门禁/工具链、自证盲区、文档漂移、基线漂移、依据作废、越权缝隙、术语改名、跨端接口面），逐条给出「影响原因」与跟改动作 | 影响、联调与修复 |
| 2026-09-28 | 功能 | PR 级依赖图：同步全部 PR 的文件、提交与评论，从评论挖掘 `!NN` 互引，识别堆叠 PR 与跨 PR 约定；新增 `sync-pulls`、`pulls`、`/api/pulls/graph` | Gitee/飞书接入 |
| 2026-09-28 | 功能 | 主干前进检测：分支落后主干（基线漂移）与 head 变化使旧结论作废（依据作废）作为独立原因上报 | 影响、联调与修复 |
| 2026-09-28 | 修复 | 区域共用路径模式不再抹掉路径证据：文件确实落在本模块声明的模式里就保留具体路径（仅标注「区域共用模式」），收敛判据改看「是否被专有模式或语义词定位」，避免用证据类型判断导致收敛失效；单条影响最多留 5 条路径证据，其余折叠成计数 | 影响、联调与修复 |
| 2026-09-28 | 功能 | 新增路径模式体检 `pattern-health` 与修复 `pattern-fix`：实测某仓库 142 个模块模式全部失效（`backend/`、`docs/modules/` 目录不存在），机械修复恢复 41 个，含文档侧改写共 80 个，覆盖文件 732→947、覆盖事件 7%→33% | 影响、联调与修复、CLI 与打包 |
| 2026-09-28 | 功能 | 契约即代码：解析 `docs/rfcs/meta/*.json` 反查工作项归属（`tasks[].ref` → `BOSC-XXXX` → 模块 → 负责人），文档三件套与已落地类名生成精确模式，`related`/`requires` 作为跨模块语义边；事件覆盖 6%→38%。新增 `rfc-sync`/`rfc-coverage`/`rfc-apply` 与 `/api/repo/rfc-contracts` | 影响、联调与修复、CLI 与打包 |
| 2026-09-28 | 修复 | 最大的一处归属缺口不是模式而是**事件里没有文件**：284 个事件里 207 个（占全部影响 60%）缺文件列表，PR/评论类 WebHook 的 payload 本就不带文件。新增 `pull_requests.remote_id` 与 `backfill-files`，把已落库的 PR 文件列表回填进历史事件，路径证据覆盖的影响 190→554 条 | Gitee/飞书接入、影响、联调与修复 |
| 2026-09-28 | 功能 | 通知按依据分档：有路径证据写「确定」并列出具体文件，只有语义匹配就地标「（线索）」并给出计数；区域影响不再显示「未分配负责人」，按 userId 反查负责人姓名 | Gitee/飞书接入 |

## 关键问题与解决
- 现有工具分散：Gitee 可把原始事件推到飞书，AI 审查工具可修 PR，影响分析工具可算风险，但未发现完整覆盖本需求闭环的单体产品。
- 最难不是“收到变化”，而是建立规范/设计/代码/模块/人员之间的可解释映射；详见调研模块的“机会缺口”。

## 待处理 / 后期处理
- [ ] 确认实际使用的是 Gitee.com、Gitee 企业版还是私有化版本，以及其 WebHook 事件差异。
- [ ] 确认前端原型工具及其版本/发布 API（Figma、蓝湖、MasterGo、Pixso 等）。
- [ ] 建立模块、负责人、仓库/路径、需求/原型页的映射样本。
- [ ] 基于调研结论设计事件模型、影响分析与飞书通知 MVP。
- [ ] 用真实模块接口和联调失败样例验证增量联调方案。
- [ ] 用真实 Gitee/飞书租户验证 15 分钟接入向导。
- [ ] 配置可公开访问的 Gitee WebHook 回调并验证真实仓库事件。
- [ ] 提供飞书测试群 WebHook，验证真实卡片和角色通知。

## 可参考的类似项目
- 完整清单、能力矩阵与可借鉴点：[modules/similar-projects-research.md](modules/similar-projects-research.md#二github-参考实现)。

## 后续优化方向
- 先做“可信变更解析 + 影响路由 + 飞书通知”，再逐步开放自动修复 PR。
- 用误报率、触达准确率、返工率验证价值，避免把系统做成高噪声群机器人。
- 3D 仓库全景先解决「看得见全貌」，再考虑时间轴回放与大模型语义摘要。
- 联调采用契约/场景切片，不等待无关模块；Mock 验证与真实集成分开标记。
