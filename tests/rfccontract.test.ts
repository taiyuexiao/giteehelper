import test from "node:test";
import assert from "node:assert/strict";
import { codePatternsOfScopes, docPatternsOfSlug, moduleKeyOfRef, parseRfcMeta, workRefOf } from "../src/server/rfccontract.js";
import { wildcardMatch } from "../src/server/impact.js";

const meta = {
  rfc: "20260914-scoring-jobs-and-scores",
  title: "自动评分与重新评分、单题得分",
  status: "accepted",
  level: "实施 RFC",
  authors: ["袁毅堂（原作者）", "顾乡（修订责任人）"],
  related: [
    { relation: "depends_on", ref: "./20260911-scoring-rule-library.mdx", scope: "冻结评分规则" },
    { relation: "extends", ref: "./20260904-evaluation-domain-contract.md" }
  ],
  tasks: [
    {
      id: "T1",
      ref: "BOSC-0100#T1",
      scope: "建三张表；实现 ScoringTaskService、ScoringTriggerApi 与 ScoringTaskWorker。文件：迁移 V20260918094500__scoring_jobs_and_scores.sql；测试：ScoringTaskServiceTest、ScoringTaskApiIT。"
    },
    { id: "T2", ref: "BOSC-0100#T2", scope: "实现 /v1/api/scoring-tasks/rescore，复用 ScoringTaskService。" },
    { id: "T3", ref: "NotAWorkItem", scope: "无编号任务不该产生工作项" }
  ]
};

test("工作项编号解析覆盖 BOSC 前缀与裸编号", () => {
  assert.equal(workRefOf("BOSC-0100#T1"), "bosc-0100");
  assert.equal(workRefOf("WS-2804"), "ws-2804");
  assert.equal(moduleKeyOfRef("BOSC-0100#T1"), "work-bosc-0100");
  assert.equal(workRefOf("NotAWorkItem"), null);
});

test("RFC 三件套模式覆盖正文、meta 与附件", () => {
  const patterns = docPatternsOfSlug("20260914-scoring-jobs-and-scores");
  assert.ok(patterns.includes("docs/rfcs/20260914-scoring-jobs-and-scores.mdx"));
  assert.ok(patterns.includes("docs/rfcs/meta/20260914-scoring-jobs-and-scores.json"));
  assert.ok(patterns.some((pattern) => pattern.endsWith("/**")), "附件目录要有递归模式");
  assert.ok(wildcardMatch("docs/rfcs/assets/20260914-scoring-jobs-and-scores/spec/data-model.json", "docs/rfcs/assets/20260914-scoring-jobs-and-scores/**"));
});

test("从 RFC meta 反查出工作项、作者与依赖边", () => {
  const tree = [
    "src/main/java/com/bosc/ageval/service/scoring/ScoringTaskService.java",
    "src/main/resources/db/migration/V20260918094500__scoring_jobs_and_scores.sql",
    "docs/rfcs/20260914-scoring-jobs-and-scores.mdx"
  ];
  const contract = parseRfcMeta("docs/rfcs/meta/20260914-scoring-jobs-and-scores.json", meta, tree)!;
  assert.equal(contract.slug, "20260914-scoring-jobs-and-scores");
  assert.deepEqual(contract.workRefs, ["BOSC-0100"], "只认能解析成工作项的 ref");
  assert.equal(contract.taskCount, 3);
  assert.ok(contract.authors.some((author) => author.includes("袁毅堂")));
  assert.deepEqual(
    contract.related.map((item) => `${item.relation}:${item.ref}`),
    ["depends_on:20260911-scoring-rule-library", "extends:20260904-evaluation-domain-contract"]
  );
  // 已存在的类与迁移文件才生成模式；未落地的不生成死模式
  assert.ok(contract.codePatterns.some((pattern) => pattern.endsWith("ScoringTaskService.java")));
  assert.ok(contract.codePatterns.some((pattern) => pattern.endsWith("__scoring_jobs_and_scores.sql")));
  assert.equal(contract.codePatterns.some((pattern) => pattern.includes("ScoringTaskApiIT")), false, "仓库里没有的测试类不应生成模式");
});

test("同名类不生成模式，避免张冠李戴", () => {
  const tree = ["a/ScoringTaskService.java", "b/ScoringTaskService.java"];
  const patterns = codePatternsOfScopes(["实现 ScoringTaskService 与 ScoringTaskWorker。"], tree);
  assert.deepEqual(patterns, [], "同名类必须靠目录区分，不能猜");
  const single = codePatternsOfScopes(["实现 ScoringTaskWorker。"], ["a/ScoringTaskWorker.java"]);
  assert.deepEqual(single, ["**/ScoringTaskWorker.java"]);
});
