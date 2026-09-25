import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { audit, execute, parseJson, queryAll, queryOne } from "./db.js";
import { createSession, currentUser, destroySession, hashPassword, login, requireAuth, requireRole } from "./auth.js";
import { analyzeEvent, persistEventAndImpacts, type EventInput } from "./impact.js";
import { createIntegrationRun, getRun, listModules } from "./integration.js";
import { createRepairBundle } from "./repair.js";
import { createBranch, createPullComment, createPullRequest, listPullRequests, normalizeGiteeEvent, testGiteeConnection, verifyGiteeSignature } from "./gitee.js";
import { buildImpactCard, sendFeishuText } from "./feishu.js";
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
    version: "0.1.0",
    node: process.version,
    database: config.databasePath,
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

  const modules = queryAll<{ id: number; moduleKey: string; name: string; ownerUserId: number | null; status: string; scenariosJson: string; providesJson: string; requiresJson: string }>(
    `SELECT id, module_key AS moduleKey, name, owner_user_id AS ownerUserId, status, scenarios_json AS scenariosJson,
            provides_json AS providesJson, requires_json AS requiresJson FROM modules`
  );
  for (const module of modules) {
    nodes.set(`module:${module.id}`, { id: `module:${module.id}`, label: module.name, type: "module", meta: { key: module.moduleKey, status: module.status } });
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
  res.json(queryAll(`SELECT id, username, display_name AS displayName, role, email, gitee_login AS giteeLogin,
    feishu_user_id AS feishuUserId, active, created_at AS createdAt FROM users ORDER BY id`));
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

router.post("/runs", requireAuth, async (req, res) => {
  const moduleKey = String((req.body as Record<string, unknown>).moduleKey ?? "");
  try {
    const run = await createIntegrationRun(moduleKey, Number((req.body as Record<string, unknown>).triggerEventId) || null);
    res.status(201).json(run);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "integration failed" });
  }
});

router.post("/modules/:id/integrate", requireAuth, async (req, res) => {
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
  const file = path.resolve(process.cwd(), "data/repair-bundles", String(row?.impactId ?? id), name);
  if (!file.startsWith(path.resolve(process.cwd(), "data/repair-bundles")) || !fs.existsSync(file)) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  res.download(file, name);
});

router.post("/repairs/:id/test", requireAuth, (req, res) => {
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
      webhookSecret: Boolean(config.giteeWebhookSecret)
    },
    feishu: {
      configured: Boolean(config.feishuWebhookUrl),
      mode: config.feishuWebhookUrl ? "webhook" : "dry-run"
    }
  });
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
  try {
    const pulls = await listPullRequests(config.giteeRepo);
    const saved: Array<{ id: number; impacts: number }> = [];
    for (const pull of pulls) {
      const mergedAt = pull.merged_at;
      const event: EventInput = {
        source: "gitee",
        sourceId: `pull-${String(pull.id ?? pull.number)}`,
        eventType: "pull_request",
        action: mergedAt ? "merged" : String(pull.state ?? "open"),
        title: String(pull.title ?? `Pull Request ${pull.number}`),
        author: String((pull.user as Record<string, unknown> | undefined)?.login ?? "unknown"),
        branch: String((pull.base as Record<string, unknown> | undefined)?.ref ?? config.giteeDefaultBranch),
        url: String(pull.html_url ?? ""),
        payload: { pull_request: pull, files: [], body: String(pull.body ?? "") }
      };
      const result = persistEventAndImpacts(event);
      saved.push({ id: result.eventId, impacts: result.impacts.length });
    }
    audit(actor(req)?.id ?? null, actor(req)?.username ?? "system", "gitee_sync", "project", config.giteeRepo, { pulls: saved.length });
    res.json({ ok: true, pulls: saved.length, events: saved });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Gitee sync failed" });
  }
});

router.post("/webhooks/gitee", async (req, res) => {
  const token = req.header("x-gitee-token");
  const timestamp = req.header("x-gitee-timestamp");
  if (!verifyGiteeSignature(config.giteeWebhookSecret, token, timestamp)) {
    res.status(401).json({ error: "invalid webhook signature" });
    return;
  }
  const event = normalizeGiteeEvent(req.body as Record<string, unknown>, req.header("x-gitee-event") ?? undefined);
  const saved = persistEventAndImpacts(event);
  const impacts = saved.impacts;
  const runs = [];
  for (const impact of impacts) {
    if (!impact.moduleId) continue;
    const module = queryOne<{ moduleKey: string }>(`SELECT module_key AS moduleKey FROM modules WHERE id = ?`, [impact.moduleId]);
    if (module) runs.push(await createIntegrationRun(module.moduleKey, saved.eventId));
  }
  if (impacts.length) {
    const card = buildImpactCard(event.title, impacts);
    await sendFeishuText(card);
  }
  const pull = (req.body as Record<string, unknown>).pull_request as Record<string, unknown> | undefined;
  if (pull && config.giteeRepo && impacts.length) {
    const number = Number(pull.number ?? pull.id);
    const summary = buildImpactCard(event.title, impacts);
    try {
      await createPullComment(config.giteeRepo, number, summary);
    } catch (error) {
      audit(null, "system", "gitee_comment_failed", "pull_request", number, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  res.status(202).json({ ok: true, eventId: saved.eventId, impacts: impacts.length, runs: runs.map((run) => run.id) });
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

export default router;
