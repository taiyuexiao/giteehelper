# 模块：影响分析、增量联调与修复

> 状态：✅ MVP 已实现（2026-09-28 收紧匹配并支持提交粒度）
> 最近更新：2026-09-28

## 摘要
该模块把 Gitee 变化转成可解释影响，并按一跳依赖和共享场景生成最小联调组合。缺失依赖用契约桩验证；修复建议封装为 Repair Bundle，必须本地测试和人工批准。

## 关键文件
- `src/server/impact.ts`
- `src/server/integration.ts`
- `src/server/commits.ts`（提交粒度分析与冲突判定）
- `src/server/repair.ts`
- `src/cli/index.ts`

## 影响分析
1. 从 payload 收集路径、正文、标题和评论；
2. 根据路径/关键词分类为需求、规范、契约、实现或 Review；
3. 匹配模块路径、描述、契约和共享场景；
4. 叠加规则严重度；
5. 生成 `evidence` 与 `nextAction`；
6. 无明确模块但达到 `blocking/contract/clarification` 时生成“未归属”影响；
7. 示例/旧导入模块不参与影响分析；
8. 飞书摘要最多展示 6 个模块，其余合并计数，避免单个事件刷屏。

### 模块匹配规则（2026-09-28 收紧，已按真实仓库数据校准）
- **路径**：通配符按标准 glob 翻译，`**` 跨目录、`*` 只匹配单层路径段、`?` 匹配单字符。旧实现先把 `**` 换成 `.*`、再把 `*` 换成 `[^/]*`，把 `.*` 二次拆坏，导致 `src/server/**` 只能匹配一层目录，深层文件全部漏配。
- **语义**：只看模块名、模块 Key 和共享场景，**不再匹配契约 Key**，否则 `api.order.v1` 会让 "api" 这种通用词命中所有后端模块。
- **分词**：拉丁词按整词取长度 ≥ 3；中文没有空格，按 2–4 字 n-gram 切分，否则中文标题几乎无法与模块名匹配。
- **停用词**：api、docs、review、pr、fix、feat、更新、新增、修复、调整 等通用变更用语不构成证据；由通用词拼出的复合词同样忽略。
- **区分度剪枝**：同时命中过多模块的语义词（命中数 ≥ 3 且超过模块总数一半）判定为无区分度并丢弃，避免横跨全仓的通用目录名把整仓拉进来。
- **不再使用模块描述匹配**：描述可能是导入的整段中文工作项正文（真实仓库中 146 个模块有 142 个描述超过 40 字），任何中文提交都能在里面凑出两个"强语义词"，曾导致一条提交命中 81 个模块。需要按描述匹配时应改为配置路径模式或场景。
- **首尾是虚词的切词碎片直接丢弃**：中文 n-gram 会把连词/助词切进片段，产生「与安全」「项目与」「的测试」这类根本不是词的碎片，它们会去命中长模块名。实测这类碎片在真实仓库里命中过 100+ 次，过滤后全局影响从 1668 条降到 1132 条。
- **2 字中文词只允许精确相等**：`部署` 不应因为某个工作项叫「底座 · 目标环境重复部署与回退演练」而命中它；3 字及以上才允许子串匹配。
- **语义词频率上限**：命中模块数超过模块总数 5%（至少 2 个）的词视为无区分度并丢弃。此前阈值是模块数的一半，在 146 个模块时等于允许命中 73 个。
- **区域级共用路径收敛**：同一个路径模式被超过 2 个模块共用时（真实仓库中 25 个工作项共用 `backend/src/main/java/**/dataset/**`），它只能说明"某个区域变了"。这种只靠共用模式命中的模块会收敛成**一条区域影响**（`moduleId` 为空，原因里给出区域内工作项数量），而不是给区域里几十个负责人同时发通知。
- **有区分度的路径优先**：同一文件同时命中"模块专有模式"和"区域共用模式"时按专有模式处理。
- **测试文件不算契约**：`DatabaseSchemaSnapshotTest.java` 只因为文件名带 `Schema` 就被判成契约级，会把纯测试提交升级成"阻塞"；`/test/`、`.test.ts`、`Test.java` 等路径不再触发契约判定。
- **PR 事件用真实路径**：PR 回调没有文件清单，改为回查 `pulls/{number}/files`，从"拿正文猜"变成"按路径归属"。
- **提交等价 push**：`eventType=commit` 会同时匹配面向 `push` 的规则，保证「主干文档变化必须评估下游」这类规则在提交粒度上同样生效。

严重度：`blocking > contract > implementation > clarification > informational`。

### 提交粒度
Push 事件按 `commits[]` 逐条建立事件与影响，因此「哪个提交、谁的提交、影响了哪个模块、下一步做什么」可以逐条追溯，而不是把一次 push 混成一条记录。同一 sha 重复投递不会重复分析或重复通知。

## 增量联调
- 目标模块自身为 `real`；
- `requires` 有真实 provider 时使用 `real`；
- provider 缺席时生成契约 Stub；
- 共享场景模块加入最小切片；
- 无依赖、无场景时不扩展组合；
- `contractVerified`、`executionVerified` 与 `sliceIntegrated` 分开记录；
- 未执行真实测试命令时状态只能是 `blocked`，不得标记 `passed`；
- `contractVerified` 为真实计算结果：逐条检查必需契约是否已注册且版本兼容，未满足的契约写入 `missingContracts`，不再恒为 `true`；
- 契约版本按语义化范围判断：`^1.0` 接受 `1.1`、`~1.2.0` 接受 `1.2.3`，并支持 `>=`、`<=`、`>`、`<`、`*` 与精确版本；
- 只有 `RUN_MODULE_TESTS=1` 时才真正执行模块的 `testCommand`；默认只记录契约组合，避免在服务进程里执行任意命令；
- 清理历史误导数据：`npm run cli -- cleanup misleading-data`。

## Repair Bundle
```text
repair.diff
tests.patch
test-report.json
commands.md
provenance.json
README.md
```

CLI 流程：

```bash
giteehelper repair create <impact-id>
giteehelper repair review <repair-id>
giteehelper repair apply <repair-id>
giteehelper repair test <repair-id>
giteehelper repair approve <repair-id>
```

批准只授权创建修复分支/PR，禁止直接写入主干。

## 验证
- 文档 PR/规范合并可产生 blocking 影响；
- Review 评论变更信号可产生 clarification；
- 未配置并执行测试命令时，运行记录为 `blocked` 且 `executionVerified=false`；
- `frontend` 联调可同时记录真实模块和契约桩；
- Repair Bundle 包含 patch、来源和 `directWriteAllowed: false`；
- CLI `manifest validate`、`contract test` 可运行。

## 已知限制
- 影响分析目前为规则与证据驱动，不调用大模型；
- Repair.diff 在示例数据中是模板，真实修复需 Agent 生成具体代码；
- 版本兼容已支持常用语义化范围（`^`、`~`、比较符、精确版本），但未实现完整 SemVer 求解（预发布号、多范围并集、冲突求解）；
- 模块归属依赖路径模式与模块名，路径模式没配全时提交会落入「未归属」；
- 自动 PR 需要批准且要求 Gitee Token/Repo 配置。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成规则影响、证据链、一跳联调、Stub、Repair Bundle 和审批边界 | 实施阶段 3、4 |
| 2026-09-27 | 禁止契约组合检查误报为通过，并新增误导运行/旧导入清理 | 联调真实性 |
| 2026-09-28 | 收紧模块语义匹配并压缩飞书摘要 | 通知降噪 |
| 2026-09-28 | 修复 glob 深层路径漏配；中文按 n-gram 分词；无区分度语义词剪枝 | 归属准确度 |
| 2026-09-28 | 契约版本改为语义化范围判断，`contractVerified` 由真实校验计算 | 联调真实性 |
| 2026-09-28 | 新增提交粒度事件与冲突判定，按冲突对象触发飞书提醒 | 仓库全景与实时分析 |
