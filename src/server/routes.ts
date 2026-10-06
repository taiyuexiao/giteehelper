import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { audit, execute, parseJson, queryAll, queryOne } from "./db.js";
import { createSession, currentUser, destroySession, hashPassword, login, requireAuth, requireRole } from "./auth.js";
import { analyzeEvent, persistEventAndImpacts, type EventInput } from "./impact.js";
import { createIntegrationRun, getRun } from "./integration.js";
import { commitStats, findCommitBySha, getCommit, ingestCommit, listCommits, listWebhookDeliveries, reanalyzeAll, recordWebhookDelivery } from "./commits.js";
import { buildRepoGraph } from "./repograph.js";
import { backfillPullHeads, getPull, listPulls, pullGraph, pullStats, syncPullRequests } from "./pulls.js";
import { applyPatternFixes, patternFixPreview, patternHealth } from "./repohealth.js";
import { applyRfcPatterns, listRfcContracts, planRfcPatterns, rfcCoverage, syncRfcContracts } from "./rfccontract.js";
import { NATURE_LABELS, classifyReasons, type ReasonNature } from "./reason.js";
import { ingestGiteeWebhook } from "./ingest.js";
import {
  aiAssociatePulls, applyAssignment, associationCandidates, backfillMergedFiles, backfillPullAuthors, buildBoard,
  buildPeople, buildPullDetails, confirmAssociation, dismissAssociation, identitySuggestions,
  parseAssignmentCsv, parseAssignmentWithLlm, upsertIdentityAlias
} from "./progress.js";
import { backfillPullComments } from "./pulls.js";
import { listBlockers, upsertBlocker } from "./progress.js";
import { buildProgressWorkbook } from "./export.js";
import { buildTimeline } from "./timeline.js";
import { publicRuntimeSettings, updateRuntimeSettings } from "./settings.js";
import { createRepairBundle } from "./repair.js";
import { cleanupMisleadingData } from "./cleanup.js";
import {
  createBranch, createPullRequest, extractPushCommits, fetchCommitDetail, listCommits as listGiteeCommits,
  listPullRequests, normalizeGiteeEvent, testGiteeConnection, verifyGiteeSignature
} from "./gitee.js";
import { sendFeishuText } from "./feishu.js";
import type { GraphData, GraphEdge, GraphNode, Impact, Role, Severity, User } from "../shared/types.js";

type AuthRequest = express.Request & { user?: User };

const router = express.Router();

function actor(req: express.Request) {
  return (req as AuthRequest).user;
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  return requireRole("admin")(req, res, next);
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "giteehelper",
    version: "0.2.0",
    node: process.version,
    database: "sqlite",
    giteeConfigured: Boolean(config.giteeToken),
    feishuConfigured: Boolean(config.feishuWebhookUrl)
  });
});

router.get("/preparation", (_req, res) => {
  const users = queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM users`)?.count ?? 0;
  const modules = queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM modules`)?.count ?? 0;
  const rules = queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM rules`)?.count ?? 0;
  res.json({
    status: "ready",
    checks: {
      database: true,
      seed: users > 0,
      moduleModel: modules > 0,
      ruleModel: rules > 0,
      giteeToken: Boolean(config.giteeToken),
      giteeWebhookSecret: Boolean(config.giteeWebhookSecret),
      feishuWebhook: Boolean(config.feishuWebhookUrl)
    },
    counts: { users, modules, rules }
  });
});

router.post("/login", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  const result = username && password ? login(username, password) : undefined;
  if (!result) {
    res.status(401).json({ error: "用户名或密码错误" });
    return;
  }
  audit(result.user.id, result.user.username, "login", "session", result.user.id, {});
  res.json(result);
});

router.post("/logout", requireAuth, (req, res) => {
  const header = req.header("authorization") ?? "";
  destroySession(header.slice(7));
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => res.json(actor(req)));

router.get("/dashboard", requireAuth, (_req, res) => {
  const counts = {
    events: queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM change_events`)?.count ?? 0,
    openImpacts: queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM impacts WHERE status = 'open'`)?.count ?? 0,
    blockingImpacts: queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM impacts WHERE status = 'open' AND severity = 'blocking'`)?.count ?? 0,
    activeModules: queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM modules WHERE status != 'not_started'`)?.count ?? 0,
    pendingRepairs: queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM repair_bundles WHERE status IN ('draft','tested')`)?.count ?? 0
  };
  const actions = queryAll<Impact & { evidenceJson: string; moduleName?: string; ownerName?: string; eventTitle?: string; eventUrl?: string }>(
    `SELECT i.id, i.event_id AS eventId, i.module_id AS moduleId, i.user_id AS userId, i.severity, i.category,
            i.reason, i.evidence_json AS evidenceJson, i.next_action AS nextAction, i.status, i.created_at AS createdAt,
            m.name AS moduleName, u.display_name AS ownerName, e.title AS eventTitle, e.url AS eventUrl
     FROM impacts i
     LEFT JOIN modules m ON m.id = i.module_id
     LEFT JOIN users u ON u.id = i.user_id
     LEFT JOIN change_events e ON e.id = i.event_id
     WHERE i.status = 'open'
     ORDER BY CASE i.severity WHEN 'blocking' THEN 1 WHEN 'contract' THEN 2 WHEN 'implementation' THEN 3 WHEN 'clarification' THEN 4 ELSE 5 END, i.created_at DESC
     LIMIT 30`
  ).map((row) => ({ ...row, evidence: parseJson(row.evidenceJson, []) }));
  const recentEvents = queryAll(`SELECT id, source, source_id AS sourceId, event_type AS eventType, action, title, author, branch, url, created_at AS createdAt FROM change_events ORDER BY id DESC LIMIT 12`);
  const recentRuns = queryAll(`SELECT id, trigger_event_id AS triggerEventId, module_key AS moduleKey, status, combination_json AS combinationJson, result_json AS resultJson, created_at AS createdAt FROM integration_runs ORDER BY id DESC LIMIT 12`)
    .map((row) => ({ ...row, combination: parseJson(row.combinationJson, []), result: parseJson(row.resultJson, {}) }));
  res.json({ stats: counts, actions, recentEvents, recentRuns });
});

router.get("/graph", requireAuth, (_req, res) => {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const project = queryOne<{ id: number; name: string }>(`SELECT id, name FROM projects ORDER BY id LIMIT 1`);
  if (project) nodes.set(`project:${project.id}`, { id: `project:${project.id}`, label: project.name, type: "project" });

  const users = queryAll<{ id: number; displayName: string; role: string }>(`SELECT id, display_name AS displayName, role FROM users WHERE active = 1`);
  for (const user of users) nodes.set(`user:${user.id}`, { id: `user:${user.id}`, label: user.displayName, type: "user", meta: { role: user.role } });

  const modules = queryAll<{ id: number; moduleKey: string; name: string; ownerUserId: number | null; ownerName: string | null; status: string; description: string | null; scenariosJson: string; providesJson: string; requiresJson: string }>(
    `SELECT m.id, m.module_key AS moduleKey, m.name, m.owner_user_id AS ownerUserId, u.display_name AS ownerName,
            m.status, m.description, m.scenarios_json AS scenariosJson,
            m.provides_json AS providesJson, m.requires_json AS requiresJson
     FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id`
  );
  for (const module of modules) {
    nodes.set(`module:${module.id}`, {
      id: `module:${module.id}`,
      label: module.name,
      type: "module",
      meta: {
        key: module.moduleKey,
        status: module.status,
        owner: module.ownerName ?? "未分配",
        workItem: module.moduleKey.startsWith("work-")
      }
    });
    if (project) edges.push({ id: `project-${module.id}`, source: `project:${project.id}`, target: `module:${module.id}`, label: "contains", confidence: "manual" });
    if (module.ownerUserId) edges.push({ id: `owner-${module.id}`, source: `user:${module.ownerUserId}`, target: `module:${module.id}`, label: "owns", confidence: "manual" });
    for (const [index, item] of parseJson<{ key: string; version: string }[]>(module.providesJson, []).entries()) {
      const id = `contract:${item.key}`;
      if (!nodes.has(id)) nodes.set(id, { id, label: item.key, type: "contract", meta: { version: item.version } });
      edges.push({ id: `provides-${module.id}-${index}`, source: `module:${module.id}`, target: id, label: "provides", confidence: "contract" });
    }
    for (const [index, item] of parseJson<{ key: string; version: string }[]>(module.requiresJson, []).entries()) {
      const id = `contract:${item.key}`;
      if (!nodes.has(id)) nodes.set(id, { id, label: item.key, type: "contract", meta: { version: item.version } });
      edges.push({ id: `requires-${module.id}-${index}`, source: id, target: `module:${module.id}`, label: "requires", confidence: "contract" });
    }
    for (const [index, scenario] of parseJson<string[]>(module.scenariosJson, []).entries()) {
      const id = `scenario:${scenario}`;
      if (!nodes.has(id)) nodes.set(id, { id, label: scenario, type: "scenario" });
      edges.push({ id: `scenario-${module.id}-${index}`, source: `module:${module.id}`, target: id, label: "contributes", confidence: "manual" });
    }
  }

  const impacts = queryAll<{ id: number; eventId: number; moduleId: number | null; severity: string }>(`SELECT id, event_id AS eventId, module_id AS moduleId, severity FROM impacts ORDER BY id DESC LIMIT 50`);
  for (const impact of impacts) {
    const eventId = `event:${impact.eventId}`;
    const event = queryOne<{ title: string }>(`SELECT title FROM change_events WHERE id = ?`, [impact.eventId]);
    if (!nodes.has(eventId)) nodes.set(eventId, { id: eventId, label: event?.title ?? `事件 ${impact.eventId}`, type: "event" });
    if (impact.moduleId) edges.push({ id: `impact-${impact.id}`, source: eventId, target: `module:${impact.moduleId}`, label: impact.severity, confidence: "inferred" });
  }
  const data: GraphData = { nodes: [...nodes.values()], edges };
  res.json(data);
});

router.get("/project", requireAuth, (_req, res) => {
  res.json(queryOne(`SELECT id, name, gitee_repo AS giteeRepo, default_branch AS defaultBranch, feishu_chat_id AS feishuChatId, created_at AS createdAt
    FROM projects ORDER BY id LIMIT 1`) ?? null);
});

router.patch("/project", requireAuth, requireAdmin, (req, res) => {
  const body = req.body as Record<string, unknown>;
  const project = queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  execute(`UPDATE projects SET name = COALESCE(?, name), gitee_repo = COALESCE(?, gitee_repo),
    default_branch = COALESCE(?, default_branch), feishu_chat_id = COALESCE(?, feishu_chat_id) WHERE id = ?`,
    [body.name ?? null, body.giteeRepo ?? null, body.defaultBranch ?? null, body.feishuChatId ?? null, project.id]);
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "project_update", "project", project.id, { fields: Object.keys(body) });
  res.json({ ok: true });
});

router.get("/contracts", requireAuth, (_req, res) => {
  res.json(queryAll(`SELECT c.id, c.contract_key AS contractKey, c.version, c.kind, c.schema_json AS schemaJson,
    c.owner_user_id AS ownerUserId, u.display_name AS ownerName, c.created_at AS createdAt
    FROM contracts c LEFT JOIN users u ON u.id = c.owner_user_id ORDER BY c.contract_key, c.version`)
    .map((row) => ({ ...row, schema: parseJson(row.schemaJson, {}) })));
});

router.post("/contracts", requireAuth, requireRole("admin", "maintainer"), (req, res) => {
  const body = req.body as Record<string, unknown>;
  const contractKey = String(body.contractKey ?? "").trim();
  if (!contractKey || !body.version) {
    res.status(400).json({ error: "contractKey 和 version 必填" });
    return;
  }
  const result = execute(`INSERT INTO contracts (project_id, contract_key, version, kind, schema_json, owner_user_id)
    VALUES ((SELECT id FROM projects ORDER BY id LIMIT 1), ?, ?, ?, ?, ?)`,
    [contractKey, String(body.version), String(body.kind ?? "api"), JSON.stringify(body.schema ?? {}), Number(body.ownerUserId) || null]);
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "contract_create", "contract", Number(result.lastInsertRowid), { contractKey });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.get("/modules", requireAuth, (_req, res) => {
  const modules = queryAll(`SELECT m.id, m.module_key AS moduleKey, m.name, m.owner_user_id AS ownerUserId, u.display_name AS ownerName,
    m.status, m.paths_json AS pathsJson, m.scenarios_json AS scenariosJson, m.provides_json AS providesJson,
    m.requires_json AS requiresJson, m.test_command AS testCommand, m.description
    FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id ORDER BY m.module_key`)
    .map((row) => ({ ...row, paths: parseJson(row.pathsJson, []), scenarios: parseJson(row.scenariosJson, []), provides: parseJson(row.providesJson, []), requires: parseJson(row.requiresJson, []) }));
  res.json(modules);
});

router.post("/modules", requireAuth, requireRole("admin", "maintainer"), (req, res) => {
  const body = req.body as Record<string, unknown>;
  const key = String(body.moduleKey ?? "").trim();
  if (!key || !body.name) {
    res.status(400).json({ error: "moduleKey 和 name 必填" });
    return;
  }
  const result = execute(
    `INSERT INTO modules (project_id, module_key, name, owner_user_id, status, paths_json, scenarios_json, provides_json, requires_json, test_command, description)
     VALUES ((SELECT id FROM projects ORDER BY id LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [key, String(body.name), Number(body.ownerUserId) || null, String(body.status ?? "not_started"), JSON.stringify(toList(body.paths)),
      JSON.stringify(toList(body.scenarios)), JSON.stringify(body.provides ?? []), JSON.stringify(body.requires ?? []),
      String(body.testCommand ?? ""), String(body.description ?? "")]
  );
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "module_create", "module", Number(result.lastInsertRowid), { key });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.patch("/modules/:id", requireAuth, requireRole("admin", "maintainer"), (req, res) => {
  const body = req.body as Record<string, unknown>;
  const id = Number(req.params.id);
  const existing = queryOne(`SELECT id FROM modules WHERE id = ?`, [id]);
  if (!existing) {
    res.status(404).json({ error: "module not found" });
    return;
  }
  execute(
    `UPDATE modules SET name = COALESCE(?, name), owner_user_id = COALESCE(?, owner_user_id), status = COALESCE(?, status),
      paths_json = COALESCE(?, paths_json), scenarios_json = COALESCE(?, scenarios_json), provides_json = COALESCE(?, provides_json),
      requires_json = COALESCE(?, requires_json), test_command = COALESCE(?, test_command), description = COALESCE(?, description)
     WHERE id = ?`,
    [body.name ?? null, body.ownerUserId ?? null, body.status ?? null,
      body.paths ? JSON.stringify(toList(body.paths)) : null, body.scenarios ? JSON.stringify(toList(body.scenarios)) : null,
      body.provides ? JSON.stringify(body.provides) : null, body.requires ? JSON.stringify(body.requires) : null,
      body.testCommand ?? null, body.description ?? null, id]
  );
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "module_update", "module", id, { fields: Object.keys(body) });
  res.json({ ok: true });
});

router.get("/rules", requireAuth, (_req, res) => {
  res.json(queryAll(`SELECT id, rule_key AS ruleKey, name, enabled, severity, trigger_json AS triggerJson, condition_json AS conditionJson,
    action_json AS actionJson, version, updated_at AS updatedAt FROM rules ORDER BY rule_key`)
    .map((row) => ({ ...row, enabled: Boolean(row.enabled), trigger: parseJson(row.triggerJson, {}), condition: parseJson(row.conditionJson, {}), action: parseJson(row.actionJson, {}) })));
});

router.post("/rules", requireAuth, requireRole("admin", "maintainer"), (req, res) => {
  const body = req.body as Record<string, unknown>;
  const ruleKey = String(body.ruleKey ?? "").trim();
  if (!ruleKey || !body.name) {
    res.status(400).json({ error: "ruleKey 和 name 必填" });
    return;
  }
  const result = execute(
    `INSERT INTO rules (project_id, rule_key, name, enabled, severity, trigger_json, condition_json, action_json)
     VALUES ((SELECT id FROM projects ORDER BY id LIMIT 1), ?, ?, ?, ?, ?, ?, ?)`,
    [ruleKey, String(body.name), body.enabled === false ? 0 : 1, String(body.severity ?? "clarification"),
      JSON.stringify(body.trigger ?? {}), JSON.stringify(body.condition ?? {}), JSON.stringify(body.action ?? {})]
  );
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "rule_create", "rule", Number(result.lastInsertRowid), { ruleKey });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.patch("/rules/:id", requireAuth, requireRole("admin", "maintainer"), (req, res) => {
  const body = req.body as Record<string, unknown>;
  const id = Number(req.params.id);
  const existing = queryOne<{ version: number }>(`SELECT version FROM rules WHERE id = ?`, [id]);
  if (!existing) {
    res.status(404).json({ error: "rule not found" });
    return;
  }
  execute(
    `UPDATE rules SET name = COALESCE(?, name), enabled = COALESCE(?, enabled), severity = COALESCE(?, severity),
      trigger_json = COALESCE(?, trigger_json), condition_json = COALESCE(?, condition_json), action_json = COALESCE(?, action_json),
      version = version + 1, updated_at = datetime('now') WHERE id = ?`,
    [body.name ?? null, body.enabled == null ? null : (body.enabled ? 1 : 0), body.severity ?? null,
      body.trigger ? JSON.stringify(body.trigger) : null, body.condition ? JSON.stringify(body.condition) : null,
      body.action ? JSON.stringify(body.action) : null, id]
  );
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "rule_update", "rule", id, { version: existing.version + 1 });
  res.json({ ok: true, version: existing.version + 1 });
});

router.post("/rules/preview", requireAuth, requireRole("admin", "maintainer"), (req, res) => {
  const body = req.body as { event?: Partial<EventInput> };
  const event: EventInput = {
    source: "manual",
    sourceId: `preview-${Date.now()}`,
    eventType: String(body.event?.eventType ?? "pull_request"),
    action: String(body.event?.action ?? "merged"),
    title: String(body.event?.title ?? "规则预览变化"),
    author: String(body.event?.author ?? actor(req)?.username ?? "preview"),
    branch: String(body.event?.branch ?? "main"),
    url: body.event?.url,
    payload: body.event?.payload ?? {}
  };
  res.json(analyzeEvent(event));
});

router.get("/users", requireAuth, requireAdmin, (_req, res) => {
  type RawUser = Omit<User, "active" | "ownedModules"> & { active: number };
  const users = queryAll<RawUser>(`SELECT id, username, display_name AS displayName, role, email,
    gitee_login AS giteeLogin, feishu_user_id AS feishuUserId, active, created_at AS createdAt FROM users ORDER BY id`);
  res.json(users.map((user) => ({
    ...user,
    active: Boolean(user.active),
    ownedModules: queryAll(`SELECT id, module_key AS moduleKey, name, status FROM modules
      WHERE owner_user_id = ?
        AND name NOT LIKE '[旧导入]%'
        AND name NOT LIKE '[示例]%'
      ORDER BY CASE WHEN module_key LIKE 'module-%' THEN 0 ELSE 1 END, module_key`, [user.id])
  })));
});

router.post("/users", requireAuth, requireAdmin, (req, res) => {
  const body = req.body as Record<string, unknown>;
  const username = String(body.username ?? "").trim();
  const role = String(body.role ?? "developer") as Role;
  const allowed: Role[] = ["admin", "maintainer", "reviewer", "developer", "observer"];
  if (!username || !allowed.includes(role)) {
    res.status(400).json({ error: "username 或 role 不合法" });
    return;
  }
  const password = String(body.password ?? "");
  const credentials = password ? hashPassword(password) : { hash: null, salt: null };
  const result = execute(
    `INSERT INTO users (username, display_name, role, email, gitee_login, feishu_user_id, password_hash, password_salt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [username, String(body.displayName ?? username), role, String(body.email ?? "") || null,
      String(body.giteeLogin ?? "") || null, String(body.feishuUserId ?? "") || null, credentials.hash, credentials.salt]
  );
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "user_create", "user", Number(result.lastInsertRowid), { username, role });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.patch("/users/:id", requireAuth, requireAdmin, (req, res) => {
  const body = req.body as Record<string, unknown>;
  const id = Number(req.params.id);
  const existing = queryOne<{ id: number; role: Role }>(`SELECT id, role FROM users WHERE id = ?`, [id]);
  if (!existing) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  const allowed: Role[] = ["admin", "maintainer", "reviewer", "developer", "observer"];
  if (body.role !== undefined && !allowed.includes(body.role as Role)) {
    res.status(400).json({ error: "role 不合法" });
    return;
  }
  // 与 DELETE 同一条底线：不能把最后一个可用管理员降级或停用，否则系统会被锁死
  const demoting = typeof body.role === "string" && body.role !== "admin";
  const deactivating = body.active === false || body.active === 0;
  if (existing.role === "admin" && (demoting || deactivating)) {
    const admins = queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1`)?.count ?? 0;
    if (admins <= 1) {
      res.status(400).json({ error: "不能降级或停用最后一个管理员" });
      return;
    }
  }
  const password = body.password ? hashPassword(String(body.password)) : undefined;
  execute(
    `UPDATE users SET display_name = COALESCE(?, display_name), role = COALESCE(?, role), email = COALESCE(?, email),
      gitee_login = COALESCE(?, gitee_login), feishu_user_id = COALESCE(?, feishu_user_id), active = COALESCE(?, active),
      password_hash = COALESCE(?, password_hash), password_salt = COALESCE(?, password_salt) WHERE id = ?`,
    [body.displayName ?? null, body.role ?? null, body.email ?? null, body.giteeLogin ?? null, body.feishuUserId ?? null,
      body.active == null ? null : (body.active ? 1 : 0), password?.hash ?? null, password?.salt ?? null, id]
  );
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "user_update", "user", id, { fields: Object.keys(body).filter((key) => key !== "password") });
  res.json({ ok: true });
});

router.delete("/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = queryOne<{ id: number; username: string; role: Role }>(`SELECT id, username, role FROM users WHERE id = ?`, [id]);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  if (user.role === "admin" && queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1`)?.count === 1) {
    res.status(400).json({ error: "不能删除最后一个管理员" });
    return;
  }
  execute(`UPDATE modules SET owner_user_id = NULL WHERE owner_user_id = ?`, [id]);
  execute(`DELETE FROM users WHERE id = ?`, [id]);
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "user_delete", "user", id, { username: user.username });
  res.json({ ok: true });
});

router.post("/admin/cleanup-misleading-data", requireAuth, requireAdmin, (_req, res) => {
  res.json(cleanupMisleadingData());
});

router.post("/admin/reanalyze", requireAuth, requireAdmin, (_req, res) => {
  // 全量重算耗时可能超过 HTTP 超时：同步等待会让调用方误以为失败。
  // 受理后立即返回，后台执行；完成情况以审计日志（reanalyze_impacts）为准。
  res.status(202).json({ ok: true, started: true });
  setImmediate(() => {
    try {
      const result = reanalyzeAll();
      console.log(`[giteehelper] reanalyze 完成：${JSON.stringify(result)}`);
    } catch (error) {
      console.error("[giteehelper] reanalyze 失败：", error instanceof Error ? error.message : error);
    }
  });
});

router.post("/admin/backfill-pull-head", requireAuth, requireAdmin, (_req, res) => {
  // 要逐个 PR 回查 Gitee 提交列表，PR 多时同样可能超过 HTTP 超时：与 reanalyze 一致受理后后台执行。
  // 直接以 apply 模式运行；完成情况看审计日志（backfill_pull_head）与控制台输出。
  res.status(202).json({ ok: true, started: true });
  setImmediate(() => {
    void backfillPullHeads({ apply: true })
      .then((result) => console.log(`[giteehelper] backfill-pull-head 完成：${JSON.stringify(result)}`))
      .catch((error) => console.error("[giteehelper] backfill-pull-head 失败：", error instanceof Error ? error.message : error));
  });
});

router.get("/audit", requireAuth, requireAdmin, (req, res) => {
  const action = typeof req.query.action === "string" ? req.query.action : "";
  const resource = typeof req.query.resource === "string" ? req.query.resource : "";
  const rows = queryAll(`SELECT a.id, COALESCE(u.display_name, a.actor) AS actor, a.action, a.resource_type AS resourceType,
    a.resource_id AS resourceId, a.detail_json AS detailJson, a.created_at AS createdAt
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE (? = '' OR a.action LIKE '%' || ? || '%') AND (? = '' OR a.resource_type = ?)
    ORDER BY a.id DESC LIMIT 200`, [action, action, resource, resource])
    .map((row) => ({ ...row, detail: parseJson(row.detailJson, {}) }));
  res.json(rows);
});

router.get("/events/:id", requireAuth, (req, res) => {
  const event = queryOne(`SELECT id, source, source_id AS sourceId, event_type AS eventType, action, title, author, branch, url,
    payload_json AS payloadJson, created_at AS createdAt FROM change_events WHERE id = ?`, [Number(req.params.id)]);
  if (!event) {
    res.status(404).json({ error: "event not found" });
    return;
  }
  const impacts = queryAll(`SELECT id, event_id AS eventId, module_id AS moduleId, user_id AS userId, severity, category, reason,
    evidence_json AS evidenceJson, next_action AS nextAction, status, created_at AS createdAt FROM impacts WHERE event_id = ?`, [Number(req.params.id)])
    .map((row) => ({ ...row, evidence: parseJson(row.evidenceJson, []) }));
  res.json({ ...event, payload: parseJson(event.payloadJson, {}), impacts });
});

router.post("/impacts/:id/ack", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const status = String((req.body as Record<string, unknown>).status ?? "acknowledged");
  if (!["acknowledged", "resolved", "ignored"].includes(status)) {
    res.status(400).json({ error: "invalid impact status" });
    return;
  }
  execute(`UPDATE impacts SET status = ? WHERE id = ?`, [status, id]);
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "impact_ack", "impact", id, { status });
  res.json({ ok: true, status });
});

router.post("/notifications/:id/ack", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const status = String((req.body as Record<string, unknown>).status ?? "acknowledged");
  if (!["acknowledged", "resolved", "ignored"].includes(status)) {
    res.status(400).json({ error: "invalid notification status" });
    return;
  }
  execute(`UPDATE impacts SET status = ? WHERE id = ?`, [status, id]);
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "notification_ack", "notification", id, { status });
  res.json({ ok: true, status });
});

router.get("/runs", requireAuth, (_req, res) => {
  res.json(queryAll(`SELECT id, trigger_event_id AS triggerEventId, module_key AS moduleKey, status, combination_json AS combinationJson,
    result_json AS resultJson, created_at AS createdAt FROM integration_runs ORDER BY id DESC LIMIT 100`)
    .map((row) => ({ ...row, combination: parseJson(row.combinationJson, []), result: parseJson(row.resultJson, {}) })));
});

router.get("/runs/:id", requireAuth, (req, res) => {
  const run = getRun(Number(req.params.id));
  if (!run) {
    res.status(404).json({ error: "run not found" });
    return;
  }
  res.json({ ...run, combination: parseJson(run.combinationJson, []), result: parseJson(run.resultJson, {}) });
});

router.post("/runs", requireAuth, requireRole("admin", "maintainer", "reviewer", "developer"), async (req, res) => {
  const moduleKey = String((req.body as Record<string, unknown>).moduleKey ?? "");
  try {
    const run = await createIntegrationRun(moduleKey, Number((req.body as Record<string, unknown>).triggerEventId) || null);
    res.status(201).json(run);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "integration failed" });
  }
});

router.post("/modules/:id/integrate", requireAuth, requireRole("admin", "maintainer", "reviewer", "developer"), async (req, res) => {
  const module = queryOne<{ moduleKey: string }>(`SELECT module_key AS moduleKey FROM modules WHERE id = ?`, [Number(req.params.id)]);
  if (!module) {
    res.status(404).json({ error: "module not found" });
    return;
  }
  res.status(201).json(await createIntegrationRun(module.moduleKey, null));
});

router.get("/repairs", requireAuth, (_req, res) => {
  res.json(queryAll(`SELECT id, event_id AS eventId, impact_id AS impactId, status, provenance_json AS provenanceJson, created_at AS createdAt
    FROM repair_bundles ORDER BY id DESC LIMIT 100`).map((row) => ({ ...row, provenance: parseJson(row.provenanceJson, {}) })));
});

router.post("/repairs", requireAuth, requireRole("admin", "maintainer", "reviewer", "developer"), (req, res) => {
  const impactId = Number((req.body as Record<string, unknown>).impactId);
  try {
    res.status(201).json(createRepairBundle(impactId, actor(req)?.username ?? "system"));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "repair bundle failed" });
  }
});

router.get("/repairs/:id", requireAuth, (req, res) => {
  const row = queryOne(`SELECT id, event_id AS eventId, impact_id AS impactId, status, diff, tests_patch AS testsPatch,
    test_report_json AS testReportJson, provenance_json AS provenanceJson, created_at AS createdAt FROM repair_bundles WHERE id = ?`, [Number(req.params.id)]);
  if (!row) {
    res.status(404).json({ error: "repair not found" });
    return;
  }
  res.json({ ...row, testReport: parseJson(row.testReportJson, {}), provenance: parseJson(row.provenanceJson, {}) });
});

router.get("/repairs/:id/bundle", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = queryOne<{ impactId: number }>(`SELECT impact_id AS impactId FROM repair_bundles WHERE id = ?`, [id]);
  const dir = path.resolve(process.cwd(), "data/repair-bundles", String(row?.impactId ?? id));
  if (!fs.existsSync(dir)) {
    res.status(404).json({ error: "bundle not found; create or regenerate it first" });
    return;
  }
  res.json({ id, dir, files: fs.readdirSync(dir).sort() });
});

router.get("/repairs/:id/files/:name", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const name = path.basename(String(req.params.name));
  const row = queryOne<{ impactId: number }>(`SELECT impact_id AS impactId FROM repair_bundles WHERE id = ?`, [id]);
  const baseDir = path.resolve(process.cwd(), "data/repair-bundles");
  const file = path.resolve(baseDir, String(row?.impactId ?? id), name);
  // startsWith 必须带路径分隔符，否则 base-dir-2 这类兄弟目录会绕过检查
  if (!file.startsWith(`${baseDir}${path.sep}`) || !fs.existsSync(file)) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  res.download(file, name);
});

router.post("/repairs/:id/test", requireAuth, requireRole("admin", "maintainer", "reviewer", "developer"), (req, res) => {
  const id = Number(req.params.id);
  execute(`UPDATE repair_bundles SET status = 'tested', test_report_json = ? WHERE id = ?`, [JSON.stringify({ status: "passed", testedAt: new Date().toISOString(), tester: actor(req)?.username }) , id]);
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "repair_test", "repair_bundle", id, { status: "passed" });
  res.json({ ok: true, status: "tested" });
});

router.post("/repairs/:id/approve", requireAuth, requireRole("admin", "maintainer", "reviewer"), (req, res) => {
  const id = Number(req.params.id);
  const row = queryOne<{ status: string }>(`SELECT status FROM repair_bundles WHERE id = ?`, [id]);
  if (!row) {
    res.status(404).json({ error: "repair not found" });
    return;
  }
  if (row.status !== "tested") {
    res.status(400).json({ error: "repair must be tested before approval" });
    return;
  }
  execute(`UPDATE repair_bundles SET status = 'approved' WHERE id = ?`, [id]);
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "repair_approve", "repair_bundle", id, { directWriteAllowed: false });
  res.json({ ok: true, status: "approved", nextStep: "create_fix_branch_and_pull_request" });
});

router.post("/repairs/:id/create-pr", requireAuth, requireRole("admin", "maintainer", "reviewer"), async (req, res) => {
  const id = Number(req.params.id);
  const repair = queryOne<{ id: number; status: string; diff: string; provenance_json: string; impact_id: number }>(
    `SELECT id, status, diff, provenance_json, impact_id FROM repair_bundles WHERE id = ?`, [id]
  );
  if (!repair) {
    res.status(404).json({ error: "repair not found" });
    return;
  }
  if (repair.status !== "approved") {
    res.status(400).json({ error: "repair must be approved before PR creation" });
    return;
  }
  if (!config.giteeToken || !config.giteeRepo) {
    res.status(400).json({ error: "Gitee token and GITEE_REPO are required for PR creation" });
    return;
  }
  const body = req.body as { title?: string; description?: string; base?: string; branchName?: string };
  const branchName = body.branchName ?? `giteehelper/repair-${id}`;
  const base = body.base ?? config.giteeDefaultBranch;
  try {
    await createBranch(config.giteeRepo, branchName, base);
    const pr = await createPullRequest(
      config.giteeRepo,
      body.title ?? `GiteeHelper repair ${id}`,
      branchName,
      base,
      `${body.description ?? "GiteeHelper approved repair bundle"}\n\n\`\`\`diff\n${repair.diff}\n\`\`\``
    );
    audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "repair_create_pr", "repair_bundle", id, { branchName, base, directWriteAllowed: false });
    res.status(201).json({ ok: true, branchName, pullRequest: pr });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Gitee PR creation failed" });
  }
});

router.get("/integrations", requireAuth, (_req, res) => {
  res.json({
    gitee: {
      configured: Boolean(config.giteeToken),
      apiBase: config.giteeApiBase,
      repo: config.giteeRepo || null,
      defaultBranch: config.giteeDefaultBranch,
      webhookSecret: Boolean(config.giteeWebhookSecret)
    },
    feishu: {
      configured: Boolean(config.feishuWebhookUrl),
      mode: config.feishuWebhookUrl ? "webhook" : "dry-run"
    },
    commits: commitStats(),
    deliveries: listWebhookDeliveries(10),
    settings: publicRuntimeSettings()
  });
});

router.get("/settings", requireAuth, requireAdmin, (_req, res) => {
  res.json(publicRuntimeSettings());
});

router.patch("/settings", requireAuth, requireAdmin, (req, res) => {
  try {
    const changed = updateRuntimeSettings(req.body as Record<string, unknown>);
    audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "settings_update", "settings", "runtime", {
      fields: Object.keys(changed),
      secretFields: Object.keys(changed).filter((key) => ["giteeToken", "giteeWebhookSecret", "feishuWebhookUrl"].includes(key))
    });
    res.json({ ok: true, changed: Object.keys(changed), settings: publicRuntimeSettings() });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "settings update failed" });
  }
});

router.post("/integrations/gitee/test", requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await testGiteeConnection());
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Gitee connection failed" });
  }
});

router.post("/integrations/feishu/test", requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await sendFeishuText("【GiteeHelper】飞书连接测试成功。"));
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Feishu connection failed" });
  }
});

router.post("/gitee/sync", requireAuth, requireAdmin, async (req, res) => {
  if (!config.giteeRepo) {
    res.status(400).json({ error: "GITEE_REPO is not configured" });
    return;
  }
  const only = String((req.body as Record<string, unknown>)?.only ?? "all");
  try {
    const saved: Array<{ id: number; impacts: number }> = [];
    if (only !== "commits") {
      const pulls = await listPullRequests(config.giteeRepo);
      for (const pull of pulls) {
        const mergedAt = pull.merged_at;
        // PR 事件不带文件就只能语义猜词：sync-pulls 已把文件列表落库，这里直接复用缓存
        const pullNumber = Number(pull.number ?? 0);
        const cached = pullNumber
          ? queryOne<{ filesJson: string }>(`SELECT files_json AS filesJson FROM pull_requests WHERE project_id = 1 AND number = ?`, [pullNumber])
          : undefined;
        const event: EventInput = {
          source: "gitee",
          sourceId: `pull-${String(pull.id ?? pull.number)}`,
          eventType: "pull_request",
          action: mergedAt ? "merged" : String(pull.state ?? "open"),
          title: String(pull.title ?? `Pull Request ${pull.number}`),
          author: String((pull.user as Record<string, unknown> | undefined)?.login ?? "unknown"),
          branch: String((pull.base as Record<string, unknown> | undefined)?.ref ?? config.giteeDefaultBranch),
          url: String(pull.html_url ?? ""),
          payload: { pull_request: pull, files: cached ? parseJson<string[]>(cached.filesJson, []) : [], body: String(pull.body ?? "") }
        };
        const result = persistEventAndImpacts(event);
        saved.push({ id: result.eventId, impacts: result.impacts.length });
      }
    }

    // 提交补齐：WebHook 需要公网回调，手动同步用于首次建图和断档回填
    const commitsImported: Array<{ sha: string; conflict: boolean }> = [];
    let detailBudget = 20;
    if (only !== "pulls") {
      const recent = await listGiteeCommits(config.giteeRepo, config.giteeDefaultBranch, 30);
      for (const commit of recent) {
        if (findCommitBySha(commit.sha)) continue;
        let enriched = commit;
        if (detailBudget > 0) {
          detailBudget -= 1;
          const detail = await fetchCommitDetail(config.giteeRepo, commit.sha).catch(() => undefined);
          if (detail) enriched = { ...commit, ...detail };
        }
        const result = ingestCommit(enriched);
        if (result.created) commitsImported.push({ sha: commit.sha, conflict: Boolean(result.analysis?.conflict) });
      }
    }

    audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "gitee_sync", "project", config.giteeRepo, {
      pulls: saved.length, commits: commitsImported.length
    });
    res.json({
      ok: true,
      pulls: saved.length,
      events: saved,
      commits: commitsImported.length,
      conflicts: commitsImported.filter((commit) => commit.conflict).length
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Gitee sync failed" });
  }
});

router.post("/webhooks/gitee", (req, res) => {
  const token = req.header("x-gitee-token");
  const timestamp = req.header("x-gitee-timestamp");
  const headerEvent = req.header("x-gitee-event");
  const hookName = headerEvent ?? null;
  const payload = (req.body ?? {}) as Record<string, unknown>;
  if (!verifyGiteeSignature(config.giteeWebhookSecret, token, timestamp)) {
    recordWebhookDelivery({ hookName, status: "rejected", detail: "签名校验失败或未配置 WebHook Secret" });
    res.status(401).json({ error: "invalid webhook signature" });
    return;
  }
  // 先确认接收再后台分析：Gitee 对回调有超时限制，慢响应会导致重复投递
  res.status(202).json({ ok: true, accepted: true });
  setImmediate(() => {
    void ingestGiteeWebhook(payload, headerEvent ?? undefined, hookName).catch((error) => {
      console.error("[gitee webhook]", error instanceof Error ? error.message : error);
    });
  });
});

router.get("/pulls", requireAuth, (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const limit = Number(req.query.limit) || 100;
  res.json({ pulls: listPulls({ state, limit }), stats: pullStats() });
});

router.get("/pulls/graph", requireAuth, (req, res) => {
  res.json(pullGraph(Number(req.query.limit) || 120));
});

router.get("/pulls/:number", requireAuth, (req, res) => {
  const pull = getPull(Number(req.params.number));
  if (!pull) {
    res.status(404).json({ error: "pull not found" });
    return;
  }
  res.json(pull);
});

router.get("/repo/pattern-health", requireAuth, async (_req, res) => {
  try {
    res.json(await patternHealth());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "pattern health failed" });
  }
});

router.get("/repo/pattern-fix", requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await patternFixPreview());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "preview failed" });
  }
});

router.post("/repo/pattern-fix", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await applyPatternFixes({ includeReview: body.includeReview === true }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "apply failed" });
  }
});

router.get("/reasons", requireAuth, (_req, res) => {
  res.json({
    natures: NATURE_LABELS as Record<ReasonNature, string>,
    samples: classifyReasons({ files: [], semanticOnly: true })
  });
});

// 契约归属：RFC meta 反查工作项，比人写的 glob 可靠。这里只读，同步与落库走 admin 接口或 CLI。
router.get("/repo/rfc-contracts", requireAuth, (_req, res) => {
  const contracts = listRfcContracts();
  res.json({
    contracts: contracts.length,
    withTasks: contracts.filter((item) => item.workRefs.length > 0).length,
    coverage: rfcCoverage(),
    plan: planRfcPatterns().map((item) => ({
      moduleKey: item.moduleKey, moduleName: item.moduleName, owner: item.owner, rfc: item.slug, added: item.added
    })),
    items: contracts
  });
});

router.post("/repo/rfc-sync", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await syncRfcContracts();
    res.json(body.applyPatterns === true ? { ...result, applied: applyRfcPatterns() } : result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "rfc sync failed" });
  }
});

router.post("/gitee/sync-pulls", requireAuth, requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    res.json(await syncPullRequests({ withComments: body.withComments === true, withFiles: true }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "pull sync failed" });
  }
});

router.get("/webhooks/deliveries", requireAuth, (_req, res) => {
  res.json(listWebhookDeliveries(20));
});

router.get("/repo/graph", requireAuth, (req, res) => {
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.max(Math.trunc(requested), 10), 300) : 80;
  res.json(buildRepoGraph(limit));
});

router.get("/commits", requireAuth, (req, res) => {
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.trunc(requested), 300) : 120;
  res.json({ commits: listCommits(limit), stats: commitStats() });
});

router.get("/commits/:sha", requireAuth, (req, res) => {
  const commit = getCommit(String(req.params.sha));
  if (!commit) {
    res.status(404).json({ error: "commit not found" });
    return;
  }
  res.json(commit);
});

router.get("/gitee/status", requireAuth, async (_req, res) => {
  if (!config.giteeToken) {
    res.json({ configured: false });
    return;
  }
  try {
    res.json({ configured: true, ...(await testGiteeConnection()) });
  } catch (error) {
    res.status(400).json({ configured: true, ok: false, error: error instanceof Error ? error.message : "Gitee connection failed" });
  }
});

// ---- 进度：任务全景 / 个人轨迹 / 初始化向导 ----

router.get("/progress/board", requireAuth, (_req, res) => {
  res.json(buildBoard());
});

router.get("/progress/people", requireAuth, (_req, res) => {
  res.json(buildPeople());
});

router.get("/progress/pulls", requireAuth, (_req, res) => {
  res.json(buildPullDetails());
});

router.get("/progress/timeline", requireAuth, (_req, res) => {
  res.json(buildTimeline());
});

router.get("/progress/association-candidates", requireAuth, requireAdmin, (_req, res) => {
  res.json(associationCandidates());
});

router.get("/progress/blockers", requireAuth, (_req, res) => {
  res.json(listBlockers());
});

router.post("/progress/blocker", requireAuth, requireRole("admin", "maintainer"), (req, res) => {
  const body = (req.body ?? {}) as { moduleId?: number; blocked?: boolean | null; blockerNote?: string; actionNote?: string };
  if (!Number(body.moduleId)) {
    res.status(400).json({ error: "moduleId 必填" });
    return;
  }
  const blocked = body.blocked === null || body.blocked === undefined ? null : Boolean(body.blocked);
  res.json(upsertBlocker(1, Number(body.moduleId), blocked, String(body.blockerNote ?? ""), String(body.actionNote ?? ""), actor(req)?.username ?? "system"));
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "blocker_update", "module", Number(body.moduleId), { blocked });
});

router.post("/progress/confirm-association", requireAuth, requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as { pullNumber?: number; moduleId?: number };
  if (!Number(body.pullNumber) || !Number(body.moduleId)) {
    res.status(400).json({ error: "pullNumber 和 moduleId 必填" });
    return;
  }
  res.json(confirmAssociation(Number(body.pullNumber), Number(body.moduleId)));
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "association_confirm", "module", Number(body.moduleId), { pullNumber: Number(body.pullNumber) });
});

router.post("/progress/dismiss-association", requireAuth, requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as { pullNumber?: number; moduleId?: number };
  if (!Number(body.pullNumber) || !Number(body.moduleId)) {
    res.status(400).json({ error: "pullNumber 和 moduleId 必填" });
    return;
  }
  res.json(dismissAssociation(Number(body.pullNumber), Number(body.moduleId)));
  audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "association_dismiss", "module", Number(body.moduleId), { pullNumber: Number(body.pullNumber) });
});

router.post("/progress/backfill-comments", requireAuth, requireAdmin, async (req, res) => {
  // 分块执行：每次最多 max 个 PR 的评论，调用方循环到 remaining 为 0
  const max = Math.min(Number((req.body as Record<string, unknown> | undefined)?.max) || 40, 200);
  try {
    res.json(await backfillPullComments({ max }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "comment backfill failed" });
  }
});

router.get("/progress/export.xlsx", requireAuth, async (_req, res) => {
  try {
    const buffer = await buildProgressWorkbook();
    const name = `进度数据-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="progress-export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "export failed" });
  }
});

router.get("/progress/status", requireAuth, (_req, res) => {
  const missing = queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM pull_requests WHERE project_id = 1 AND state = 'merged' AND files_json = '[]'`
  )?.c ?? 0;
  const missingAuthors = queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM pull_requests WHERE project_id = 1 AND authors_json IS NULL`
  )?.c ?? 0;
  const pulls = queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM pull_requests WHERE project_id = 1`)?.c ?? 0;
  res.json({ missingMergedFiles: missing, missingAuthors, pulls });
});

router.post("/progress/ai-associate", requireAuth, requireAdmin, async (req, res) => {
  // 分块执行：每次最多 max 条 PR，调用方循环到 remaining 为 0
  const max = Math.min(Number((req.body as Record<string, unknown> | undefined)?.max) || 30, 100);
  try {
    res.json(await aiAssociatePulls({ max }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "ai associate failed" });
  }
});

router.post("/progress/backfill-authors", requireAuth, requireAdmin, async (req, res) => {
  // 与文件回填一样分块可续跑：每次最多 max 条，调用方循环到 remaining 为 0
  const max = Math.min(Number((req.body as Record<string, unknown> | undefined)?.max) || 40, 200);
  try {
    res.json(await backfillPullAuthors({ max }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "backfill failed" });
  }
});

router.post("/progress/backfill-files", requireAuth, requireAdmin, async (req, res) => {
  // 分块执行：每次最多 max 条，调用方循环到 remaining 为 0（避免代理超时）
  const max = Math.min(Number((req.body as Record<string, unknown> | undefined)?.max) || 40, 200);
  try {
    res.json(await backfillMergedFiles({ max }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "backfill failed" });
  }
});

router.post("/progress/import/parse", requireAuth, requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as { mode?: string; content?: string };
  try {
    const preview = body.mode === "text"
      ? await parseAssignmentWithLlm(String(body.content ?? ""))
      : parseAssignmentCsv(String(body.content ?? ""));
    res.json(preview);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "parse failed" });
  }
});

router.post("/progress/import/apply", requireAuth, requireAdmin, (req, res) => {
  try {
    const result = applyAssignment((req.body ?? {}) as never, actor(req)?.username ?? "system");
    audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "progress_import", "project", 1, result);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "import failed" });
  }
});

router.get("/progress/identity-suggestions", requireAuth, requireAdmin, (_req, res) => {
  res.json(identitySuggestions());
});

router.post("/progress/identity", requireAuth, requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as { alias?: string; userId?: number };
  if (!body.alias?.trim() || !Number(body.userId)) {
    res.status(400).json({ error: "alias 和 userId 必填" });
    return;
  }
  res.json(upsertIdentityAlias(body.alias, Number(body.userId)));
});

// 未匹配的 /api 路径必须返回 JSON 404；否则会落到前端静态兜底并返回 200 + index.html
router.use((req, res) => {
  res.status(404).json({ error: "route not found", path: req.originalUrl });
});

export default router;
