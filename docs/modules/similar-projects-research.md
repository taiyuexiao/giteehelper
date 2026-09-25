# 模块：类似项目与产品调研

> 状态：✅
> 最近更新：2026-09-24

## 摘要
本模块调研“Gitee/代码托管事件监听 → 语义解析 → 跨模块影响判断 → 飞书定向通知 → 问题/修复/PR”的同类产品与研究。结论是：各基础能力均有成熟实现，但**没有发现一个现成产品完整覆盖 Gitee 原生接入、上游变化对下游模块的影响路由、PR 状态分流、飞书私聊/群聊和自动修复 PR 的闭环**。最适合的策略不是开发新平台，而是组合 Gitee 事件、影响图谱和成熟 Agent 工作流，做薄而准的影响通知器。

## 动机
多人协作中，规范、评论和原型是“跨模块上游输入”，但 Gitee 原生通知主要回答“发生了什么”，不回答“谁受影响、影响什么、现在该做什么”。调研用于回答：
1. 是否已有产品可直接替代自研；
2. 哪些组件可复用或借鉴；
3. 真正的产品差异和研发难点在哪里；
4. 自动修复到什么程度才可信。

## 范围与非范围
- 范围内：Gitee Webhook/Open API、AI PR 审查与自动修复、跨仓库/跨模块影响分析、规则/规范治理、原型变更事件、IM 通知、相关实证研究。
- 明确不做：完整代码托管平台、通用 DevOps 平台、无测试门禁的直接主干写入、企业代码托管产品选型/采购评测。
- 研究截止：2026-09-24；产品能力会变化，实施前应按引用链接复核。

## 上下游依赖
- 上游：GitHub 搜索/API、Google 搜索发现、arXiv API、Gitee/Figma/飞书/Qodo/CodeRabbit 官方文档、GitHub 项目 README。
- 下游：产品方案、事件模型、模块归属模型、影响分析算法、飞书通知模板、修复 Agent 安全边界。

## 关键接口与运行时信息
- 关键产物：本文件；项目入口见 `/Users/shipeilin/projects/mine/giteehelper/docs/PROJECT.md`。
- 核心输入维度：Gitee 支持、事件覆盖、语义影响、人员路由、PR 状态分流、自动修复、设计变更、飞书、私有化。
- 复核方式：优先打开“一、产品与集成基座”和“二、GitHub 参考实现”的官方链接；论文以 arXiv 摘要/全文复核。
- 搜索限制：Google 在连续请求时出现限流/验证码；仅将其用于发现候选，所有关键结论均由官方文档、GitHub 或 arXiv 二次验证。

## 一、产品与集成基座

### 1. Gitee WebHook + 飞书群机器人：最近的“零代码基线”
- [Gitee WebHook 简介](https://help.gitee.com/webhook/gitee-webhook-intro)：企业 WebHook 覆盖企业内所有仓库的推送、PR、Issue；仓库 WebHook 只覆盖绑定仓库。
- [推送数据类型](https://help.gitee.com/webhook/gitee-webhook-push-data-type) / [数据格式](https://help.gitee.com/webhook/gitee-webhook-push-data-format)：包含 Push/Tag、PR、评论、Issue 等 payload；PR 事件有 `action`、`state`、`target_branch`、`merge_commit_sha`、作者/更新者等，评论事件含评论正文、作者和被评论对象。
- [WebHook 对飞书机器人的支持](https://help.gitee.com/webhook/webhook-for-feishu-robot)：官方支持把 Push、Tag、Issue、PR 新建/更新/合并、仓库/Issue/PR/Commit 评论直接发到飞书群。
- [密钥验证](https://help.gitee.com/webhook/how-to-verify-webhook-keys)：支持 HMAC-SHA256 签名，适合自建可信接收端。
- [Gitee Open API](https://gitee.com/api/v5/swagger)：可读取 PR、diff 文件、评论、操作日志，创建 PR 评论，提交审查，管理 WebHook。
- **判断**：原始广播问题其实已有低成本解法；缺的是语义解析、影响判断、按人路由和修复动作。直接把所有事件塞进大群会加剧通知疲劳。

### 2. 飞书开放平台
- [自定义机器人](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)适合固定群低成本通知。
- [发送消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)适合应用机器人定向私聊、群聊和卡片交互。
- **判断**：MVP 可先用群机器人；要做“对谁负责就发给谁”、确认/忽略/生成修复等交互，应使用企业自建应用机器人和用户身份映射。

### 3. 设计工具事件
- [Figma Developer API](https://www.figma.com/developers/api)与 [Webhooks V2](https://developers.figma.com/docs/rest-api/webhooks/)可监听文件评论、文件新版本等事件，并读取文件、版本、评论和组件/样式。
- **判断**：原型“有更新”容易获取，“更新影响谁”很难。必须额外维护页面/Frame/组件与需求、模块、代码路径、负责人的映射，并对版本做 diff/摘要。Figma 只是示例；若团队用蓝湖、MasterGo、Pixso，应优先验证其版本/发布 Webhook 或开放 API。

## 二、GitHub 参考实现

### A. 商业 AI 审查/治理产品
| 产品 | 最值得借鉴 | 与目标的差距 |
|---|---|---|
| [Qodo](https://docs.qodo.ai/) | [跨仓库关系](https://docs.qodo.ai/governance/repositories/relationships)会在后续 PR 中追踪上下游影响；[Blast Radius](https://docs.qodo.ai/code-review/assess-risk-with-blast-radius)按影响与敏感度分级风险；[Rule Miner](https://docs.qodo.ai/governance/rule-enforcement/rule-miner)从已合并 PR/审查历史提炼规则；支持私有化 | [支持的 Git 平台](https://docs.qodo.ai/code-review/deployment-model-support)为 GitHub/GitLab/Bitbucket/Azure DevOps，未列 Gitee；未见原型变更驱动和飞书主动影响路由 |
| [CodeRabbit](https://docs.coderabbit.ai/) | PR 审查、[Autofix](https://docs.coderabbit.ai/finishing-touches/autofix)把发现变成 commit/stacked PR、[Coding Agent](https://docs.coderabbit.ai/code/)可在沙箱修复并交付、[Triage in Slack](https://docs.coderabbit.ai/triage/slack.md)支持按人 DM/频道和持续 Follow、[Plan](https://docs.coderabbit.ai/plan/index.md)可从 PRD/设计生成实施计划 | 未观察到 Gitee 原生支持；其 Slack/Figma 能力很强，但不是“上游规范/设计变化主动找下游”的产品 |
| [Greptile](https://www.greptile.com/) | 全仓库索引和上下文化 PR Review，是“不能只看 diff”的代表 | 主要面向 PR Review，不是跨事件影响广播；Gitee/飞书/设计映射未观察到 |
| [CodeScene](https://www.codescene.com/) | Code Health、hotspot、技术债和自动化质量审查；适合作为影响/风险图谱参考 | 偏代码健康与风险分析，不是事件到人、再到修复 PR 的工作流 |

### B. 开源/可自建实现
| 项目 | 可复用点 | 局限 |
|---|---|---|
| [The PR Agent](https://github.com/the-pr-agent/pr-agent) | 成熟的 Review/Describe/Improve/Implement 等 PR Agent 工具面；支持 Action、CLI 和 GitLab Webhook 等形态 | 未原生支持 Gitee；核心围绕单个 PR，缺少全局上游变化路由 |
| [vercel-labs/openreview](https://github.com/vercel-labs/openreview) | 自托管 AI Review；PR 评论触发；行内 suggestion；可修简单问题、commit/push；自定义 skill | GitHub App/Webhook 模型；按 PR/评论触发，不做跨模块主动影响分析 |
| [miguchn/ai-code-review](https://github.com/miguchn/ai-code-review) | **与目标最接近的参考架构**：GitHub/GitLab/Gitee/Gitea、Webhook、审查回写、飞书/企微/钉钉通知、问题台账、责任归属、整改后复核 | 仍以“审查本次代码”为中心；未见规范/原型变化反向命中未来模块与未提交任务 |
| [lycodeing/code-review](https://github.com/lycodeing/code-review) | Gitee 适配、Webhook、LiteLLM、幂等队列、飞书/钉钉/邮件通知，工程分层清晰 | 自动 Review/评论为主，无跨模块影响和自主修复闭环 |
| [zhansan379/codereview-ai](https://github.com/zhansan379/codereview-ai) | Gitee Webhook 入口、LiteLLM、Agent + Semgrep、行内评论，适合参考事件适配和规则层 | 重点是单次审查，未覆盖全局规范传播、人员路由和设计变化 |
| [DavideViolante/pr-reviews-reminder-action](https://github.com/DavideViolante/pr-reviews-reminder-action) | 把等待 Review 的 PR 提醒到 Slack/Teams，说明“定向催办”有明确需求 | 仅提醒，不做语义影响和修复 |

### C. 能力矩阵
图例：✅ 已具备；◐ 部分/可间接实现；❌ 未观察到；? 需进一步验证。

| 方案 | Gitee 原生 | 事件覆盖 | 跨模块/上游影响 | 按人路由 | 按 PR 状态分流 | 生成修复/PR | 原型变化 | 飞书 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gitee WebHook → 飞书群 | ✅ | ✅ | ❌ | ◐ | ❌ | ❌ | ❌ | ✅ |
| Qodo | ❌ | ✅ | ✅ | ◐ | ◐ | ◐ | ❌ | ❌ |
| CodeRabbit | ❌ | ✅ | ◐ | ✅ | ✅ | ✅ | ◐ | ❌ |
| openreview | ❌ | ◐ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| miguchn/ai-code-review | ✅ | ✅ | ◐ | ◐ | ✅ | ◐ | ❌ | ✅ |
| lycodeing/code-review | ✅ | ✅ | ❌ | ◐ | ✅ | ❌ | ❌ | ✅ |
| Figma Webhooks | ❌ | ◐ | ❌ | ❌ | ❌ | ❌ | ◐ | ❌ |

## 三、arXiv 与研究依据

### 变更影响、追踪与仓库理解
- [A Rule-Based Change Impact Analysis Approach in Software Architecture for Requirements Changes](https://arxiv.org/abs/1608.02757)：需求变化应沿需求—架构关系传播，而非只检查文件依赖。
- [Software Engineers' Information Seeking Behavior in Change Impact Analysis](https://arxiv.org/abs/1703.01897)：工程师需要跨源码、设计、文档、历史讨论寻找证据；系统应给“为什么影响”而不是只给名单。
- [A Learning Algorithm for Change Impact Prediction](https://arxiv.org/abs/1512.07435)：可用历史变更/共变数据学习影响预测，适合补充静态依赖图。
- [Traceability Support for Multi-Lingual Software Projects](https://arxiv.org/abs/2006.16940) / [Traceability Using Deep Learning Techniques](https://arxiv.org/abs/1804.02438)：需求、设计、代码、测试之间的链接可自动恢复，但链接质量是基础瓶颈。
- [Alibaba LingmaAgent](https://arxiv.org/abs/2406.01422)：仓库级问题解决需要主动探索全仓库上下文；不能只把 diff 丢给模型。

### LLM Review 与自动修复
- [CodeReviewQA](https://arxiv.org/abs/2503.16167)：模型理解真实 review 评论并据此修改代码仍困难，修复结果不能默认可信。
- [Harnessing Large Language Models for Curated Code Reviews](https://arxiv.org/abs/2502.03425)：结构化、相关、可执行的评论比大量泛化评论更有价值。
- [A Systematic Literature Review on LLMs for APR](https://arxiv.org/abs/2405.01466)：LLM APR 进展快，但基准、正确性验证和泛化仍是关键问题。
- [Copiloting the Copilots](https://arxiv.org/abs/2309.00608)：LLM 与编译/补全/验证工具结合，比纯生成补丁更可靠。

### 机器人通知与协作
- [Nudge](https://arxiv.org/abs/2011.12468)：定向提醒能推动逾期 PR，但应优先催办真正阻塞的 PR。
- [Autonomy Is An Acquired Taste](https://arxiv.org/abs/2302.05048)：机器人过于频繁会降低接受度；用户偏好、可控性和可解释性很重要。
- [Reducing Alert Fatigue via AI-Assisted Negotiation](https://arxiv.org/abs/2502.06175)：AI 可聚合/协商告警以降低疲劳，支持“默认汇总、关键才打扰”的通知策略。
- [Suggestion Bot](https://arxiv.org/abs/2305.06328)：自动 suggestion 能推动 review，但会影响讨论与采纳行为，应避免机械式刷评论。

## 四、综合判断与机会缺口
1. **没有发现现成五项闭环产品**：Gitee 事件、跨模块影响、按人路由、PR 状态分流、修复 PR 与飞书通知目前分散在不同产品。
2. **原始广播不是主要难点**：Gitee 已可直接把 PR/评论/合并事件发到飞书。若只解决同步，配置官方 WebHook 即可。
3. **核心资产应是“变更知识图谱”**：节点至少包括规范条目、需求/任务、原型页面/Frame、模块、仓库/路径/API、人员、PR；边表示 implements、depends-on、owns、changes、affects。
4. **必须区分未来工作与存量 PR**：
   - 未提交：输出冲突点、规范差异、受影响页面/接口、建议开发方式。
   - 已提交/已合并：关联开放或历史 PR，列出待修复项、证据、修复代码；经测试后可提交修复 PR。
5. **设计变更是最大空白**：现有 AI Review 多从代码/issue/PRD 开始，缺少原型版本 diff 到模块/人员的主动传播。
6. **自动修复必须是第二阶段**：先以“证据 + 建议补丁”建立信任，再开放沙箱修复、CI 验证、人工批准、stacked PR。
7. **通知体验决定成败**：采用聚合摘要 + 高影响才私聊 + 群内可追踪卡片；允许用户按模块/规则订阅、确认、忽略并反馈误报。

## 五、建议的 MVP 与竞品式定位
### MVP（优先验证价值）
1. Gitee 企业/仓库 WebHook 接收 PR、评论、Push，校验签名并去重。
2. 只解析约定主分支合并且 diff 命中 `规范/`、架构文档或约定配置的变化。
3. 从人工维护的 YAML/表格映射找出模块、负责人、开放 PR；影响证据先用路径、依赖清单、API/组件名匹配。
4. 生成飞书群摘要；高置信个人影响发私聊。未提交任务给冲突项/开发方式，开放 PR 给修复建议。
5. 记录“变更—影响—通知—反馈”，持续测误报率和有用率。

### 第二阶段
- 接入原型工具版本事件，做 Frame/组件 diff 和设计—模块映射。
- 构建代码/依赖/历史共变图，提升影响解释与召回。
- 接入测试/CI 和修复 Agent，生成 issue/补丁/stacked PR，人工批准后落地。

### 一句话定位
**“Gitee 上游变化的下游影响路由与修复助手”**，不是又一个 AI Code Review。最有价值的能力是回答：这次变化让谁的工作需要改变、为什么、下一步做什么。

## 已知限制与待办
- [ ] 需确认具体 Gitee 版本/私有化部署的事件字段与企业 WebHook 能力。
- [ ] 需确定设计原型产品、版本发布机制和页面/组件命名规范。
- [ ] 未对商业产品做价格、数据合规和私有化 PoC；矩阵只比较公开能力。
- [ ] 未验证 Gitee 对 PR `action` 的所有实际取值，应以真实事件样本建立契约测试。
- [ ] 自动修复的安全边界、密钥隔离、分支权限和审计策略待方案设计。

## 变更历史
| 日期 | 变更 | 关联需求 / bug |
|---|---|---|
| 2026-09-24 | 完成 GitHub、Google、arXiv 与官方文档调研，输出产品矩阵、研究依据、机会缺口和 MVP 建议 | “Gitee 变化全局同步与自动修复”想法调研 |
