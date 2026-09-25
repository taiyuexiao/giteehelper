# 模块：影响分析、增量联调与修复

> 状态：✅ MVP 已实现
> 最近更新：2026-09-26

## 摘要
该模块把 Gitee 变化转成可解释影响，并按一跳依赖和共享场景生成最小联调组合。缺失依赖用契约桩验证；修复建议封装为 Repair Bundle，必须本地测试和人工批准。

## 关键文件
- `src/server/impact.ts`
- `src/server/integration.ts`
- `src/server/repair.ts`
- `src/cli/index.ts`

## 影响分析
1. 从 payload 收集路径、正文、标题和评论；
2. 根据路径/关键词分类为需求、规范、契约、实现或 Review；
3. 匹配模块路径、描述、契约和共享场景；
4. 叠加规则严重度；
5. 生成 `evidence` 与 `nextAction`；
6. 无明确模块但达到 `blocking/contract/clarification` 时生成“未归属”影响。

严重度：`blocking > contract > implementation > clarification > informational`。

## 增量联调
- 目标模块自身为 `real`；
- `requires` 有真实 provider 时使用 `real`；
- provider 缺席时生成契约 Stub；
- 共享场景模块加入最小切片；
- 无依赖、无场景时不扩展组合；
- `contractVerified` 与 `sliceIntegrated` 分开记录。

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
- `frontend` 联调可同时记录真实模块和契约桩；
- Repair Bundle 包含 patch、来源和 `directWriteAllowed: false`；
- CLI `manifest validate`、`contract test` 可运行。

## 已知限制
- 影响分析目前为规则与证据驱动，不调用大模型；
- Repair.diff 在示例数据中是模板，真实修复需 Agent 生成具体代码；
- 版本兼容只实现基础匹配，尚未完成完整 SemVer 求解；
- 自动 PR 需要批准且要求 Gitee Token/Repo 配置。

## 变更历史
| 日期 | 变更 | 关联需求 |
|---|---|---|
| 2026-09-26 | 完成规则影响、证据链、一跳联调、Stub、Repair Bundle 和审批边界 | 实施阶段 3、4 |
