import type { Evidence, Impact, Module, Rule, Severity } from "../shared/types.js";
import { classifyReasons, hasImplementationFile, primaryReason, type ReasonContext } from "./reason.js";
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
  contract: ["接口", "api", "字段", "schema", "事件", "数据", "兼容", "版本", "迁移", "升级"],
  implementation: ["代码", "实现", "组件", "函数", "重构", "性能", "修复", "修正", "缺陷", "异常", "报错", "崩溃", "超时", "泄漏", "优化"],
  review: ["review", "评论", "审查", "合并", "建议", "改为"]
};

/**
 * 通配符转正则。旧实现先替换 "**" 再替换 "*"，会把生成的 ".*" 再次拆成 ".[^/]*"，
 * 导致 "src/server/**" 只能匹配一层目录，深层路径全部漏配。
 */
export function wildcardMatch(value: string, pattern: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  const source = pattern.replace(/\\/g, "/");
  let regex = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "*") {
      if (source[index + 1] === "*") {
        if (source[index + 2] === "/") {
          regex += "(?:.*/)?";
          index += 2;
        } else {
          regex += ".*";
          index += 1;
        }
      } else {
        regex += "[^/]*";
      }
    } else if (char === "?") {
      regex += "[^/]";
    } else {
      regex += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`, "i").test(normalized);
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
  // 推到主干的提交等价于一次 push，否则面向 push 的规则永远无法作用在提交粒度上
  const effectiveTypes = event.eventType === "commit" ? ["commit", "push"] : [event.eventType];
  if (eventTypes?.length && !eventTypes.some((type) => effectiveTypes.includes(type))) return false;
  if (branches?.length && (!event.branch || !branches.includes(event.branch))) return false;
  if (keywords?.length && matchKeywords(text, keywords).length === 0) return false;
  if (anyPath?.length && !paths.some((path) => anyPath.some((pattern) => wildcardMatch(path, pattern)))) return false;
  return Boolean(eventTypes?.length || branches?.length || keywords?.length || anyPath?.length);
}

const genericTerms = new Set([
  "功能", "文档", "数据", "接口", "模块", "项目", "测试", "系统", "页面", "用户", "工作", "实现",
  "配置", "服务", "运行", "报告", "平台", "模型", "内容", "列表", "详情", "基础", "统一", "支持",
  "管理", "生成", "记录", "结果", "指标", "流程", "代码", "技术", "产品", "设计", "方案", "要求",
  "环境", "性能", "安全", "权限", "账号", "登录", "工作台",
  // 高频但无区分度的变更用语与工程词
  "更新", "新增", "修改", "调整", "优化", "完善", "补充", "删除", "移除", "重构", "修复", "合并",
  "提交", "变更", "改动", "版本", "发布", "上线", "说明", "备注", "问题", "情况", "相关", "进行",
  "一个", "以及", "并且", "可以", "需要", "必须", "使用", "通过", "对于", "当前", "主要", "部分",
  "api", "apis", "docs", "doc", "readme", "md", "mdx", "review", "reviews", "pr", "prs", "commit",
  "commits", "merge", "merged", "revert", "feat", "feature", "fix", "fixes", "bugfix", "chore",
  "refactor", "style", "build", "ci", "test", "tests", "spec", "wip", "draft", "update", "add",
  "added", "remove", "removed", "change", "changed", "rfc", "adr", "tmp", "temp", "src", "main",
  "master", "dev", "develop", "release", "hotfix", "true", "false", "null", "void",
  "run", "runs", "build", "builds", "deploy", "deploys", "page", "pages", "list", "lists",
  "item", "items", "task", "tasks", "work", "works", "file", "files", "name", "names",
  "value", "values", "start", "stop", "open", "close", "check", "checks", "enable",
  "disable", "allow", "avoid", "handle", "ensure", "return", "include", "support", "new",
  "old", "make", "move", "rename", "clean", "improve", "bump", "upgrade", "downgrade",
  "branch", "code", "doc", "index", "base", "core", "common", "utils", "util"
]);

export function isOperationalModule(module: Pick<Module, "moduleKey" | "name">) {
  return !module.name.trim().startsWith("[示例]") && !module.name.trim().startsWith("[旧导入]") &&
    !module.moduleKey.trim().startsWith("[示例]") && !module.moduleKey.trim().startsWith("[旧导入]");
}

const LATIN_TOKEN = /[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*/g;
const CJK_RUN = /[\u3400-\u9fff]+/g;

/**
 * 不能出现在候选词首尾的虚词。
 * 中文按 n-gram 切片时会把连词/助词切进片段里，产生「与安全」「项目与」「的测试」
 * 这类根本不是词的碎片，它们会去命中长模块名并造出大量假影响。
 * 只收几乎不会出现在实词首尾的虚词，避免误伤「在线」「上线」这类真实词。
 */
const BOUNDARY_STOPWORDS = new Set(
  "与和及或的地得是为对从到把被而则就都也很更最等以之其该这那些个们并且但因所按依据向往给跟同于自至了着过吗呢吧啊".split("")
);

function isGenericTerm(term: string) {
  if (genericTerms.has(term)) return true;
  // 由通用词拼出的复合词同样没有区分度，例如 api-docs / docs_update
  const parts = term.split(/[._-]/).filter(Boolean);
  return parts.length > 1 && parts.every((part) => genericTerms.has(part));
}

/**
 * 把变更文本切成候选语义单元：拉丁词按长度>=3 取整词，中日韩文本取 2~4 字 n-gram。
 * 中文没有空格，只按整段取词会导致几乎无法与模块名匹配，因此必须切 n-gram。
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = new Set<string>();
  for (const match of lower.matchAll(LATIN_TOKEN)) {
    if (match[0].length >= 3) tokens.add(match[0]);
  }
  for (const match of lower.matchAll(CJK_RUN)) {
    const run = match[0].slice(0, 80);
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index + size <= run.length; index += 1) {
        const piece = run.slice(index, index + size);
        // 首尾是虚词的片段不是词，直接丢弃（真正的模块全名会以完整片段命中）
        if (BOUNDARY_STOPWORDS.has(piece[0]) || BOUNDARY_STOPWORDS.has(piece[piece.length - 1])) continue;
        tokens.add(piece);
      }
    }
  }
  return [...tokens].filter((term) => !isGenericTerm(term));
}

/** 语义匹配目标只取模块名、模块 Key 和共享场景；契约 Key 不再参与模糊匹配，避免 "api" 命中所有模块。 */
function matchTargets(module: Module): string[] {
  return [module.name, module.moduleKey, ...module.scenarios].map((value) => value.toLowerCase());
}

type ModuleMatch = { matched: boolean; evidence: Evidence[]; terms: string[]; specific: boolean; areas: string[] };

/** 被超过这个数量的模块共用的路径模式/场景只能说明"某个区域变了"，无法定位到具体工作项 */
const SHARED_PATTERN_LIMIT = 2;
/** 语义词的文档频率上限（占模块总数的比例），超过即视为无区分度 */
const SEMANTIC_DF_RATIO = 0.05;

const SHORT_CJK_TERM = /^[\u3400-\u9fff]{2}$/;
/** 单条影响最多保留几条路径证据，其余折叠成计数 */
const EVIDENCE_PATH_LIMIT = 5;
/** 区域影响最多点名几位负责人，超过只报人数 */
const AREA_OWNER_LIMIT = 3;

/**
 * 2 字中文词太容易成为长模块名的子串（"部署" ⊂ "底座 · 目标环境重复部署与回退演练"），
 * 因此只允许与模块名/Key/场景完全相等；3 字及以上才允许子串匹配。
 */
function termMatchesModule(term: string, module: Module): boolean {
  const targets = matchTargets(module);
  return SHORT_CJK_TERM.test(term)
    ? targets.some((target) => target === term)
    : targets.some((target) => target.includes(term));
}

function moduleMatches(module: Module, paths: string[], terms: string[], sharedPatterns: Set<string>): ModuleMatch {
  const evidence: Evidence[] = [];
  const areas: string[] = [];
  let specific = false;

  const pathHits: Evidence[] = [];
  for (const path of paths) {
    const matched = module.paths.filter((pattern) => wildcardMatch(path, pattern));
    if (matched.length === 0) continue;
    // 同一个文件可能同时命中"本模块专有模式"和"区域共用模式"，专有模式优先
    const own = matched.filter((pattern) => !sharedPatterns.has(pattern));
    if (own.length > 0) {
      specific = true;
      pathHits.push({ type: "path", id: path, label: `变更路径 ${path}` });
    } else {
      areas.push(matched[0]);
      // 模式被多个模块共用，说明它只能定位到"区域"；但文件确实落在本模块声明的路径里，
      // 这条证据本身是成立的，必须留下——否则影响就只剩语义猜测，看起来像凭空推断。
      // （是否合并成一条区域影响由 specific 决定，不由证据类型决定）
      pathHits.push({ type: "path", id: path, label: `变更路径 ${path}（区域共用模式 ${matched[0]}）` });
    }
  }
  // 一次提交可能动几十个文件，证据只留前几条，其余折叠成一条计数，避免 evidence_json 无限膨胀
  evidence.push(...pathHits.slice(0, EVIDENCE_PATH_LIMIT));
  if (pathHits.length > EVIDENCE_PATH_LIMIT) {
    evidence.push({
      type: "path",
      id: `+${pathHits.length - EVIDENCE_PATH_LIMIT}`,
      label: `另有 ${pathHits.length - EVIDENCE_PATH_LIMIT} 个文件落在本模块路径模式内`
    });
  }

  const exactTerms = terms.filter((term) => termMatchesModule(term, module)).slice(0, 3);
  if (exactTerms.length > 0) specific = true;
  for (const term of exactTerms) evidence.push({ type: "semantic", id: term, label: `命中 ${term}` });

  // 注意：这里刻意不使用模块 description 做匹配。
  // 描述可能是导入的整段中文工作项正文，任何中文提交都能在里面凑出两个"强语义词"，
  // 从而把大量无关模块判成精确命中。需要按描述匹配时应改为配置路径模式或场景。

  return { matched: evidence.length > 0, evidence, terms: exactTerms, specific, areas };
}

function classify(event: EventInput, paths: string[], text: string): { severity: Severity; category: string; nextAction: string } {
  const isMain = event.branch === "main" || event.branch === "master";
  const isMerged = ["merged", "merge", "closed"].includes(event.action.toLowerCase());
  // 测试文件不算契约：像 DatabaseSchemaSnapshotTest.java 只因为文件名带 Schema 就被判成契约级，
  // 会把一条纯测试提交升级成"阻塞"，制造假冲突
  const isTestPath = (path: string) =>
    /(^|\/)(test|tests|__tests__)\//i.test(path) || /\.(test|spec)\.[jt]sx?$/i.test(path) || /Test\.java$/i.test(path);
  const contractPath = paths.some((path) => !isTestPath(path) && /contract|openapi|asyncapi|schema|api\//i.test(path));
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

export type ReasonOverrides = Pick<ReasonContext, "pull" | "parallelPulls" | "unmergedReferences">;

export function analyzeEvent(event: EventInput, projectId = 1, context: ReasonOverrides = {}) {
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

  const patternOwners = new Map<string, number>();
  for (const module of modules) {
    for (const pattern of new Set(module.paths)) patternOwners.set(pattern, (patternOwners.get(pattern) ?? 0) + 1);
  }
  const sharedPatterns = new Set(
    [...patternOwners.entries()].filter(([, count]) => count > SHARED_PATTERN_LIMIT).map(([pattern]) => pattern)
  );

  const matchedRules = rules.filter((rule) => ruleMatches(rule, event, paths, text));
  const ruleSeverity = matchedRules.map((rule) => rule.severity).sort((a, b) => severityRank[b] - severityRank[a])[0];
  const severity = ruleSeverity && severityRank[ruleSeverity] > severityRank[base.severity] ? ruleSeverity : base.severity;
  const category = matchedRules[0] ? (matchedRules[0].condition.category as string | undefined) ?? base.category : base.category;
  const nextAction = String(matchedRules[0]?.action.nextAction ?? base.nextAction);
  const results: Omit<Impact, "id" | "createdAt">[] = [];

  const terms = tokenize(text);
  const matches = new Map<number, ModuleMatch>();
  const documentFrequency = new Map<string, number>();
  for (const module of modules) {
    const match = moduleMatches(module, paths, terms, sharedPatterns);
    matches.set(module.id, match);
    for (const term of new Set(match.terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  // 命中过多模块的语义词没有区分度。阈值按模块总数取相对值：模块越多，能被接受的命中面越窄
  const ambiguityFloor = Math.max(2, Math.ceil(modules.length * SEMANTIC_DF_RATIO));
  const isInformative = (term: string) => (documentFrequency.get(term) ?? 0) <= ambiguityFloor;

  const areaBuckets = new Map<string, { count: number; owners: Set<string> }>();

  for (const module of modules) {
    const match = matches.get(module.id)!;
    const evidence = match.evidence.filter((item) => item.type !== "semantic" || !item.id || isInformative(item.id));
    const sharedScenario = module.scenarios.some((scenario) => text.toLowerCase().includes(scenario.toLowerCase()));
    if (evidence.length === 0 && !sharedScenario) continue;
    if (sharedScenario && !evidence.some((item) => item.type === "scenario")) {
      evidence.push({ type: "scenario", label: "共享业务场景" });
    }
    // 只有区域级共用模式命中时，收敛成一条区域影响：否则一条 docs 提交会给区域内几十个工作项的负责人同时发通知。
    // 判据是"有没有被专有模式或语义词定位到"（specific），不再看证据类型——
    // 共用模式现在也会留下路径证据，用证据类型判断会让收敛永久失效。
    const onlyArea = !match.specific;
    if (onlyArea) {
      const area = match.areas[0] ?? "未标注区域";
      const bucket = areaBuckets.get(area) ?? { count: 0, owners: new Set<string>() };
      bucket.count += 1;
      if (module.ownerName) bucket.owners.add(module.ownerName);
      areaBuckets.set(area, bucket);
      continue;
    }
    const reasonHit = primaryReason(classifyReasons({
      files: paths,
      semanticOnly: !evidence.some((item) => item.type === "path"),
      severity,
      title: event.title,
      pull: context.pull ?? null,
      parallelPulls: context.parallelPulls,
      unmergedReferences: context.unmergedReferences,
      hasImplementation: hasImplementationFile(paths)
    }));
    results.push({
      eventId: 0,
      moduleId: module.id,
      userId: module.owner_user_id,
      severity,
      category,
      reason: `${event.title} 影响模块「${module.name}」：${matchedRules[0]?.name ?? base.category}。`,
      evidence: [
        ...evidence,
        ...(event.url ? [{ type: "event", id: event.sourceId, label: "来源变化", url: event.url }] : []),
        ...matchedRules.map((rule) => ({ type: "rule", id: rule.ruleKey, label: rule.name }))
      ],
      nextAction: reasonHit?.action ?? nextAction,
      reasonCode: reasonHit?.code ?? null,
      reasonLabel: reasonHit?.label ?? null,
      reasonNature: reasonHit?.nature ?? null,
      reasonAction: reasonHit?.action ?? null,
      status: "open"
    });
  }

  for (const [area, bucket] of areaBuckets) {
    // 收敛成区域影响是为了不刷屏，但不能因此把"该找谁"也丢掉：
    // 同一区域的工作项常常是同一个人负责（一个 RFC 带多个子任务），这时直接点名。
    const owners = [...bucket.owners];
    const ownerText = owners.length === 0
      ? ""
      : owners.length <= AREA_OWNER_LIMIT
        ? `，涉及负责人 ${owners.join("、")}`
        : `，涉及 ${owners.length} 位负责人`;
    results.push({
      eventId: 0,
      moduleId: null,
      userId: null,
      severity,
      category,
      reason: `${event.title} 落在区域「${area}」，该区域下有 ${bucket.count} 个工作项共享这条路径模式${ownerText}。`,
      evidence: [
        { type: "area", id: area, label: `区域 ${area}` },
        ...owners.map((owner) => ({ type: "owner", id: owner, label: `区域负责人 ${owner}` })),
        ...(event.url ? [{ type: "event", id: event.sourceId, label: "来源变化", url: event.url }] : [])
      ],
      nextAction: owners.length === 1
        ? `${owners[0]}：确认区域内具体工作项（涉及 ${bucket.count} 项）`
        : bucket.count > 1 ? `确认区域内具体工作项（涉及 ${bucket.count} 项）` : "确认区域内具体工作项",
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

export function persistEventAndImpacts(
  event: EventInput,
  projectId = 1,
  context: ReasonOverrides = {}
) {
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
  const analysis = analyzeEvent({ ...event, payload: event.payload ?? {} }, projectId, context);
  const impacts: Impact[] = [];
  for (const item of analysis.impacts) {
    const inserted = execute(
      `INSERT INTO impacts (event_id, module_id, user_id, severity, category, reason, evidence_json, next_action, status, reason_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, item.moduleId, item.userId, item.severity, item.category, item.reason,
        JSON.stringify(item.evidence), item.nextAction, item.status, item.reasonCode ?? null]
    );
    impacts.push({ ...item, id: Number(inserted.lastInsertRowid), eventId, createdAt: new Date().toISOString() });
  }
  audit(null, "system", "analyze_event", "change_event", eventId, { impacts: impacts.length, severity: analysis.severity });
  return { eventId, impacts };
}
