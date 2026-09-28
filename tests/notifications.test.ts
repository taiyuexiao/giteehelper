import test from "node:test";
import assert from "node:assert/strict";
import { buildCommitImpactCard } from "../src/server/feishu.js";
import { analyzeEvent, isOperationalModule, tokenize } from "../src/server/impact.js";
import { execute, queryOne } from "../src/server/db.js";
import { seed } from "../src/server/seed.js";

seed();

test("提交影响卡片按负责人分组，并给出提交者邮箱与链接", () => {
  const card = buildCommitImpactCard(
    [{
      shortSha: "abc12345",
      summary: "修复缺陷（WS-2283）：修正缓存穿透",
      authorName: "Liu Chengyan",
      authorEmail: "liuchy@bosc.cn",
      url: "https://gitee.com/x/y/commit/abc12345",
      branch: "main",
      committedAt: new Date().toISOString(),
      linkCount: 3
    }],
    [
      { moduleName: "题库 · 评测集本体", owner: "刘成彦", severity: "implementation" },
      { moduleName: "题库 · 删除评测集", owner: "刘成彦", severity: "implementation" },
      { moduleName: "底座 · 数据库换成 MySQL 8", owner: "顾乡", severity: "contract" }
    ],
    { baseUrl: "http://host/giteehelper" }
  );
  assert.ok(card.includes("liuchy@bosc.cn"), "必须给出提交者邮箱（共用账号时账号名没有区分度）");
  assert.ok(card.includes("https://gitee.com/x/y/commit/abc12345"), "必须给出可点击的提交链接");
  assert.ok(card.includes("影响 2 人 · 3 个工作项"));
  assert.ok(card.includes("▸ 刘成彦") && card.includes("▸ 顾乡"), "按人分组");
  assert.ok(card.includes("题库 · 评测集本体"), "列出具体工作项");
  assert.ok(card.includes("⚠"), "契约级要标出来");
  assert.ok(card.includes("http://host/giteehelper/repo"), "给出控制台链接");
  assert.ok(card.length < 1400);
});

test("没有命中任何模块时也要明确说明", () => {
  const card = buildCommitImpactCard(
    [{ shortSha: "a", summary: "chore: 调整", authorName: "X", authorEmail: "x@y.z", url: null, branch: "main", committedAt: null, linkCount: 0 }],
    []
  );
  assert.ok(card.includes("没有命中"));
  assert.ok(card.includes("x@y.z"));
});

test("跨虚词的切词碎片不再参与匹配", () => {
  // 「与安全」「项目与」「的测试」这类不是词，是 n-gram 切过连词/助词的产物
  const terms = tokenize("项目与权限的测试与安全校验");
  for (const junk of ["与安全", "项目与", "的测试", "与权限", "与校验"]) {
    assert.equal(terms.includes(junk), false, `${junk} 不该作为候选词`);
  }
  assert.ok(terms.includes("安全校验") || terms.includes("安全"), "真实词要保留");
});

test("通用文档词不会把每个模块都拉进来", () => {
  assert.equal(isOperationalModule({ moduleKey: "demo", name: "[示例] 模块" }), false);
  assert.equal(isOperationalModule({ moduleKey: "legacy", name: "[旧导入] 模块" }), false);

  const projectId = queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)!.id;
  const inserted = execute(
    `INSERT INTO modules (project_id, module_key, name, status, paths_json, scenarios_json, provides_json, requires_json, description)
     VALUES (?, 'generic-doc-module', '泛化文档模块', 'not_started', '[]', '[]', '[]', '[]', ?)`,
    [projectId, "包含功能、文档、数据和项目内容。"]
  );
  const moduleId = Number(inserted.lastInsertRowid);
  try {
    const result = analyzeEvent({
      source: "gitee",
      sourceId: `generic-${Date.now()}`,
      eventType: "pull_request",
      action: "open",
      title: "功能文档数据项目更新",
      author: "tester",
      branch: "feature/docs",
      payload: { files: [], body: "功能文档数据项目更新" }
    });
    assert.equal(result.impacts.some((impact) => impact.moduleId === moduleId), false);
  } finally {
    execute(`DELETE FROM impacts WHERE module_id = ?`, [moduleId]);
    execute(`DELETE FROM modules WHERE id = ?`, [moduleId]);
  }
});
