import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/server/auth.js";
import { seed } from "../src/server/seed.js";
import { queryOne } from "../src/server/db.js";

test("password hashing uses salted verification", () => {
  const { hash, salt } = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("correct horse battery staple", hash, salt), true);
  assert.equal(verifyPassword("wrong password", hash, salt), false);
});

test("development seed creates models and example project data", () => {
  seed();
  const project = queryOne<{ id: number }>(`SELECT id FROM projects LIMIT 1`);
  const modules = queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM modules`);
  const rules = queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM rules`);
  assert.ok(project?.id);
  assert.ok((modules?.count ?? 0) >= 4);
  assert.ok((rules?.count ?? 0) >= 3);
});
