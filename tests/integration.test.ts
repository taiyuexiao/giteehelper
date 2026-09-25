import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/server/seed.js";
import { createIntegrationRun, listModules } from "../src/server/integration.js";

seed();

test("integration plan marks missing dependencies as contract stubs", async () => {
  const modules = listModules();
  const frontend = modules.find((module) => module.moduleKey === "frontend");
  assert.ok(frontend);
  const run = await createIntegrationRun("frontend", null);
  assert.equal(run.moduleKey, "frontend");
  assert.equal(run.combination[0].mode, "real");
  assert.ok(run.combination.some((item) => item.mode === "stub" || item.mode === "real"));
  assert.equal(run.result.contractVerified, true);
});
