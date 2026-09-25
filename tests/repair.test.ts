import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { seed } from "../src/server/seed.js";
import { queryOne, execute } from "../src/server/db.js";
import { createRepairBundle } from "../src/server/repair.js";

seed();

test("repair bundle contains patch, provenance and approval boundary", () => {
  const impact = queryOne<{ id: number }>(`SELECT id FROM impacts ORDER BY id LIMIT 1`);
  assert.ok(impact);
  const bundle = createRepairBundle(impact.id, "test");
  const dir = path.resolve(process.cwd(), "data/repair-bundles", String(impact.id));
  assert.equal(fs.existsSync(path.join(dir, "repair.diff")), true);
  assert.equal(fs.existsSync(path.join(dir, "provenance.json")), true);
  const provenance = JSON.parse(fs.readFileSync(path.join(dir, "provenance.json"), "utf8"));
  assert.equal(provenance.directWriteAllowed, false);
  execute(`UPDATE repair_bundles SET status = 'approved' WHERE id = ?`, [bundle.id]);
  const saved = queryOne<{ status: string }>(`SELECT status FROM repair_bundles WHERE id = ?`, [bundle.id]);
  assert.equal(saved?.status, "approved");
});
