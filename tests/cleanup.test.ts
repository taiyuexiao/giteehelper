import test from "node:test";
import assert from "node:assert/strict";
import { cleanupMisleadingData } from "../src/server/cleanup.js";
import { execute, queryOne } from "../src/server/db.js";
import { seed } from "../src/server/seed.js";

seed();

test("cleanup removes misleading runs and legacy import rows", () => {
  const projectId = queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)!.id;
  const fake = execute(
    `INSERT INTO integration_runs (project_id, module_key, status, combination_json, result_json)
     VALUES (?, 'cleanup-fake', 'passed', '[]', ?)`,
    [projectId, JSON.stringify({ contractVerified: true, testOutput: "" })]
  );
  const real = execute(
    `INSERT INTO integration_runs (project_id, module_key, status, combination_json, result_json)
     VALUES (?, 'cleanup-real', 'passed', '[]', ?)`,
    [projectId, JSON.stringify({ executionVerified: true, command: "npm test", testOutput: "ok" })]
  );
  const legacyModule = execute(
    `INSERT INTO modules (project_id, module_key, name, status, provides_json, requires_json)
     VALUES (?, 'cleanup-legacy-module', '[旧导入] 模块', 'not_started', ?, ?)`,
    [projectId, JSON.stringify([{ key: "[旧导入] api", version: "1.0" }]), JSON.stringify([])]
  );
  execute(
    `INSERT INTO contracts (project_id, contract_key, version, kind, schema_json)
     VALUES (?, '[旧导入] api', '1.0', 'api', '{}')`,
    [projectId]
  );

  const summary = cleanupMisleadingData();

  assert.ok(summary.integrationRuns >= 1);
  assert.equal(summary.legacyModules >= 1, true);
  assert.equal(summary.legacyContracts >= 1, true);
  assert.equal(queryOne(`SELECT id FROM integration_runs WHERE id = ?`, [Number(fake.lastInsertRowid)]), undefined);
  assert.ok(queryOne(`SELECT id FROM integration_runs WHERE id = ?`, [Number(real.lastInsertRowid)]));
  assert.equal(queryOne(`SELECT id FROM modules WHERE id = ?`, [Number(legacyModule.lastInsertRowid)]), undefined);
  execute(`DELETE FROM integration_runs WHERE id = ?`, [Number(real.lastInsertRowid)]);
});
