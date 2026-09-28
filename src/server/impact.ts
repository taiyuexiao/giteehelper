import type { Evidence, Impact, Module, Rule, Severity } from "../shared/types.js";
import { audit, execute, parseJson, queryAll, queryOne } from "./db.js";

export interface EventInput {
  source: string;
  sourceId: string;
  eventType: string;
  action: string;
  title: string;
  author: string;
  branch?: string;
  url?: string;
  payload?: Record<string, unknown>;
}

const severityRank: Record<Severity, number> = {
  blocking: 5,
  contract: 4,
  implementation: 3,
  clarification: 2,
  informational: 1
};

const categoryKeywords: Record<string, string[]> = {
  requirement: ["需求", "产品", "验收", "流程", "行为", "场景"],
  specification: ["规范", "标准", "约定", "必须", "不得", "统一", "命名"],
  contract: ["接口", "api", "字段", "schema", "事件", "数据", "兼容", "版本"],
  implementation: ["代码", "实现", "组件", "函数", "重构", "性能"],
  review: ["review", "评论", "审查", "合并", "建议", "改为"]
};

function wildcardMatch(value: string, pattern: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  const regex = new RegExp(`^${pattern.split("**").join(".*").split("*").join("[^/]*")}$`, "i");
  return regex.test(normalized);
}

function collectPaths(payload: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) paths.add(value.trim());
    if (Array.isArray(value)) value.forEach(add);
    if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      for (const key of ["path", "filename", "modified", "added", "removed", "files"]) add(item[key]);
    }
  };
  add(payload.files);
  add(payload.commits);
  add(payload.paths);
  return [...paths];
}

function textOf(payload: Record<string, unknown>): string {
  return [payload.title, payload.body, payload.note, payload.message, payload.summary]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function matchKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

function ruleMatches(rule: Rule, event: EventInput, paths: string[], text: string) {
  const trigger = rule.trigger as Record<string, unknown>;
  const condition = rule.condition as Record<string, unknown>;
  const eventTypes = trigger.eventTypes as string[] | undefined;
  const branches = trigger.branches as string[] | undefined;
  const keywords = condition.keywords as string[] | undefined;
  const anyPath = condition.anyPath as string[] | undefined;
  if (eventTypes?.length && !eventTypes.includes(event.eventType)) return false;
  if (branches?.length && (!event.branch || !branches.includes(event.branch))) return false;
  if (keywords?.length && matchKeywords(text, keywords).length === 0) return false;
  if (anyPath?.length && !paths.some((path) => anyPath.some((pattern) => wildcardMatch(path, pattern)))) return false;
  return Boolean(eventTypes?.length || branches?.length || keywords?.length || anyPath?.length);
}

const genericTerms = new Set([
  "功能", "文档", "数据", "接口", "模块", "项目", "测试", "系统", "页面", "用户", "工作", "实现",
  "配置", "服务", "运行", "报告", "平台", "模型", "内容", "列表", "详情", "基础", "统一", "支持",
  "管理", "生成", "记录", "结果", "指标", "流程", "代码", "技术", "产品", "设计", "方案", "要求",
  "环境", "性能", "安全", "权限", "账号", "登录", "工作台"
]);

export function isOperationalModule(module: Pick<Module, "moduleKey" | "name">) {
  return !module.name.trim().startsWith("[示例]") && !module.name.trim().startsWith("[旧导入]") &&
    !module.moduleKey.trim().startsWith("[示例]") && !module.moduleKey.trim().startsWith("[旧导入]");
}

function moduleMatches(module: Module, paths: string[], text: string): { matched: boolean; evidence: Evidence[] } {
  const evidence: Evidence[] = [];
  for (const path of paths) {
    if (module.paths.some((pattern) => wildcardMatch(path, pattern))) {
      evidence.push({ type: "path", id: path, label: `变更路径 ${path}` });
    }
  }

  const terms = [...text.toLowerCase().matchAll(/[\p{L}\p{N}_-]{2,}/gu)].map((match) => match[0]);
  const strongTerms = [...new Set(terms.filter((term) => !genericTerms.has(term)))];
  const exactTargets = [
    module.name.toLowerCase(),
    module.moduleKey.toLowerCase(),
    ...module.scenarios.map((item) => item.toLowerCase()),
    ...module.provides.map((item) => item.key.toLowerCase()),
    ...module.requires.map((item) => item.key.toLowerCase())
  ];
  const exactTerms = strongTerms.filter((term) => exactTargets.some((target) => target.includes(term))).slice(0, 3);
  for (const term of exactTerms) evidence.push({ type: "semantic", id: term, label: `精确关联 ${term}` });

  const description = (module.description ?? "").toLowerCase();
  const descriptionTerms = strongTerms.filter((term) => term.length >= 3 && description.includes(term));
  if (exactTerms.length === 0 && descriptionTerms.length >= 2) {
    for (const term of descriptionTerms.slice(0, 2)) evidence.push({ type: "semantic", id: term, label: `描述关联 ${term}` });
  }

  return { matched: evidence.length > 0, evidence };
}

function classify(event: EventInput, paths: string[], text: string): { severity: Severity; category: string; nextAction: string } {
  const isMain = event.branch === "main" || event.branch === "master";
  const isMerged = ["merged", "merge", "closed"].includes(event.action.toLowerCase());
  const contractPath = paths.some((path) => /contract|openapi|asyncapi|schema|api\//i.test(path));
  const documentPath = paths.some((path) => /docs?\//i.test(path) || /\.(md|mdx)$/i.test(path));
  const keywordCategory = Object.entries(categoryKeywords)
    .map(([category, keywords]) => ({ category, matches: matchKeywords(text, keywords) }))
    .sort((a, b) => b.matches.length - a.matches.length)[0];

  if (contractPath) return { severity: "contract", category: "contract", nextAction: "检查接口、事件、数据字段和兼容版本" };
  if (isMain && isMerged && documentPath) return { severity: "blocking", category: "requirement", nextAction: "更新模块设计/代码并确认验收条件" };
  if (event.eventType === "note") return { severity: "clarification", category: "review", nextAction: "确认评论是否改变需求或契约" };
  if (keywordCategory?.matches.length) return { severity: keywordCategory.category === "specification" ? "blocking" : "implementation", category: keywordCategory.category, nextAction: "检查受影响模块并补充测试" };
  return { severity: "informational", category: "change", nextAction: "查看变化是否需要下游调整" };
}

export function analyzeEvent(event: EventInput, projectId = 1) {
  const payload = event.payload ?? {};
  const paths = collectPaths(payload);
  const text = `${event.title}\n${textOf(payload)}`;
  const base = classify(event, paths, text);
  type ModuleRow = Module & {
    owner_user_id: number | null;
    paths_json: string;
    scenarios_json: string;
    provides_json: string;
    requires_json: string;
  };
  type RuleRow = Rule & {
    triggerJson: string;
    conditionJson: string;
    actionJson: string;
  };
  const modules = queryAll<ModuleRow>(
    `SELECT m.id, m.module_key AS moduleKey, m.name, m.owner_user_id, u.display_name AS ownerName,
            m.status, m.paths_json, m.scenarios_json, m.provides_json, m.requires_json, m.test_command AS testCommand, m.description
     FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id WHERE m.project_id = ?`,
    [projectId]
  ).filter((row) => isOperationalModule(row)).map((row) => ({
    ...row,
    paths: parseJson<string[]>(row.paths_json, []),
    scenarios: parseJson<string[]>(row.scenarios_json, []),
    provides: parseJson<{ key: string; version: string }[]>(row.provides_json, []),
    requires: parseJson<{ key: string; version: string; mode?: "required" | "optional" }[]>(row.requires_json, [])
  }));
  const rules = queryAll<RuleRow>(
    `SELECT id, rule_key AS ruleKey, name, enabled, severity, trigger_json AS triggerJson, condition_json AS conditionJson, action_json AS actionJson, version, updated_at AS updatedAt
     FROM rules WHERE project_id = ? AND enabled = 1`,
    [projectId]
  ).map((row) => ({
    ...row,
    trigger: parseJson<Record<string, unknown>>(row.triggerJson, {}),
    condition: parseJson<Record<string, unknown>>(row.conditionJson, {}),
    action: parseJson<Record<string, unknown>>(row.actionJson, {})
  }));

  const matchedRules = rules.filter((rule) => ruleMatches(rule, event, paths, text));
  const ruleSeverity = matchedRules.map((rule) => rule.severity).sort((a, b) => severityRank[b] - severityRank[a])[0];
  const severity = ruleSeverity && severityRank[ruleSeverity] > severityRank[base.severity] ? ruleSeverity : base.severity;
  const category = matchedRules[0] ? (matchedRules[0].condition.category as string | undefined) ?? base.category : base.category;
  const nextAction = String(matchedRules[0]?.action.nextAction ?? base.nextAction);
  const results: Omit<Impact, "id" | "createdAt">[] = [];

  for (const module of modules) {
    const match = moduleMatches(module, paths, text);
    const sharedScenario = module.scenarios.some((scenario) => text.toLowerCase().includes(scenario.toLowerCase()));
    if (!match.matched && !sharedScenario) continue;
    if (sharedScenario && !match.evidence.some((item) => item.type === "scenario")) {
      match.evidence.push({ type: "scenario", label: "共享业务场景" });
    }
    results.push({
      eventId: 0,
      moduleId: module.id,
      userId: module.owner_user_id,
      severity,
      category,
      reason: `${event.title} 影响模块「${module.name}」：${matchedRules[0]?.name ?? base.category}。`,
      evidence: [
        ...match.evidence,
        ...(event.url ? [{ type: "event", id: event.sourceId, label: "来源变化", url: event.url }] : []),
        ...matchedRules.map((rule) => ({ type: "rule", id: rule.ruleKey, label: rule.name }))
      ],
      nextAction,
      status: "open"
    });
  }

  if (results.length === 0 && ["blocking", "contract", "clarification"].includes(severity)) {
    results.push({
      eventId: 0,
      moduleId: null,
      userId: null,
      severity,
      category,
      reason: `${event.title} 可能产生全局影响，但当前模块清单没有明确归属。`,
      evidence: [
        ...(paths.slice(0, 5).map((path) => ({ type: "path", id: path, label: `变更路径 ${path}` }))),
        ...(event.url ? [{ type: "event", id: event.sourceId, label: "来源变化", url: event.url }] : [])
      ],
      nextAction: "确认模块归属并补充负责人",
      status: "open"
    });
  }

  return { event, paths, severity, category, nextAction, impacts: results };
}

export function persistEventAndImpacts(event: EventInput, projectId = 1) {
  const existing = queryOne<{ id: number }>(
    `SELECT id FROM change_events WHERE project_id = ? AND source = ? AND source_id = ? AND event_type = ? AND action = ?`,
    [projectId, event.source, event.sourceId, event.eventType, event.action]
  );
  if (existing) return { eventId: existing.id, impacts: [] as Impact[] };
  const result = execute(
    `INSERT INTO change_events (project_id, source, source_id, event_type, action, title, author, branch, url, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectId, event.source, event.sourceId, event.eventType, event.action, event.title, event.author, event.branch ?? null, event.url ?? null, JSON.stringify(event.payload ?? {})]
  );
  const eventId = Number(result.lastInsertRowid);
  const analysis = analyzeEvent({ ...event, payload: event.payload ?? {} }, projectId);
  const impacts: Impact[] = [];
  for (const item of analysis.impacts) {
    const inserted = execute(
      `INSERT INTO impacts (event_id, module_id, user_id, severity, category, reason, evidence_json, next_action, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, item.moduleId, item.userId, item.severity, item.category, item.reason, JSON.stringify(item.evidence), item.nextAction, item.status]
    );
    impacts.push({ ...item, id: Number(inserted.lastInsertRowid), eventId, createdAt: new Date().toISOString() });
  }
  audit(null, "system", "analyze_event", "change_event", eventId, { impacts: impacts.length, severity: analysis.severity });
  return { eventId, impacts };
}
