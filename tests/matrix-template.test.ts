import test, { after } from "node:test";
import assert from "node:assert/strict";
import { listMatrixRows, upsertMatrixRow } from "../src/server/progress.js";
import { MATRIX_TEMPLATE, seedMatrixTemplate } from "../src/server/matrixTemplate.js";
import { execute, queryOne } from "../src/server/db.js";
import { seed } from "../src/server/seed.js";

seed();

const projectId = queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)!.id;

const baseRow = {
  groupName: "测试组", itemName: "测试交付项", owner: "测试员", prNumbers: "",
  blocked: null as boolean | null, blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
  statusNote: ""
};

after(() => {
  execute(`DELETE FROM matrix_rows WHERE project_id = ?`, [projectId]);
  execute(`DELETE FROM pull_requests WHERE project_id = ? AND number = 9501`, [projectId]);
});

test("全景模板：merge 首次创建全部行，二次调用幂等", () => {
  const first = seedMatrixTemplate("merge", "tester", projectId);
  assert.equal(first.created, MATRIX_TEMPLATE.length);
  assert.equal(first.replaced, false);
  const second = seedMatrixTemplate("merge", "tester", projectId);
  assert.equal(second.created, 0);
});

test("全景模板：merge 不覆盖同名的已有自定义行", () => {
  const templateRow = MATRIX_TEMPLATE[0];
  const { id } = upsertMatrixRow(projectId, {
    ...baseRow,
    groupName: templateRow.groupName,
    itemName: templateRow.itemName,
    statusNote: "人工自定义备注"
  }, "tester");
  const result = seedMatrixTemplate("merge", "tester", projectId);
  assert.equal(result.created, 0, "模板行已全部存在，merge 不应再创建");
  const row = listMatrixRows(projectId).find((item) => item.id === id);
  assert.equal(row?.statusNote, "人工自定义备注", "merge 不得覆盖人工修改");
});

test("全景模板：replace 清空后按模板重建", () => {
  const result = seedMatrixTemplate("replace", "tester", projectId);
  assert.equal(result.replaced, true);
  assert.equal(result.created, MATRIX_TEMPLATE.length);
  const rows = listMatrixRows(projectId);
  assert.equal(rows.length, MATRIX_TEMPLATE.length);
  const templateRow = MATRIX_TEMPLATE[0];
  const rebuilt = rows.find((item) => item.groupName === templateRow.groupName && item.itemName === templateRow.itemName);
  assert.equal(rebuilt?.statusNote, templateRow.statusNote, "replace 后回到模板基线文字");
});

test("矩阵行 statusNote 往返一致", () => {
  const { id } = upsertMatrixRow(projectId, {
    ...baseRow,
    itemName: "备注往返项",
    statusNote: "主体已合入，面板在审"
  }, "tester");
  const row = listMatrixRows(projectId).find((item) => item.id === id);
  assert.equal(row?.statusNote, "主体已合入，面板在审");
  upsertMatrixRow(projectId, { ...baseRow, id, itemName: "备注往返项", statusNote: "改为：已全量交付" }, "tester");
  const updated = listMatrixRows(projectId).find((item) => item.id === id);
  assert.equal(updated?.statusNote, "改为：已全量交付");
});

test("矩阵行 PR 解析带出标题与合并日期", () => {
  execute(
    `INSERT INTO pull_requests (project_id, number, title, body, state, merged_at, files_json)
     VALUES (?, 9501, 'feat: 矩阵测试 PR', '', 'merged', '2026-10-01 10:00:00', ?)`,
    [projectId, JSON.stringify(["src/server/matrix.ts", "frontend/src/pages/Matrix.tsx"])]
  );
  const { id } = upsertMatrixRow(projectId, { ...baseRow, itemName: "PR 解析项", prNumbers: "!9501" }, "tester");
  const row = listMatrixRows(projectId).find((item) => item.id === id);
  assert.equal(row?.prs.length, 1);
  const pr = row!.prs[0];
  assert.equal(pr.number, 9501);
  assert.equal(pr.state, "merged");
  assert.equal(pr.title, "feat: 矩阵测试 PR");
  assert.equal(pr.mergedAt, "2026-10-01 10:00:00");
  assert.equal(pr.backend, true);
  assert.equal(pr.frontend, true);
});
