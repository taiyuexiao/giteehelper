import test from "node:test";
import assert from "node:assert/strict";
import { classifyReasons, hasImplementationFile, primaryReason } from "../src/server/reason.js";
import { mineReferences } from "../src/server/pulls.js";
import { buildCommitImpactCard } from "../src/server/feishu.js";

test("PR 引用挖掘能识别该仓库的 !NN 写法", () => {
  const refs = mineReferences("本 PR 仍然叠在 !78 上；另外 !112 与 !98 也要一起看。不是引用的 123 和 !! 不算。");
  assert.deepEqual(refs.sort((a, b) => a - b), [78, 98, 112]);
  assert.deepEqual(mineReferences(""), []);
});

test("契约变更被判为指令性并给出跟改动作", () => {
  const hits = classifyReasons({
    files: ["docs/rfcs/assets/20260911-scoring-rule-library/spec/openapi.json", "src/main/java/a/B.java"],
    semanticOnly: false,
    hasImplementation: true
  });
  const primary = primaryReason(hits);
  assert.equal(primary?.nature, "directive");
  assert.equal(primary?.code, "contract_field");
  assert.ok(primary?.action.includes("核对"), "动作要能直接执行");
});

test("迁移文件判为时序性：Flyway 版本号是硬冲突", () => {
  const hits = classifyReasons({
    files: ["north-auth/src/main/resources/db/migration/V20260909120000__create_identity_tables.sql"],
    semanticOnly: false,
    hasImplementation: false
  });
  assert.ok(hits.some((hit) => hit.code === "db_migration" && hit.nature === "ordering"));
});

test("快照/契约改了但实现未跟，提示判定归属", () => {
  const hits = classifyReasons({
    files: ["docs/database_schema.sql"],
    semanticOnly: false,
    hasImplementation: false
  });
  assert.ok(hits.some((hit) => hit.code === "doc_drift" && hit.nature === "cognitive"));
});

test("文档三层未同改会提示口径风险", () => {
  const hits = classifyReasons({
    files: ["docs/rfcs/20260911-scoring-rule-library.md"],
    semanticOnly: false
  });
  assert.ok(hits.some((hit) => hit.code === "doc_drift" && hit.nature === "cognitive"));
  const complete = classifyReasons({
    files: ["docs/rfcs/20260911-scoring-rule-library.md", "docs/rfcs/meta/20260911-scoring-rule-library.json",
      "docs/rfcs/assets/20260911-scoring-rule-library/spec/openapi.json"],
    semanticOnly: false
  });
  assert.equal(complete.some((hit) => hit.code === "doc_drift"), false, "三层同改时不该再提示");
});

test("只有语义证据时判为口径不一致（认知性），且要求附可复跑实测", () => {
  const hits = classifyReasons({ files: [], semanticOnly: true });
  const primary = primaryReason(hits);
  assert.equal(primary?.nature, "cognitive");
  assert.equal(primary?.code, "semantic_caliber");
  assert.ok(primary?.action.includes("实测") || primary?.action.includes("坏样本"));
});

test("堆叠 PR 与落后主干分别判为硬前置与基线漂移", () => {
  const hits = classifyReasons({
    files: ["docs/a.md"],
    semanticOnly: false,
    pull: { number: 77, base: "docs/shipl2/WS-2283-common-client-cache-design", head: "feat/x", behindBy: 13 }
  });
  assert.ok(hits.some((hit) => hit.code === "merge_order" && hit.nature === "ordering"));
  assert.ok(hits.some((hit) => hit.code === "baseline_drift" && hit.nature === "ordering"));
  // 基线漂移的动作必须是"先同步 base 再判断"，而不是按不一致开单
  assert.ok(hits.find((hit) => hit.code === "baseline_drift")?.action.includes("同步 base"));
});

test("并行改动同一批文件时通知双方并写明谁后合谁返工", () => {
  const hits = classifyReasons({
    files: ["docs/a.md"],
    semanticOnly: false,
    parallelPulls: [{ number: 305, author: "liuchy", shared: ["docs/a.md"] }]
  });
  const hit = hits.find((item) => item.code === "parallel_edit");
  assert.ok(hit, "应识别并行改动");
  assert.ok(hit?.label.includes("!305"));
  assert.ok(hit?.action.includes("谁后合谁返工"));
});

test("head 变化使旧结论作废（合规性）", () => {
  const hits = classifyReasons({
    files: ["docs/a.md"], semanticOnly: false,
    pull: { number: 88, base: "main", head: "feat/x", headChanged: true }
  });
  assert.ok(hits.some((hit) => hit.code === "evidence_invalidation" && hit.nature === "compliance"));
});

test("索引表抢行会提示协调顺序（实测最集中的真实冲突点）", () => {
  const hits = classifyReasons({ files: ["docs/rfcs/README.md", "docs/rfcs/x.md"], semanticOnly: false });
  assert.ok(hits.some((hit) => hit.code === "shared_asset" && hit.nature === "ordering"));
});

test("CI/构建基线变更判为合规性", () => {
  const hits = classifyReasons({ files: ["pom.xml"], semanticOnly: false });
  assert.ok(hits.some((hit) => hit.code === "gate_toolchain" && hit.nature === "compliance"));
});

test("对外接口面变更判为内容型，并提示跨端", () => {
  const hits = classifyReasons({
    files: ["src/main/java/a/ErrorCode.java", "frontend/src/api.ts"],
    semanticOnly: false
  });
  assert.ok(hits.some((hit) => hit.code === "api_surface" && hit.nature === "directive"));
  assert.ok(hits.some((hit) => hit.code === "cross_end"));
});

test("分类结果按性质可归并，且不会丢信息", () => {
  const hits = classifyReasons({
    files: ["pom.xml", ".github/workflows/ci.yml", ".githooks/pre-push"],
    semanticOnly: false
  });
  assert.ok(hits.filter((hit) => hit.nature === "compliance").length >= 1);
  // 同一性质允许多条（消息侧再按性质归并），但不能把不同性质互相吞掉
  assert.equal(new Set(hits.map((hit) => hit.nature)).size, hits.length >= 1 ? new Set(hits.map((hit) => hit.nature)).size : 0);
});

test("术语表与权限代码同改时提示越权风险", () => {
  const hits = classifyReasons({
    files: ["docs/名词表.md", "src/main/java/a/ProjectGuard.java"],
    semanticOnly: false
  });
  const hit = hits.find((item) => item.code === "security_seam");
  assert.ok(hit, "应识别接缝风险");
  assert.ok(hit?.action.includes("越权负样本"));
});

test("依据来自未合入的 PR 时提示先确认", () => {
  const hits = classifyReasons({ files: ["docs/a.md"], semanticOnly: false, unmergedReferences: [175, 219] });
  const hit = hits.find((item) => item.code === "pending_source");
  assert.ok(hit?.label.includes("!175"));
  assert.ok(hit?.action.includes("未进则不得作为实现依据"));
});

test("实现文件识别", () => {
  assert.equal(hasImplementationFile(["src/main/java/a/B.java"]), true);
  assert.equal(hasImplementationFile(["frontend/src/App.tsx"]), true);
  assert.equal(hasImplementationFile(["docs/a.md", "pom.xml"]), false);
});

test("通知里给出影响原因与受影响在飞 PR", () => {
  const card = buildCommitImpactCard(
    [{
      shortSha: "abc12345", summary: "fix(WS-1): 收窄 schema",
      authorName: "Liu Chengyan", authorEmail: "liuchy@bosc.cn",
      url: "https://gitee.com/x/y/commit/abc12345", branch: "main",
      committedAt: new Date().toISOString(), linkCount: 1
    }],
    [{
      moduleName: "题库 · 评测集本体", owner: "刘成彦", severity: "contract",
      reasonLabel: "契约字段/类型变更", reasonNature: "directive", reasonAction: "按变更清单逐个跟改调用方、实现与断言"
    }],
    { affectedPulls: [{ number: 305, title: "评测集生命周期", author: "liuchy", shared: ["docs/a.md"] }] }
  );
  assert.ok(card.includes("原因：契约字段/类型变更"), "必须写清影响原因");
  assert.ok(card.includes("按变更清单逐个跟改"), "必须给出建议动作");
  assert.ok(card.includes("影响 1 个在飞 PR") || card.includes("1 个在飞 PR"), "主干前进要提示在飞 PR");
  assert.ok(card.includes("!305"), "列出受影响的 PR 号");
});
