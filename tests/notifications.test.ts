import test from "node:test";
import assert from "node:assert/strict";
import { buildImpactCard } from "../src/server/feishu.js";
import { analyzeEvent, isOperationalModule } from "../src/server/impact.js";
import { execute, queryOne } from "../src/server/db.js";
import { seed } from "../src/server/seed.js";

seed();

test("Feishu impact card is compact and excludes demo/import data", () => {
  const impacts = Array.from({ length: 20 }, (_, index) => ({
    severity: index === 0 ? "blocking" : "contract",
    reason: index === 18 ? "[示例] 示例模块" : index === 19 ? "[旧导入] 旧模块" : `影响模块「模块 ${index + 1}」：契约。`,
    nextAction: "检查契约"
  }));
  const card = buildImpactCard("测试变更", impacts);
  assert.ok(card.length < 1200);
  assert.equal(card.includes("[示例]"), false);
  assert.equal(card.includes("[旧导入]"), false);
  assert.ok(card.includes("其余 12 项"));
  assert.ok(card.includes("详情：GiteeHelper 控制台"));
});

test("generic document words do not match every module", () => {
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
