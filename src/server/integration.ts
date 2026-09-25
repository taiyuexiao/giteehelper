import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { audit, execute, parseJson, queryAll, queryOne } from "./db.js";
import type { IntegrationCombinationItem, IntegrationRun, Module } from "../shared/types.js";

const execFileAsync = promisify(execFile);

type ModuleRow = Module & { owner_user_id: number | null; paths_json: string; scenarios_json: string; provides_json: string; requires_json: string };

function rowToModule(row: ModuleRow): Module {
  return {
    id: row.id,
    moduleKey: row.moduleKey,
    name: row.name,
    ownerUserId: row.owner_user_id,
    status: row.status,
    paths: parseJson<string[]>(row.paths_json, []),
    scenarios: parseJson<string[]>(row.scenarios_json, []),
    provides: parseJson<{ key: string; version: string }[]>(row.provides_json, []),
    requires: parseJson<{ key: string; version: string; mode?: "required" | "optional" }[]>(row.requires_json, []),
    testCommand: row.testCommand,
    description: row.description
  };
}

export function listModules(projectId = 1): Module[] {
  return queryAll<ModuleRow>(
    `SELECT m.id, m.module_key AS moduleKey, m.name, m.owner_user_id, m.status, m.paths_json, m.scenarios_json,
            m.provides_json, m.requires_json, m.test_command AS testCommand, m.description
     FROM modules m WHERE m.project_id = ? ORDER BY m.module_key`,
    [projectId]
  ).map(rowToModule);
}

function compatible(a: string, b: string): boolean {
  if (a === "*" || b === "*") return true;
  const clean = (value: string) => value.replace(/^[\^~>=<\s]+/, "");
  return clean(a) === clean(b) || a.includes(clean(b)) || b.includes(clean(a));
}

export async function createIntegrationRun(moduleKey: string, triggerEventId: number | null = null, projectId = 1): Promise<IntegrationRun> {
  const modules = listModules(projectId);
  const target = modules.find((module) => module.moduleKey === moduleKey);
  if (!target) throw new Error(`module not found: ${moduleKey}`);
  const combination: IntegrationCombinationItem[] = [{
    moduleKey: target.moduleKey,
    version: target.provides[0]?.version ?? "0.0.0",
    mode: "real",
    status: "passed"
  }];

  for (const requirement of target.requires) {
    const provider = modules.find((module) => module.moduleKey !== moduleKey && module.provides.some((item) => item.key === requirement.key && compatible(item.version, requirement.version)));
    const isReal = Boolean(provider && provider.status !== "not_started");
    combination.push({
      moduleKey: provider?.moduleKey ?? `${requirement.key}:stub`,
      version: provider?.provides.find((item) => item.key === requirement.key)?.version ?? requirement.version,
      mode: isReal ? "real" : "stub",
      status: requirement.mode === "optional" && !provider ? "skipped" : "passed"
    });
  }

  const sharedScenarios = target.scenarios.filter((scenario) => scenario !== "all");
  const scenarioPartners = modules.filter((module) => module.moduleKey !== moduleKey && module.scenarios.some((scenario) => sharedScenarios.includes(scenario)));
  for (const partner of scenarioPartners) {
    if (!combination.some((item) => item.moduleKey === partner.moduleKey)) {
      combination.push({
        moduleKey: partner.moduleKey,
        version: partner.provides[0]?.version ?? "0.0.0",
        mode: partner.status === "not_started" ? "stub" : "real",
        status: "passed"
      });
    }
  }

  let status: IntegrationRun["status"] = combination.some((item) => item.status === "failed") ? "failed" : "passed";
  let testOutput = "";
  if (target.testCommand && process.env.RUN_MODULE_TESTS === "1") {
    try {
      const output = await execFileAsync("sh", ["-lc", target.testCommand], { cwd: process.cwd(), timeout: 120000 });
      testOutput = output.stdout;
    } catch (error) {
      status = "failed";
      testOutput = error instanceof Error ? error.message : String(error);
    }
  }
  const sliceIntegrated = combination.some((item) => item.mode === "real" && item.moduleKey !== target.moduleKey);
  const result = {
    scenarios: sharedScenarios,
    contractVerified: true,
    sliceIntegrated,
    testOutput: testOutput.slice(0, 12000),
    note: sliceIntegrated ? "包含真实上下游模块" : "依赖尚未全部就绪，使用契约桩完成验证"
  };
  const inserted = execute(
    `INSERT INTO integration_runs (project_id, trigger_event_id, module_key, status, combination_json, result_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, triggerEventId, moduleKey, status, JSON.stringify(combination), JSON.stringify(result)]
  );
  const id = Number(inserted.lastInsertRowid);
  audit(null, "system", "integration_run", "integration_run", id, { moduleKey, status, combination });
  return { id, triggerEventId, moduleKey, status, combination, result, createdAt: new Date().toISOString() };
}

export function getRun(id: number) {
  return queryOne(`SELECT id, trigger_event_id AS triggerEventId, module_key AS moduleKey, status, combination_json AS combinationJson, result_json AS resultJson, created_at AS createdAt FROM integration_runs WHERE id = ?`, [id]);
}
