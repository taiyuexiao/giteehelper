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

type Version = [number, number, number];

function parseVersion(value: string): Version | null {
  const match = value.trim().replace(/^[\^~>=<\s]+/, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * 契约版本兼容判断。旧实现只做字符串包含，`^1.0` 与 `1.1` 会被判为不兼容，
 * 也无法支撑真实的契约校验。
 */
export function versionsCompatible(provided: string, required: string): boolean {
  const source = provided.trim();
  const range = required.trim();
  if (!source || !range) return false;
  if (source === "*" || range === "*") return true;
  const target = parseVersion(range);
  const actual = parseVersion(source);
  if (!target || !actual) {
    const clean = (value: string) => value.replace(/^[\^~>=<\s]+/, "");
    return clean(source) === clean(range);
  }
  if (range.startsWith("^")) {
    if (target[0] > 0) return actual[0] === target[0] && compareVersions(actual, target) >= 0;
    if (target[1] > 0) return actual[0] === 0 && actual[1] === target[1] && compareVersions(actual, target) >= 0;
    return compareVersions(actual, target) === 0;
  }
  if (range.startsWith("~")) return actual[0] === target[0] && actual[1] === target[1] && compareVersions(actual, target) >= 0;
  if (range.startsWith(">=")) return compareVersions(actual, target) >= 0;
  if (range.startsWith("<=")) return compareVersions(actual, target) <= 0;
  if (range.startsWith(">")) return compareVersions(actual, target) > 0;
  if (range.startsWith("<")) return compareVersions(actual, target) < 0;
  return compareVersions(actual, target) === 0;
}

export async function createIntegrationRun(moduleKey: string, triggerEventId: number | null = null, projectId = 1): Promise<IntegrationRun> {
  const modules = listModules(projectId);
  const target = modules.find((module) => module.moduleKey === moduleKey);
  if (!target) throw new Error(`module not found: ${moduleKey}`);
  const combination: IntegrationCombinationItem[] = [{
    moduleKey: target.moduleKey,
    version: target.provides[0]?.version ?? "0.0.0",
    mode: "real",
    status: "ready"
  }];

  for (const requirement of target.requires) {
    const provider = modules.find((module) => module.moduleKey !== moduleKey && module.provides.some((item) => item.key === requirement.key && versionsCompatible(item.version, requirement.version)));
    const isReal = Boolean(provider && provider.status !== "not_started");
    combination.push({
      moduleKey: provider?.moduleKey ?? `${requirement.key}:stub`,
      version: provider?.provides.find((item) => item.key === requirement.key)?.version ?? requirement.version,
      mode: isReal ? "real" : "stub",
      status: requirement.mode === "optional" && !provider ? "skipped" : "ready"
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
        status: "ready"
      });
    }
  }

  const contracts = queryAll<{ contractKey: string; version: string }>(
    `SELECT contract_key AS contractKey, version FROM contracts WHERE project_id = ?`,
    [projectId]
  );
  const missingContracts = target.requires
    .filter((requirement) => requirement.mode !== "optional")
    .filter((requirement) => !contracts.some((contract) => contract.contractKey === requirement.key && versionsCompatible(contract.version, requirement.version)))
    .map((requirement) => requirement.key);
  const contractVerified = missingContracts.length === 0;

  let status: IntegrationRun["status"] = "blocked";
  let testOutput = "";
  let executionVerified = false;
  const shouldExecuteTests = Boolean(target.testCommand) && process.env.RUN_MODULE_TESTS === "1";
  if (shouldExecuteTests) {
    try {
      const output = await execFileAsync("sh", ["-lc", target.testCommand!], { cwd: process.cwd(), timeout: 120000 });
      testOutput = output.stdout;
      executionVerified = true;
      status = combination.some((item) => item.status === "failed") ? "failed" : "passed";
    } catch (error) {
      status = "failed";
      testOutput = error instanceof Error ? error.message : String(error);
    }
  }
  const sliceIntegrated = executionVerified && combination.some((item) => item.mode === "real" && item.moduleKey !== target.moduleKey);
  const result = {
    scenarios: sharedScenarios,
    contractVerified,
    missingContracts,
    executionVerified,
    sliceIntegrated,
    command: shouldExecuteTests ? target.testCommand : null,
    testOutput: testOutput.slice(0, 12000),
    note: executionVerified
      ? (sliceIntegrated ? "已执行真实上下游代码联调" : "已执行目标模块测试；未形成真实上下游联调")
      : "仅完成契约组合检查，未执行真实代码联调"
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
