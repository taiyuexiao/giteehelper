import { audit, execute, parseJson, queryAll, queryOne } from "./db.js";
import { analyzeEvent, persistEventAndImpacts, type EventInput } from "./impact.js";
import type { Impact, Severity } from "../shared/types.js";

/** 需要下游动作的严重度视为“冲突”，会触发飞书通知 */
export const CONFLICT_SEVERITIES: Severity[] = ["blocking", "contract"];

export interface CommitFile {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface CommitInput {
  sha: string;
  message: string;
  authorLogin?: string | null;
  authorName?: string | null;
  authorEmail?: string | null;
  committedAt?: string | null;
  branch?: string | null;
  url?: string | null;
  files?: CommitFile[];
  additions?: number;
  deletions?: number;
  pullNumber?: number | null;
  pullTitle?: string | null;
}

export interface CommitAnalysis {
  kind: string;
  kindLabel: string;
  scope: string | null;
  subject: string;
  summary: string;
  issueRefs: string[];
  affectedModules: Array<{
    id: number; name: string; owner: string | null; severity: Severity; reason: string; nextAction: string;
    reasonLabel?: string | null; reasonNature?: string | null; reasonAction?: string | null;
  }>;
  conflict: boolean;
  severity: Severity;
  fileCount: number;
  additions: number;
  deletions: number;
  areas: string[];
}

const KIND_LABELS: Record<string, string> = {
  feat: "新增能力",
  feature: "新增能力",
  fix: "修复缺陷",
  bugfix: "修复缺陷",
  hotfix: "紧急修复",
  docs: "文档变更",
  doc: "文档变更",
  refactor: "重构",
  perf: "性能优化",
  test: "测试调整",
  tests: "测试调整",
  chore: "工程杂项",
  build: "构建调整",
  ci: "流水线调整",
  style: "格式调整",
  revert: "回滚",
  merge: "合并同步"
};

const PROBLEM_MARKERS = /(?:^|\n)\s*(?:问题|背景|原因|动机|痛点|problem|context|why)\s*[:：]\s*(.+)/i;
// `#` 不是单词字符，前面加 \b 会导致 #412 永远匹配不到
const ISSUE_REFERENCE = /(?:#\d{1,6}\b|\b[A-Z]{2,10}-\d{1,6}\b)/g;

/**
 * 把提交信息解析成“这个提交处理了什么问题”的结构化描述。
 * 不依赖大模型：约定式提交前缀 + 正文中的问题标记 + 需求编号引用。
 */
export function summarizeCommit(message: string) {
  const normalized = message.replace(/\r\n/g, "\n").trim();
  const [firstLine = "", ...rest] = normalized.split("\n");
  const conventional = firstLine.match(/^([a-z]+)(?:\(([^)]+)\))?!?\s*:\s*(.+)$/i);
  const kind = (conventional?.[1] ?? "").toLowerCase();
  const scope = conventional?.[2]?.trim() || null;
  const subject = (conventional?.[3] ?? firstLine).trim();
  // 需求编号可能只出现在首行的 scope 里，因此扫描完整提交信息而不是去掉 scope 的正文
  const body = [firstLine, ...rest].join("\n");
  const problem = body.match(PROBLEM_MARKERS)?.[1]?.trim() ?? null;
  const issueRefs = [...new Set(body.match(ISSUE_REFERENCE) ?? [])].slice(0, 6);
  const kindLabel = KIND_LABELS[kind] ?? "变更";

  const segments = [scope ? `${kindLabel}（${scope}）` : kindLabel, subject];
  const summary = `${segments.filter(Boolean).join("：")}`;
  return { kind: kind || "change", kindLabel, scope, subject: firstLine.trim(), summary, issueRefs, problem };
}

function topAreas(files: CommitFile[]): string[] {
  const areas = new Map<string, number>();
  for (const file of files) {
    const path = file.path.replace(/\\/g, "/");
    const segments = path.split("/");
    const area = segments.length > 1 ? `${segments[0]}/` : path;
    areas.set(area, (areas.get(area) ?? 0) + 1);
  }
  return [...areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([area]) => area);
}

export function commitEventInput(commit: CommitInput): EventInput {
  const { subject } = summarizeCommit(commit.message);
  return {
    source: "gitee",
    sourceId: commit.sha,
    eventType: "commit",
    action: "pushed",
    title: subject,
    author: commit.authorLogin || commit.authorName || "unknown",
    branch: commit.branch ?? undefined,
    url: commit.url ?? undefined,
    payload: {
      files: (commit.files ?? []).map((file) => file.path),
      message: commit.message,
      commit: { sha: commit.sha, message: commit.message, additions: commit.additions, deletions: commit.deletions }
    }
  };
}

export function findCommitBySha(sha: string, projectId = 1) {
  return queryOne<{ id: number; sha: string; event_id: number | null }>(
    `SELECT id, sha, event_id FROM commits WHERE project_id = ? AND sha = ?`,
    [projectId, sha]
  );
}

/**
 * 入库并分析单个提交。已存在的提交直接复用，保证 WebHook 重投不会重复分析或重复通知。
 */
export function ingestCommit(commit: CommitInput, projectId = 1) {
  const existing = findCommitBySha(commit.sha, projectId);
  if (existing) {
    return { commitId: existing.id, eventId: existing.event_id, impacts: [] as Impact[], analysis: null, created: false };
  }

  const files = commit.files ?? [];
  const additions = commit.additions ?? files.reduce((total, file) => total + (file.additions ?? 0), 0);
  const deletions = commit.deletions ?? files.reduce((total, file) => total + (file.deletions ?? 0), 0);
  const meta = summarizeCommit(commit.message);
  const persisted = persistEventAndImpacts(commitEventInput(commit), projectId);
  const impacts = persisted.impacts;
  const conflicts = impacts.filter((impact) => CONFLICT_SEVERITIES.includes(impact.severity));
  const severity = (impacts.map((impact) => impact.severity).sort(
    (a, b) => CONFLICT_SEVERITIES.indexOf(a) - CONFLICT_SEVERITIES.indexOf(b)
  )[0] ?? "informational") as Severity;

  const affectedModules = impacts.map((impact) => {
    const module = impact.moduleId
      ? queryOne<{ name: string; owner: string | null }>(
        `SELECT m.name, u.display_name AS owner FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id WHERE m.id = ?`,
        [impact.moduleId]
      )
      : undefined;
    return {
      id: impact.moduleId ?? 0,
      name: module?.name ?? "未归属影响",
      owner: module?.owner ?? null,
      severity: impact.severity,
      reason: impact.reason,
      nextAction: impact.nextAction,
      reasonLabel: impact.reasonLabel ?? null,
      reasonNature: impact.reasonNature ?? null,
      reasonAction: impact.reasonAction ?? null
    };
  });

  const analysis: CommitAnalysis = {
    kind: meta.kind,
    kindLabel: meta.kindLabel,
    scope: meta.scope,
    subject: meta.subject,
    summary: meta.problem ? `${meta.summary}；${meta.problem}` : meta.summary,
    issueRefs: meta.issueRefs,
    affectedModules,
    conflict: conflicts.length > 0,
    severity,
    fileCount: files.length,
    additions,
    deletions,
    areas: topAreas(files)
  };

  const inserted = execute(
    `INSERT INTO commits (project_id, sha, short_sha, subject, message, author_login, author_name, author_email,
       committed_at, branch, url, files_json, additions, deletions, changed_files, pull_number, pull_title,
       event_id, severity, conflict, analysis_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId, commit.sha, commit.sha.slice(0, 8), meta.subject, commit.message,
      commit.authorLogin ?? null, commit.authorName ?? null, commit.authorEmail ?? null,
      commit.committedAt ?? null, commit.branch ?? null, commit.url ?? null, JSON.stringify(files),
      additions, deletions, files.length, commit.pullNumber ?? null, commit.pullTitle ?? null,
      persisted.eventId, severity, analysis.conflict ? 1 : 0, JSON.stringify(analysis)
    ]
  );
  const commitId = Number(inserted.lastInsertRowid);
  audit(null, "system", "commit_ingest", "commit", commitId, {
    sha: commit.sha, impacts: impacts.length, conflict: analysis.conflict, severity
  });
  return { commitId, eventId: persisted.eventId, impacts, analysis, created: true };
}

/** 把影响翻译成「模块名 + 负责人」，通知要按人分组展示 */
export function describeImpacts(impacts: Impact[]) {
  return impacts.map((impact) => {
    const module = impact.moduleId
      ? queryOne<{ name: string; owner: string | null }>(
        `SELECT m.name, u.display_name AS owner FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id WHERE m.id = ?`,
        [impact.moduleId]
      )
      : undefined;
    return {
      moduleName: module?.name ?? "未归属影响",
      owner: module?.owner ?? null,
      severity: impact.severity,
      reasonLabel: impact.reasonLabel ?? null,
      reasonNature: impact.reasonNature ?? null,
      reasonAction: impact.reasonAction ?? null
    };
  });
}

export function listCommits(limit = 120, projectId = 1) {
  return queryAll(
    `SELECT c.id, c.sha, c.short_sha AS shortSha, c.subject, c.message, c.author_login AS authorLogin,
            c.author_name AS authorName, c.committed_at AS committedAt, c.branch, c.url,
            c.files_json AS filesJson, c.additions, c.deletions, c.changed_files AS changedFiles,
            c.pull_number AS pullNumber, c.pull_title AS pullTitle, c.event_id AS eventId,
            c.severity, c.conflict, c.analysis_json AS analysisJson, c.first_seen_at AS firstSeenAt
     FROM commits c WHERE c.project_id = ? ORDER BY COALESCE(c.committed_at, c.first_seen_at) DESC, c.id DESC LIMIT ?`,
    [projectId, limit]
  ).map((row) => ({
    ...row,
    conflict: Boolean(row.conflict),
    files: parseJson<CommitFile[]>(row.filesJson, []),
    analysis: parseJson<CommitAnalysis | Record<string, never>>(row.analysisJson, {})
  }));
}

export function getCommit(sha: string, projectId = 1) {
  const row = queryOne(
    `SELECT id, sha, short_sha AS shortSha, subject, message, author_login AS authorLogin, author_name AS authorName,
            author_email AS authorEmail, committed_at AS committedAt, branch, url, files_json AS filesJson,
            additions, deletions, changed_files AS changedFiles, pull_number AS pullNumber, pull_title AS pullTitle,
            event_id AS eventId, severity, conflict, analysis_json AS analysisJson, first_seen_at AS firstSeenAt
     FROM commits WHERE project_id = ? AND sha = ?`,
    [projectId, sha]
  );
  if (!row) return undefined;
  return {
    ...row,
    conflict: Boolean(row.conflict),
    files: parseJson<CommitFile[]>(row.filesJson, []),
    analysis: parseJson<CommitAnalysis | Record<string, never>>(row.analysisJson, {})
  };
}

export function commitStats(projectId = 1) {
  const totals = queryOne<{ total: number; conflicts: number; authors: number; latest: string | null }>(
    `SELECT COUNT(*) AS total, SUM(conflict) AS conflicts, COUNT(DISTINCT COALESCE(author_login, author_name)) AS authors,
            MAX(COALESCE(committed_at, first_seen_at)) AS latest
     FROM commits WHERE project_id = ?`,
    [projectId]
  );
  const recent = queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM commits WHERE project_id = ? AND COALESCE(committed_at, first_seen_at) >= datetime('now', '-24 hours')`,
    [projectId]
  );
  return {
    total: totals?.total ?? 0,
    conflicts: totals?.conflicts ?? 0,
    authors: totals?.authors ?? 0,
    latest: totals?.latest ?? null,
    last24h: recent?.count ?? 0
  };
}

export function recordWebhookDelivery(delivery: {
  hookName?: string | null;
  eventType?: string | null;
  action?: string | null;
  status: "accepted" | "processing" | "processed" | "rejected" | "error";
  detail?: string | null;
  eventId?: number | null;
  commits?: number;
  impacts?: number;
  conflicts?: number;
  payload?: Record<string, unknown>;
}) {
  const inserted = execute(
    `INSERT INTO webhook_deliveries (source, hook_name, event_type, action, status, detail, event_id, commits, impacts, conflicts, payload_json)
     VALUES ('gitee', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      delivery.hookName ?? null, delivery.eventType ?? null, delivery.action ?? null, delivery.status,
      delivery.detail ?? null, delivery.eventId ?? null, delivery.commits ?? 0, delivery.impacts ?? 0,
      delivery.conflicts ?? 0, JSON.stringify(delivery.payload ?? {})
    ]
  );
  return Number(inserted.lastInsertRowid);
}

export function updateWebhookDelivery(id: number, patch: {
  status?: "accepted" | "processing" | "processed" | "rejected" | "error";
  detail?: string | null;
  eventId?: number | null;
  commits?: number;
  impacts?: number;
  conflicts?: number;
}) {
  execute(
    `UPDATE webhook_deliveries SET status = COALESCE(?, status), detail = COALESCE(?, detail), event_id = COALESCE(?, event_id),
       commits = COALESCE(?, commits), impacts = COALESCE(?, impacts), conflicts = COALESCE(?, conflicts) WHERE id = ?`,
    [patch.status ?? null, patch.detail ?? null, patch.eventId ?? null, patch.commits ?? null,
      patch.impacts ?? null, patch.conflicts ?? null, id]
  );
}

export function listWebhookDeliveries(limit = 20) {
  return queryAll(
    `SELECT id, hook_name AS hookName, event_type AS eventType, action, status, detail, event_id AS eventId,
            commits, impacts, conflicts, created_at AS createdAt
     FROM webhook_deliveries ORDER BY id DESC LIMIT ?`,
    [limit]
  );
}

function countImpacts(projectId = 1) {
  return queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM impacts i JOIN change_events e ON e.id = i.event_id WHERE e.project_id = ?`,
    [projectId]
  )?.count ?? 0;
}

/**
 * 按当前匹配规则重算历史影响。
 * 匹配规则收紧后，旧数据里会留下大量按老规则生成的噪声影响（例如一条文档提交命中几十个工作项），
 * 这个操作把提交与非提交事件都按新规则重新分析一遍。提交行会先删除再按原始字段重新入库，
 * 因此 analysis_json、severity、conflict 也会一并刷新。
 */
export function reanalyzeAll(projectId = 1) {
  const before = countImpacts(projectId);

  const commits = queryAll<{
    id: number; sha: string; message: string; author_login: string | null; author_name: string | null;
    author_email: string | null; committed_at: string | null; branch: string | null; url: string | null;
    files_json: string; additions: number; deletions: number; pull_number: number | null;
    pull_title: string | null; event_id: number | null;
  }>(
    `SELECT id, sha, message, author_login, author_name, author_email, committed_at, branch, url,
            files_json, additions, deletions, pull_number, pull_title, event_id
     FROM commits WHERE project_id = ?`,
    [projectId]
  );

  for (const row of commits) {
    if (row.event_id) execute(`DELETE FROM change_events WHERE id = ?`, [row.event_id]);
    execute(`DELETE FROM commits WHERE id = ?`, [row.id]);
    ingestCommit({
      sha: row.sha,
      message: row.message,
      authorLogin: row.author_login,
      authorName: row.author_name,
      authorEmail: row.author_email,
      committedAt: row.committed_at,
      branch: row.branch,
      url: row.url,
      files: parseJson<CommitFile[]>(row.files_json, []),
      additions: row.additions,
      deletions: row.deletions,
      pullNumber: row.pull_number,
      pullTitle: row.pull_title
    }, projectId);
  }

  const events = queryAll<{
    id: number; source: string; source_id: string; event_type: string; action: string; title: string;
    author: string; branch: string | null; url: string | null; payload_json: string;
  }>(
    `SELECT id, source, source_id, event_type, action, title, author, branch, url, payload_json
     FROM change_events WHERE project_id = ? AND event_type != 'commit'`,
    [projectId]
  );

  for (const event of events) {
    execute(`DELETE FROM impacts WHERE event_id = ?`, [event.id]);
    const analysis = analyzeEvent({
      source: event.source,
      sourceId: event.source_id,
      eventType: event.event_type,
      action: event.action,
      title: event.title,
      author: event.author,
      branch: event.branch ?? undefined,
      url: event.url ?? undefined,
      payload: parseJson<Record<string, unknown>>(event.payload_json, {})
    }, projectId);
    for (const item of analysis.impacts) {
      execute(
        `INSERT INTO impacts (event_id, module_id, user_id, severity, category, reason, evidence_json, next_action, status, reason_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event.id, item.moduleId, item.userId, item.severity, item.category, item.reason,
          JSON.stringify(item.evidence), item.nextAction, item.status, item.reasonCode ?? null]
      );
    }
  }

  const after = countImpacts(projectId);
  audit(null, "system", "reanalyze_impacts", "project", projectId, {
    commits: commits.length, events: events.length, impactsBefore: before, impactsAfter: after
  });
  return { commits: commits.length, events: events.length, impactsBefore: before, impactsAfter: after };
}
