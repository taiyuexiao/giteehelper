import { audit, execute, parseJson, queryAll, queryOne } from "./db.js";

export type CleanupSummary = {
  integrationRuns: number;
  integrationAuditLogs: number;
  legacyModules: number;
  legacyContracts: number;
  legacyUsers: number;
  legacyImpacts: number;
  legacyAuditLogs: number;
  sanitizedModuleReferences: number;
};

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(",");
}

function hasExecutionEvidence(resultJson: string): boolean {
  const result = parseJson<Record<string, unknown>>(resultJson, {});
  return result.executionVerified === true ||
    (typeof result.testOutput === "string" && result.testOutput.trim().length > 0 && Boolean(result.command));
}

export function cleanupMisleadingData(): CleanupSummary {
  const fakeRuns = queryAll<{ id: number; resultJson: string }>(
    `SELECT id, result_json AS resultJson FROM integration_runs`
  ).filter((row) => !hasExecutionEvidence(row.resultJson));
  const fakeRunIds = fakeRuns.map((row) => row.id);

  const legacyModules = queryAll<{ id: number; moduleKey: string; name: string }>(
    `SELECT id, module_key AS moduleKey, name FROM modules
     WHERE name LIKE '[旧导入]%' OR module_key LIKE '[旧导入]%'`
  );
  const legacyContracts = queryAll<{ id: number; contractKey: string }>(
    `SELECT id, contract_key AS contractKey FROM contracts
     WHERE contract_key LIKE '[旧导入]%'`
  );
  const legacyUsers = queryAll<{ id: number; username: string; displayName: string }>(
    `SELECT id, username, display_name AS displayName FROM users
     WHERE username LIKE '[旧导入]%' OR display_name LIKE '[旧导入]%'`
  );

  const legacyModuleIds = legacyModules.map((row) => row.id);
  const legacyContractIds = legacyContracts.map((row) => row.id);
  const legacyUserIds = legacyUsers.map((row) => row.id);
  const legacyContractKeys = new Set(legacyContracts.map((row) => row.contractKey));

  let sanitizedModuleReferences = 0;
  for (const row of queryAll<{ id: number; providesJson: string; requiresJson: string }>(
    `SELECT id, provides_json AS providesJson, requires_json AS requiresJson FROM modules`
  )) {
    const provides = parseJson<Array<{ key?: string }>>(row.providesJson, []);
    const requires = parseJson<Array<{ key?: string }>>(row.requiresJson, []);
    const keep = (item: { key?: string }) =>
      !String(item.key ?? "").startsWith("[旧导入]") && !legacyContractKeys.has(String(item.key ?? ""));
    const nextProvides = provides.filter(keep);
    const nextRequires = requires.filter(keep);
    if (nextProvides.length !== provides.length || nextRequires.length !== requires.length) {
      execute(`UPDATE modules SET provides_json = ?, requires_json = ? WHERE id = ?`, [
        JSON.stringify(nextProvides), JSON.stringify(nextRequires), row.id
      ]);
      sanitizedModuleReferences += 1;
    }
  }

  let integrationAuditLogs = 0;
  if (fakeRunIds.length) {
    integrationAuditLogs = Number(execute(
      `DELETE FROM audit_logs WHERE resource_type = 'integration_run' AND resource_id IN (${placeholders(fakeRunIds)})`,
      fakeRunIds
    ).changes);
    execute(`DELETE FROM integration_runs WHERE id IN (${placeholders(fakeRunIds)})`, fakeRunIds);
  }

  let legacyImpacts = 0;
  if (legacyModuleIds.length) {
    legacyImpacts = Number(execute(
      `DELETE FROM impacts WHERE module_id IN (${placeholders(legacyModuleIds)})`,
      legacyModuleIds
    ).changes);
  }

  if (legacyUserIds.length) {
    execute(`UPDATE modules SET owner_user_id = NULL WHERE owner_user_id IN (${placeholders(legacyUserIds)})`, legacyUserIds);
    execute(`UPDATE impacts SET user_id = NULL WHERE user_id IN (${placeholders(legacyUserIds)})`, legacyUserIds);
    execute(`UPDATE contracts SET owner_user_id = NULL WHERE owner_user_id IN (${placeholders(legacyUserIds)})`, legacyUserIds);
  }

  let legacyAuditLogs = 0;
  const legacyAuditGroups: Array<{ type: string; ids: number[] }> = [
    { type: "module", ids: legacyModuleIds },
    { type: "contract", ids: legacyContractIds },
    { type: "user", ids: legacyUserIds }
  ];
  for (const group of legacyAuditGroups) {
    if (!group.ids.length) continue;
    legacyAuditLogs += Number(execute(
      `DELETE FROM audit_logs WHERE resource_type = ? AND resource_id IN (${placeholders(group.ids)})`,
      [group.type, ...group.ids]
    ).changes);
  }

  if (legacyModuleIds.length) execute(`DELETE FROM modules WHERE id IN (${placeholders(legacyModuleIds)})`, legacyModuleIds);
  if (legacyContractIds.length) execute(`DELETE FROM contracts WHERE id IN (${placeholders(legacyContractIds)})`, legacyContractIds);
  if (legacyUserIds.length) execute(`DELETE FROM users WHERE id IN (${placeholders(legacyUserIds)})`, legacyUserIds);

  const summary: CleanupSummary = {
    integrationRuns: fakeRunIds.length,
    integrationAuditLogs,
    legacyModules: legacyModules.length,
    legacyContracts: legacyContracts.length,
    legacyUsers: legacyUsers.length,
    legacyImpacts,
    legacyAuditLogs,
    sanitizedModuleReferences
  };
  audit(null, "system", "data_cleanup", "data_cleanup", "misleading-v1", summary);
  return summary;
}
