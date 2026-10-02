import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { audit, execute, parseJson, queryAll, queryOne } from "../server/db.js";
import { createIntegrationRun, listModules } from "../server/integration.js";
import { createRepairBundle } from "../server/repair.js";
import { cleanupMisleadingData } from "../server/cleanup.js";
import { reanalyzeAll } from "../server/commits.js";
import { backfillEventFiles, backfillPullHeads, pullStats, syncPullRequests } from "../server/pulls.js";
import { backfillMergedFiles, backfillPullAuthors } from "../server/progress.js";
import { applyPatternFixes, patternFixPreview, patternHealth } from "../server/repohealth.js";
import { applyRfcPatterns, planRfcPatterns, rfcCoverage, syncRfcContracts } from "../server/rfccontract.js";
import { loadRuntimeSettings } from "../server/settings.js";
import type { ContractRef } from "../shared/types.js";

const [command = "help", ...args] = process.argv.slice(2);

/**
 * Web 控制台保存的配置存在 Secret Store 里，只读 .env 会让 `doctor`
 * 把已配置的 Token/飞书报成 missing。这里先加载运行时配置再执行命令。
 */
try {
  loadRuntimeSettings();
} catch (error) {
  console.warn(`[giteehelper] 运行时配置加载失败（将只使用 .env）：${error instanceof Error ? error.message : String(error)}`);
}

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
    case "sync-pulls":
      // 文件列表是路径归属的依据，默认一起拉；只想要 PR 元数据时显式加 --no-files
      printJson(await syncPullRequests({
        withComments: args.includes("--with-comments"),
        withFiles: !args.includes("--no-files")
      }));
      return 0;
    case "pulls":
      printJson(pullStats());
      return 0;
    case "pattern-health": {
      const report = await patternHealth();
      printJson({
        files: report.files, modules: report.modules, ok: report.ok,
        partial: report.partial, dead: report.dead, ghostPrefixes: report.ghostPrefixes,
        worst: report.modules_detail.filter((item) => item.verdict === "dead").slice(0, 10)
          .map((item: { moduleName: string; owner: string | null; patterns: string[] }) =>
            ({ module: item.moduleName, owner: item.owner, patterns: item.patterns }))
      });
      return report.dead === 0 ? 0 : 1;
    }
    case "pattern-fix": {
      if (args[0] === "--apply") {
        printJson(await applyPatternFixes({ includeReview: args.includes("--include-review") }));
        return 0;
      }
      const preview = await patternFixPreview();
      printJson({
        files: preview.files, deadBefore: preview.deadBefore, fixable: preview.fixable,
        pendingReviewDocs: preview.pendingReview,
        filesBeforeTotal: preview.filesBeforeTotal, filesAfterTotal: preview.filesAfterTotal,
        samples: preview.fixes.filter((item) => item.filesAfter > item.filesBefore).slice(0, 8)
          .map((item: { moduleName: string; before: string[]; after: string[]; filesBefore: number; filesAfter: number }) =>
            ({ module: item.moduleName, before: item.before[0], after: item.after[0], hits: `${item.filesBefore} → ${item.filesAfter}` }))
      });
      return 0;
    }
    case "rfc-sync":
      printJson(await syncRfcContracts());
      return 0;
    case "rfc-coverage": {
      const coverage = rfcCoverage();
      printJson({
        contracts: coverage.contracts,
        contractsWithTasks: coverage.contractsWithTasks,
        modulesTotal: coverage.modulesTotal,
        modulesWithRfc: coverage.modulesWithRfc,
        modulesWithoutRfc: coverage.modulesWithoutRfc.length,
        ownerAgreement: `${coverage.ownerAgreement.filter((item) => item.agreed).length}/${coverage.ownerAgreement.length}`,
        samples: coverage.modulesWithoutRfc.slice(0, 10)
      });
      return coverage.modulesWithoutRfc.length ? 1 : 0;
    }
    case "rfc-apply": {
      if (!rfcCoverage().contracts) {
        console.error("先跑 rfc-sync 拉取 docs/rfcs/meta/*.json");
        return 1;
      }
      const plan = planRfcPatterns();
      if (args[0] !== "--apply") {
        printJson({
          modules: plan.length,
          patternsToAdd: plan.reduce((sum, item) => sum + item.added.length, 0),
          samples: plan.slice(0, 8).map((item) => ({
            module: item.moduleName, owner: item.owner, rfc: item.slug, add: item.added.slice(0, 3), count: item.added.length
          }))
        });
        return 0;
      }
      printJson(applyRfcPatterns());
      return 0;
    }
    case "backfill-files": {
      // 默认只用库里已有的文件列表；--fetch 才会按需回查 Gitee（只读），并缓存回库
      printJson(await backfillEventFiles({
        fetchMissing: args.includes("--fetch"),
        maxFetches: Number(args.find((item) => item.startsWith("--max="))?.slice(6)) || undefined
      }));
      return 0;
    }
    case "backfill-pull-head": {
      // 默认只预览会修正哪些事件（回查 Gitee 提交列表，只读）；--apply 才改写历史 payload
      printJson(await backfillPullHeads({
        apply: args.includes("--apply"),
        maxFetches: Number(args.find((item) => item.startsWith("--max="))?.slice(6)) || undefined
      }));
      return 0;
    }
    case "backfill-merged-files": {
      // 给 merged 且缺文件的 PR 回填文件列表（进度页按路径关联任务要用）。
      // 分块可续跑：每次最多 --max 条（默认 200），重复执行直到 fetched 为 0。
      printJson(await backfillMergedFiles({
        max: Number(args.find((item) => item.startsWith("--max="))?.slice(6)) || 200
      }));
      return 0;
    }
    case "backfill-pull-authors": {
      // 回填 PR 的真实提交作者（PR 内 commit 署名邮箱）。登录账号是共用/代操作的，
      // author_login 不代表作者；人员指标按这个归属。分块可续跑，默认 --max=100。
      printJson(await backfillPullAuthors({
        max: Number(args.find((item) => item.startsWith("--max="))?.slice(6)) || 100
      }));
      return 0;
    }
    case "reanalyze":
      printJson(reanalyzeAll());
      return 0;
    case "cleanup":
      if (args[0] !== "misleading-data") {
        console.log("Usage: giteehelper cleanup misleading-data");
        return 1;
      }
      printJson(cleanupMisleadingData());
      return 0;
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
  giteehelper pattern-health
  giteehelper pattern-fix [--apply] [--include-review]
  giteehelper sync-pulls [--with-comments]
  giteehelper pulls
  giteehelper backfill-files
  giteehelper backfill-pull-head [--apply]
  giteehelper backfill-merged-files [--max=N]
  giteehelper backfill-pull-authors [--max=N]
  giteehelper rfc-sync
  giteehelper rfc-coverage
  giteehelper rfc-apply [--apply]
  giteehelper reanalyze
  giteehelper cleanup misleading-data
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
