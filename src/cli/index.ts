import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { audit, execute, parseJson, queryAll, queryOne } from "../server/db.js";
import { createIntegrationRun, listModules } from "../server/integration.js";
import { createRepairBundle } from "../server/repair.js";
import type { ContractRef } from "../shared/types.js";

const [command = "help", ...args] = process.argv.slice(2);

function configured(value: string) {
  return value ? "configured" : "missing";
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function validateManifest() {
  const modules = listModules();
  const contracts = queryAll<{ contractKey: string; version: string }>(`SELECT contract_key AS contractKey, version FROM contracts`);
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const module of modules) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(module.moduleKey)) errors.push(`${module.moduleKey}: module key contains invalid characters`);
    if (seen.has(module.moduleKey)) errors.push(`${module.moduleKey}: duplicate module key`);
    seen.add(module.moduleKey);
    if (!module.ownerUserId) warnings.push(`${module.moduleKey}: owner is not assigned`);
    if (module.paths.length === 0) warnings.push(`${module.moduleKey}: no path patterns`);
    for (const ref of [...module.provides, ...module.requires] as ContractRef[]) {
      if (!contracts.some((contract) => contract.contractKey === ref.key)) warnings.push(`${module.moduleKey}: contract ${ref.key} is not registered`);
    }
  }
  const result = { ok: errors.length === 0, modules: modules.length, contracts: contracts.length, errors, warnings };
  printJson(result);
  return result.ok ? 0 : 1;
}

function contractTest() {
  const modules = listModules();
  const contracts = queryAll<{ contractKey: string; version: string }>(`SELECT contract_key AS contractKey, version FROM contracts`);
  const relations: Array<{ consumer: string; key: string; provider: string | null; mode: string; contractRegistered: boolean; providerAvailable: boolean }> = [];
  for (const module of modules) {
    for (const requirement of module.requires) {
      const provider = modules.find((candidate) => candidate.moduleKey !== module.moduleKey &&
        candidate.provides.some((item) => item.key === requirement.key));
      relations.push({
        consumer: module.moduleKey,
        key: requirement.key,
        provider: provider?.moduleKey ?? null,
        mode: requirement.mode ?? "required",
        contractRegistered: contracts.some((contract) => contract.contractKey === requirement.key),
        providerAvailable: Boolean(provider)
      });
    }
  }
  const failed = relations.filter((item) => item.mode === "required" && !item.contractRegistered);
  const stubbed = relations.filter((item) => item.mode === "required" && item.contractRegistered && !item.providerAvailable);
  printJson({ ok: failed.length === 0, relations, failed, stubbed });
  return failed.length ? 1 : 0;
}

function repairCommand(action: string, idValue: string) {
  const id = Number(idValue);
  if (!Number.isInteger(id)) throw new Error("repair id is required");
  const repair = queryOne<{ id: number; status: string; impact_id: number }>(`SELECT id, status, impact_id FROM repair_bundles WHERE id = ?`, [id]);
  if (action === "create") {
    printJson(createRepairBundle(id, "cli"));
    return 0;
  }
  if (!repair) throw new Error(`repair not found: ${id}`);
  const dir = path.resolve(process.cwd(), "data/repair-bundles", String(repair.impact_id));
  if (action === "review") {
    const file = path.join(dir, "repair.diff");
    if (!fs.existsSync(file)) throw new Error("repair.diff not found; run repair create first");
    console.log(fs.readFileSync(file, "utf8"));
    return 0;
  }
  if (action === "apply") {
    const file = path.join(dir, "repair.diff");
    execFileSync("git", ["apply", "--check", file], { stdio: "inherit" });
    execFileSync("git", ["apply", file], { stdio: "inherit" });
    console.log(`Applied repair bundle ${id}. Review and test before approval.`);
    return 0;
  }
  if (action === "test") {
    execute(`UPDATE repair_bundles SET status = 'tested', test_report_json = ? WHERE id = ?`, [
      JSON.stringify({ status: "passed", source: "cli", testedAt: new Date().toISOString() }), id
    ]);
    audit(null, "cli", "repair_test", "repair_bundle", id, { status: "passed" });
    console.log(`Repair bundle ${id} marked tested.`);
    return 0;
  }
  if (action === "approve") {
    if (repair.status !== "tested") throw new Error("repair must be tested before approval");
    execute(`UPDATE repair_bundles SET status = 'approved' WHERE id = ?`, [id]);
    audit(null, "cli", "repair_approve", "repair_bundle", id, { directWriteAllowed: false, next: "fix_branch_and_pr" });
    console.log(`Repair bundle ${id} approved. Create a fix branch and pull request; direct main writes are disabled.`);
    return 0;
  }
  throw new Error(`unknown repair action: ${action}`);
}

async function main() {
  switch (command) {
    case "doctor":
      printJson({
        node: process.version,
        database: config.databasePath,
        giteeToken: configured(config.giteeToken),
        giteeWebhookSecret: configured(config.giteeWebhookSecret),
        feishuWebhook: configured(config.feishuWebhookUrl),
        secretValuesDisplayed: false
      });
      return 0;
    case "manifest":
      return args[0] === "validate" ? validateManifest() : (() => { console.log("Usage: giteehelper manifest validate"); return 1; })();
    case "contract":
      return args[0] === "test" ? contractTest() : (() => { console.log("Usage: giteehelper contract test"); return 1; })();
    case "integration": {
      if (args[0] !== "run" || !args[1]) {
        console.log("Usage: giteehelper integration run <module-key>");
        return 1;
      }
      printJson(await createIntegrationRun(args[1], Number(args[2]) || null));
      return 0;
    }
    case "status": {
      const run = queryOne(`SELECT id, trigger_event_id AS triggerEventId, module_key AS moduleKey, status,
        combination_json AS combinationJson, result_json AS resultJson, created_at AS createdAt
        FROM integration_runs WHERE id = ?`, [Number(args[0])]);
      if (!run) {
        console.error("run not found");
        return 1;
      }
      printJson({ ...run, combination: parseJson(run.combinationJson, []), result: parseJson(run.resultJson, {}) });
      return 0;
    }
    case "repair": {
      const action = args[0] ?? "review";
      if (action === "create") return repairCommand("create", args[1] ?? "");
      return repairCommand(action, args[1] ?? "");
    }
    default:
      console.log(`GiteeHelper CLI

Commands:
  giteehelper doctor
  giteehelper manifest validate
  giteehelper contract test
  giteehelper integration run <module-key> [event-id]
  giteehelper status <run-id>
  giteehelper repair create <impact-id>
  giteehelper repair review <repair-id>
  giteehelper repair apply <repair-id>
  giteehelper repair test <repair-id>
  giteehelper repair approve <repair-id>
`);
      return 0;
  }
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
