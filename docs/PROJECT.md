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
