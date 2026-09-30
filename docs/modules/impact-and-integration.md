# 模块：影响分析、增量联调与修复

> 状态：✅ MVP 已实现（2026-09-28 起按真实仓库校准，含影响原因分类、契约即代码与 PR 依赖图）
> 最近更新：2026-09-29

## 摘要
该模块把 Gitee 变化转成可解释影响：每条影响带**原因分类**（为什么受影响、下一步做什么）和**证据分档**（路径证据=确定 / 仅语义=线索）。归属精度靠三根支柱维护：路径模式体检、RFC 契约反查、PR 文件回填。在此之上按一跳依赖和共享场景生成最小联调组合，缺失依赖用契约桩验证；修复建议封装为 Repair Bundle，必须本地测试和人工批准。

## 关键文件
- `src/server/impact.ts`（匹配引擎：glob、分词、区域收敛、证据）
- `src/server/reason.ts`（影响原因分类：4 种性质 × 16 个代码）
- `src/server/repohealth.ts`（路径模式体检与机械修复）
- `src/server/rfccontract.ts`（契约即代码：RFC meta 反查归属）
- `src/server/pulls.ts`（PR 级数据：同步、引用挖掘、主干前进、文件回填）
- `src/server/integration.ts`（增量联调）
- `src/server/commits.ts`（提交粒度分析、冲突判定、reanalyze）
- `src/server/repair.ts`
- `src/cli/index.ts`

## 影响分析管线
1. 从 payload 收集路径、正文、标题和评论（PR/评论事件由接入层回查补齐文件列表）；
2. 根据路径/关键词分类为需求、规范、契约、实现或 Review；
3. 匹配模块路径、模块名和共享场景，叠加规则严重度；
4. `classifyReasons()` 生成影响原因，`primaryReason()` 选一条主原因；
5. 生成 `evidence` 与 `nextAction`（优先用原因分类的 action）；
6. 无明确模块但达到 `blocking/contract/clarification` 时生成"未归属"影响；
7. `[示例]`/`[旧导入]` 模块不参与影响分析；
8. impacts 落库时写入 `reason_code`，通知层用 `describeImpacts()` 反查负责人并推导 grounded/线索。

严重度：`blocking > contract > implementation > clarification > informational`。

### 模块匹配规则（2026-09-28 起按真实仓库数据校准）
- **路径**：通配符按标准 glob 翻译，`**` 跨目录、`*` 只匹配单层路径段、`?` 匹配单字符。旧实现先把 `**` 换成 `.*`、再把 `*` 换成 `[^/]*`，把 `.*` 二次拆坏，导致 `src/server/**` 只能匹配一层目录，深层文件全部漏配。
- **语义**：只看模块名、模块 Key 和共享场景，**不再匹配契约 Key 与模块描述**。契约 Key 会让 "api" 这类通用词命中所有后端模块；描述是导入的整段中文正文，任何中文提交都能凑出两个"强语义词"（曾导致一条提交命中 81 个模块）。
- **分词**：拉丁词按整词取长度 ≥ 3；中文按 2–4 字 n-gram 切分，首尾是虚词的碎片（「与安全」「项目与」）直接丢弃。
- **停用词与区分度**：api、docs、更新、修复等通用词不构成证据；语义词命中模块数超过总数 5%（至少 2 个）即判无区分度丢弃；**2 字中文词只允许与模块名精确相等**（`部署` ⊂ 某长模块名不算命中），3 字起才允许子串。
- **测试文件不算契约**：`/test/`、`.test.ts`、`Test.java` 不触发契约判定，避免纯测试提交被升级成阻塞。
- **提交等价 push**：`eventType=commit` 同时匹配面向 `push` 的规则。
- **区域级共用路径收敛**：被超过 2 个模块共用的路径模式只能说明"某个区域变了"。只靠共用模式命中的模块收敛成**一条区域影响**，不给区域内几十个负责人同时发通知。收敛判据是「是否被专有模式或语义词定位到」（`specific`），**不看证据类型**——共用模式命中的文件也会保留路径证据（标注「区域共用模式」），否则影响看起来像凭空推断。区域内工作项若只有一位负责人，区域影响直接落到他名下（`userId` 指向该负责人），多人时才退回区域级提醒。
- **证据折叠**：单条影响最多保留 5 条路径证据，其余折叠成计数，避免 `evidence_json` 无限膨胀。

### 证据分档：确定 vs 线索
`describeImpacts()` 按影响证据推导 `grounded`：
- 有 `type: "path"` 证据 → `grounded=true`，通知里可列具体文件，是**确定**影响；
- 只有语义/区域场景证据 → `grounded=false`，通知里标注「（线索）」，原因使用认知性表述，**不挂 ⚠ 需确认**（只有 grounded 的契约/阻塞级才算冲突——实测一次评分 PR 15 条线索一起报警、9 人同时收到"⚠ 需确认"就是教训）。

### 影响原因分类（`reason.ts`）
分类来自对该仓库 315 个 PR、960 条评审评论的通读归纳，不是通用软件工程常识。分类轴是**下一步动作**（收到通知后要做的事完全不同），全部基于文件路径、提交信息与 PR 上下文做确定性判定，不调用大模型。

| 性质 | 含义 | 代码 |
|---|---|---|
| directive 需要跟改 | 有人必须改代码/文档 | `contract_field` 契约字段、`identifier_rename` 改名/退役、`api_surface` 路由/封套/错误码、`cross_end` 跨端封套 |
| ordering 需要协调顺序 | 不改内容，协调合入顺序/抢占文件 | `db_migration` 迁移版本、`shared_asset` 共享文件抢行、`merge_order` 堆叠/前置、`parallel_edit` 并行改同文件、`baseline_drift` 分支落后主干 |
| cognitive 需要人工拍板口径 | 机器判不了，人拍板 | `semantic_caliber` 口径不一致、`security_seam` 术语指错接缝（越权风险）、`doc_drift` 文档三层未同改/快照漂移 |
| compliance 需要补证据 | 补证据、过门禁、按基线重验 | `gate_toolchain` 门禁/工具链、`gate_self_blind` CI 自证盲区、`evidence_invalidation` head 变化旧结论作废、`pending_source` 依据来自未合入 PR |

- `primaryReason()` 按 directive > ordering > cognitive > compliance 取第一条作为主原因（最该先做的），完整清单见控制台 `/api/reasons`。
- **semanticOnly 防线**：影响只有语义证据时，即使事件改了契约文件也不套用 `contract_field`（指令性结论），改判 `semantic_caliber`（认知性）：「上游契约变了，本模块只是语义相关 → 先确认本模块是否读写该契约」。
- 上下文输入：变更文件、semanticOnly、标题、在飞 PR（base/head/behindBy/headChanged）、并行改同文件的 PR、未合入的 `!NN` 引用。

## 归属三支柱
归属精度取决于**能不能拿到变更文件**和**模式能不能命中它**。三者按「体检 → 补契约 → 补文件」的顺序使用：

### 1. 路径模式体检（`repohealth.ts`）
- `pattern-health`：拉取仓库真实文件树（git trees API），对每个模块的模式统计命中数，判 `ok` / `partial` / `dead`；同时报告「幽灵前缀」（模式里写了但仓库不存在的目录，如 `backend/`、`docs/modules/`）。存在 dead 模式时命令返回非零退出码。
- `pattern-fix`：只自动应用**机械修复**（去掉 `backend/` 这类冗余前缀，语义不变）；`docs/modules/** → docs/rfcs/*<领域>*` 这类文档侧改写会改变匹配语义，必须 `--include-review` 显式确认。
- 实测：某仓库 142 个模块模式全部失效（两个目录根本不存在）；机械修复恢复 41 个，含文档侧改写共 80 个，覆盖文件 732→947、覆盖事件 7%→33%。

### 2. 契约即代码（`rfccontract.ts`）
人写的模式会腐烂，但 `docs/rfcs/meta/*.json` 是活的契约。`rfc-sync` 只读拉取后：
- `tasks[].ref`（`BOSC-0100#T1`）→ 反查工作项 `work-bosc-0100` → 模块与负责人；
- meta 自身路径 → RFC 文档三件套模式（正文 `.mdx` / `meta/*.json` / `assets/<slug>/**`）；
- `tasks[].scope` 里**已落地**的文件与类名 → 精确代码模式。未落地的不生成（避免死模式），同名类不生成（必须靠目录区分，交人工补）；
- `related` / `requires` → 跨模块语义依赖边；
- `authors` 与工作项负责人交叉校验（`rfc-coverage` 给出吻合比例）。
- `rfc-apply` 把反查出的模式并进模块（只增不减、幂等）。实测事件覆盖率 6%→38%；仅 17/142 模块有契约背书，其余只能靠语义匹配——**精度上限在契约覆盖率，继续放宽 glob 没用**。

### 3. PR 文件回填（`pulls.ts` 的 `backfillEventFiles`）
最大归属缺口不是模式而是**事件里没有文件**：PR/评论类 WebHook payload 本就不带文件列表（实测 284 个事件里 207 个缺文件，占全部影响 60%）。回填规则：
- 默认只用库里已有的 PR 文件列表（`sync-pulls` 时落库），零 API 调用；
- `--fetch` 才按需回查 Gitee（只读，默认上限 200 次）并缓存回库；
- 评论类事件只给 `noteable_id`（Gitee 数据库 id），靠 `pull_requests.remote_id` 反查 PR 编号。
- 实测：路径证据覆盖的影响 190→554 条。回填后可跑 `reanalyze` 用新证据重算历史影响。

## PR 级依赖图与主干前进
真正需要协调的耦合大量发生在 PR 之间，不只是模块之间（实测 960 条评论里 72% 引用了其他 PR，25% 的 PR 叠在别的 PR 分支上）。
- `sync-pulls`：分页拉取全部 PR；**变更文件只对未合并 PR 拉取**（它们才是要判断冲突的对象），已合并的只留元信息与引用关系，避免几百次 API 调用；`--with-comments` 额外拉评论挖 `!NN` 互引。
- `pulls` / `/api/pulls/graph`：PR 统计与依赖图（节点为 PR，边为正文/评论引用，含 stacked、入度/出度）。
- **主干前进检测**：Push 到 main 时用本次推送的文件集合与未合并 PR 的文件求交（`pullsTouchedBy`），受影响的在飞 PR 写进通知（「这些 PR 需要合并同步后重跑门禁」）；PR 事件的并行改动（`parallel_edit`）与未合入引用（`pending_source`）也来自这里。
- **基线漂移 / 依据作废**：分支落后主干（behindBy>0）报 `baseline_drift`；PR update/synchronize 使 head 变化时报 `evidence_invalidation`（旧评审结论作废）。

## 增量联调
- 目标模块自身为 `real`；`requires` 有真实 provider 时使用 `real`，缺席时生成契约 Stub；
- 共享场景模块加入最小切片；无依赖、无场景时不扩展组合；
- `contractVerified`、`executionVerified` 与 `sliceIntegrated` 分开记录；`contractVerified` 为真实计算结果（逐条检查必需契约已注册且版本兼容，未满足写入 `missingContracts`）；
- 契约版本按语义化范围判断：`^1.0` 接受 `1.1`、`~1.2.0` 接受 `1.2.3`，支持 `>=`、`<=`、`>`、`<`、`*` 与精确版本；
- 未执行真实测试命令时状态只能是 `blocked`；只有 `RUN_MODULE_TESTS=1` 才真正执行 `testCommand`（避免在服务进程执行任意命令）；单事件自动创建的联调 Run 上限 5 条（Push 与 PR 事件同规则，防止一条 PR 影响几十个模块时刷屏）；
- 清理历史误导数据：`npm run cli -- cleanup misleading-data`。只删除「声称通过（passed）却没有执行证据」的运行——`blocked` 是如实的状态，不是误导，清一次不会丢真实运行历史。

## Repair Bundle
```text
repair.diff / tests.patch / test-report.json / commands.md / provenance.json / README.md
```

CLI 流程：`repair create <impact-id>` → `review` → `apply`（先 `git apply --check`）→ `test` → `approve`。批准只授权创建修复分支/PR，禁止直接写入主干（`directWriteAllowed: false`）。

## 验证
- `npm test` 60 项：影响匹配精度（深层路径、中文分词、停用词剪枝、2 字词精确匹配）、原因分类（口径/基线漂移/并行/越权接缝/未合入依据）、RFC 反查（三件套模式、同名类不生成）、通知分组、**提交影响自带分档（路径证据=确定 / 纯语义=线索）**、**历史 pullHead 重算（head sha 定位、事件时间界）**、契约版本、联调桩、Repair 边界；
- 生产库 `reanalyze` 后影响 510→67 条；回填文件后路径证据覆盖 190→554 条。

## 已知限制
- 规则与证据驱动，不调用大模型；「提交处理了什么问题」取决于提交信息写得是否清楚；
- 约 1500 条影响只有语义证据（事件带了文件但指向别处、模块被词面拉进来）：既有真实的跨模块未对齐也有噪声，**无法自动区分**，通知里如实标「（线索）」等人工判断；
- 仅 17/142 模块有 RFC 契约背书，提升精度要补契约，不是放宽 glob；
- 文档侧模式改写（`docs/modules/<领域>/**` → `docs/rfcs/*<slug>*`）改变匹配语义，`*run*` 类短 slug 有过度匹配风险，默认不自动应用；
- Repair.diff 真实代码生成需接入编码 Agent；
- 语义化版本未实现完整 SemVer 求解（预发布号、多范围并集、冲突求解）。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成规则影响、证据链、一跳联调、Stub、Repair Bundle 和审批边界 | 实施阶段 3、4 |
| 2026-09-27 | 禁止契约组合检查误报为通过，并新增误导运行/旧导入清理 | 联调真实性 |
| 2026-09-28 | 收紧模块语义匹配（glob 修复、n-gram、剪枝）并压缩飞书摘要 | 通知降噪 |
| 2026-09-28 | 契约版本改为语义化范围判断，`contractVerified` 由真实校验计算 | 联调真实性 |
| 2026-09-28 | 新增提交粒度事件与冲突判定 | 仓库全景与实时分析 |
| 2026-09-28 | 影响原因分类上线：4 种性质 × 16 个代码，主原因进通知 | 通知可执行性 |
| 2026-09-28 | 新增 pattern-health / pattern-fix 模式体检与机械修复 | 归属准确度 |
| 2026-09-28 | 契约即代码：rfc-sync / rfc-coverage / rfc-apply，事件覆盖 6%→38% | 归属准确度 |
| 2026-09-28 | PR 级依赖图（sync-pulls、!NN 互引、堆叠识别）与主干前进检测 | 跨 PR 协调 |
| 2026-09-28 | 区域共用路径保留路径证据、收敛判据改看 specific、单负责人区域落到人 | 归属准确度 |
| 2026-09-28 | backfill-files 回填 PR 文件到历史事件，路径证据覆盖 190→554 | 归属准确度 |
| 2026-09-29 | 线索不再套用指令性结论：semanticOnly 的契约命中改判认知性口径，只有 grounded 的契约级才算需确认冲突 | 通知可信度 |
