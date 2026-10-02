/**
 * 开发进度：把「分工 × PR 状态」变成任务完成度。
 *
 * 流程假设（来自评测平台项目，也是本产品面向的协作模式）：需求文档 → 分工 →
 * 每人针对模块写 RFC（文档 PR）→ 评审通过 → 代码 PR → merged 才算完成。
 * 因此任务有五个状态：
 *   not_started → designing(RFC open) → designed(RFC merged) → developing(code open) → done(code merged)
 *
 * PR ↔ 任务的关联走三级证据（结果里保留证据类型，控制台可查）：
 *   1. ref  标题/正文里的 BOSC-XXXX 编号 → work-bosc-xxxx（最可靠）
 *   2. rfc  变更文件命中 docs/rfcs/<slug> → rfc_contracts.workRefs → 工作项
 *   3. path 变更文件命中工作项声明的路径模式
 * 全部确定性计算，不调大模型。
 */
import crypto from "node:crypto";
import { config } from "./config.js";
import { execute, parseJson, queryAll, queryOne } from "./db.js";
import { isOperationalModule, wildcardMatch } from "./impact.js";
import { fetchPullFiles } from "./pulls.js";

export type TaskState = "not_started" | "designing" | "designed" | "developing" | "done";

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  not_started: "未开始",
  designing: "设计中",
  designed: "设计定稿",
  developing: "开发中",
  done: "已完成"
};

export type PullKind = "doc" | "code" | "unknown";

export interface PullCore {
  number: number;
  title: string;
  body: string;
  state: string;
  authorLogin: string | null;
  url: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  files: string[];
}

export interface TaskModule {
  id: number;
  key: string;
  name: string;
  ownerUserId: number | null;
  paths: string[];
  group: string | null;
}

export interface Association {
  moduleId: number;
  evidence: "ref" | "rfc" | "path";
}

const WORK_REF_RE = /\b([A-Za-z]{2,10}-\d{1,6})\b/g;
const DOCS_PATH_RE = /^docs\//i;
const RFC_SLUG_RES = [
  /^docs\/rfcs\/(?:meta\/)?([A-Za-z0-9][A-Za-z0-9-]*)\.(?:mdx?|json)$/i,
  /^docs\/rfcs\/assets\/([A-Za-z0-9][A-Za-z0-9-]*)(?:\/|$)/i
];
/** 全景分组：导入的工作项在 description 里带「能力域：<领域>｜」 */
const DOMAIN_RE = /能力域：\s*([^｜|\n]+)/;

/** 标题/正文里的工作项编号 → 模块 key（BOSC-0100 → work-bosc-0100） */
export function extractWorkRefs(text: string): string[] {
  const found = new Set<string>();
  for (const match of (text ?? "").matchAll(WORK_REF_RE)) {
    found.add(`work-${match[1].toLowerCase()}`);
  }
  return [...found];
}

/** 文件路径里出现的 RFC slug（正文 .mdx / meta .json / assets 目录都算） */
export function rfcSlugsOfFiles(files: string[]): string[] {
  const slugs = new Set<string>();
  for (const file of files ?? []) {
    for (const re of RFC_SLUG_RES) {
      const match = re.exec((file ?? "").trim());
      if (match) {
        slugs.add(match[1].toLowerCase());
        break;
      }
    }
  }
  return [...slugs];
}

/**
 * PR 分类：doc = 只改 docs/（RFC 文档 PR）；code = 沾了任何非 docs 文件；
 * 没有文件时按标题猜（docs: 前缀 / 提到 RFC）。文件回填后分类会自动变准。
 */
export function classifyPullKind(files: string[], title: string): PullKind {
  const list = (files ?? []).filter(Boolean);
  if (list.length) return list.every((file) => DOCS_PATH_RE.test(file)) ? "doc" : "code";
  if (/^docs?\s*[(:]/i.test(title ?? "") || /\brfc\b/i.test(title ?? "")) return "doc";
  return "unknown";
}

/** 任务五态：merged 才算完成；unknown 类按代码处理（文件回填后自动纠正） */
export function taskStateOf(pulls: Array<{ kind: PullKind; state: string }>): TaskState {
  if (pulls.some((p) => p.kind !== "doc" && p.state === "merged")) return "done";
  if (pulls.some((p) => p.kind !== "doc" && p.state === "open")) return "developing";
  if (pulls.some((p) => p.kind === "doc" && p.state === "merged")) return "designed";
  if (pulls.some((p) => p.kind === "doc" && p.state === "open")) return "designing";
  return "not_started";
}

const EVIDENCE_RANK: Record<Association["evidence"], number> = { ref: 0, rfc: 1, path: 2 };
const globCache = new Map<string, RegExp>();

function compileGlob(pattern: string): RegExp {
  let re = globCache.get(pattern);
  if (!re) {
    let source = "";
    for (let index = 0; index < pattern.length; index += 1) {
      const char = pattern[index];
      if (char === "*") {
        if (pattern[index + 1] === "*") {
          source += pattern[index + 2] === "/" ? "(?:.*/)?" : ".*";
          index += pattern[index + 2] === "/" ? 2 : 1;
        } else source += "[^/]*";
      } else if (char === "?") source += "[^/]";
      else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    re = new RegExp(`^${source}$`, "i");
    globCache.set(pattern, re);
  }
  return re;
}

/**
 * 单条 PR 与任务的关联。ref/rfc 命中即返回（不再跑更贵的 path 扫描）；
 * path 路由把「文件 × 模式」建倒排索引，避免 300+ PR × 140 任务的全量扫描。
 */
export function associatePull(
  pull: PullCore,
  tasks: TaskModule[],
  rfcIndex: Map<string, string[]>
): Association[] {
  const hits = new Map<number, Association>();
  const add = (moduleId: number, evidence: Association["evidence"]) => {
    const existing = hits.get(moduleId);
    if (!existing || EVIDENCE_RANK[evidence] < EVIDENCE_RANK[existing.evidence]) {
      hits.set(moduleId, { moduleId, evidence });
    }
  };

  for (const key of extractWorkRefs(`${pull.title}\n${pull.body}`)) {
    const task = tasks.find((item) => item.key === key);
    if (task) add(task.id, "ref");
  }
  if (hits.size === 0 && pull.files.length) {
    for (const slug of rfcSlugsOfFiles(pull.files)) {
      for (const key of rfcIndex.get(slug) ?? []) {
        const task = tasks.find((item) => item.key === key);
        if (task) add(task.id, "rfc");
      }
    }
  }
  if (hits.size === 0 && pull.files.length) {
    // pattern → 命中它的任务（同一模式被多个工作项共用是常态：同一 RFC 的兄弟任务）
    const patternIndex = new Map<string, number[]>();
    for (const task of tasks) {
      for (const pattern of task.paths) {
        const ids = patternIndex.get(pattern) ?? [];
        ids.push(task.id);
        patternIndex.set(pattern, ids);
      }
    }
    for (const file of pull.files) {
      for (const [pattern, ids] of patternIndex) {
        if (compileGlob(pattern).test(file)) {
          for (const id of ids) add(id, "path");
        }
      }
    }
  }
  return [...hits.values()];
}

/** 顶层模块归属：group_name 优先（导入时写入），回退 description 的「能力域：」 */
export function groupOf(module: { key: string; group: string | null; description?: string | null }): string | null {
  if (module.group) return module.group;
  const match = DOMAIN_RE.exec(module.description ?? "");
  if (match) return match[1].trim();
  return module.key.startsWith("work-") ? "未分组" : null;
}

export interface BoardTaskPull {
  number: number;
  title: string;
  state: string;
  kind: PullKind;
  url: string | null;
  mergedAt: string | null;
  authorLogin: string | null;
}

export interface BoardTask {
  moduleId: number;
  key: string;
  name: string;
  ownerUserId: number | null;
  ownerName: string | null;
  state: TaskState;
  docMerged: number;
  docOpen: number;
  codeMerged: number;
  codeOpen: number;
  lastActivityAt: string | null;
  authorLogins: string[];
  pulls: BoardTaskPull[];
}

export interface BoardGroup {
  name: string;
  moduleId: number | null;
  ownerUserId: number | null;
  ownerName: string | null;
  tasks: BoardTask[];
  summary: Record<TaskState, number>;
}

export interface BoardData {
  initialized: boolean;
  summary: Record<TaskState, number> & { total: number };
  groups: BoardGroup[];
}

function emptySummary(): Record<TaskState, number> & { total: number } {
  return { not_started: 0, designing: 0, designed: 0, developing: 0, done: 0, total: 0 };
}

export function buildBoard(projectId = 1): BoardData {
  const taskRows = queryAll<{
    id: number; moduleKey: string; name: string; ownerUserId: number | null; ownerName: string | null;
    pathsJson: string; groupName: string | null; description: string | null;
  }>(
    `SELECT m.id, m.module_key AS moduleKey, m.name, m.owner_user_id AS ownerUserId,
            u.display_name AS ownerName, m.paths_json AS pathsJson, m.group_name AS groupName, m.description
     FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id WHERE m.project_id = ?`,
    [projectId]
  ).filter((row) => isOperationalModule(row));

  const topRows = queryAll<{ id: number; moduleKey: string; name: string; ownerUserId: number | null; ownerName: string | null }>(
    `SELECT m.id, m.module_key AS moduleKey, m.name, m.owner_user_id AS ownerUserId, u.display_name AS ownerName
     FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id
     WHERE m.project_id = ? AND m.group_name IS NULL`,
    [projectId]
  ).filter((row) => isOperationalModule(row));

  const tasks: TaskModule[] = taskRows
    .map((row) => ({
      id: row.id,
      key: row.moduleKey,
      name: row.name,
      ownerUserId: row.ownerUserId,
      paths: parseJson<string[]>(row.pathsJson, []),
      group: groupOf({ key: row.moduleKey, group: row.groupName, description: row.description })
    }))
    .filter((task) => task.group !== null);

  const rfcIndex = new Map<string, string[]>();
  for (const contract of queryAll<{ slug: string; workRefsJson: string }>(
    `SELECT slug, work_refs_json AS workRefsJson FROM rfc_contracts WHERE project_id = ?`, [projectId]
  )) {
    const refs = parseJson<string[]>(contract.workRefsJson, []);
    rfcIndex.set(
      contract.slug.toLowerCase(),
      refs.map((ref) => `work-${ref.toLowerCase()}`)
    );
  }

  const pullUrl = (number: number) => {
    const [owner, name] = (config.giteeRepo ?? "").split("/");
    return owner && name ? `https://gitee.com/${owner}/${name}/pulls/${number}` : null;
  };
  const pulls = queryAll<Record<string, unknown>>(
    `SELECT number, title, body, state, author_login AS authorLogin, created_at AS createdAt,
            updated_at AS updatedAt, merged_at AS mergedAt, additions, deletions, files_json AS filesJson
     FROM pull_requests WHERE project_id = ?`,
    [projectId]
  ).map((row): PullCore => ({
    number: Number(row.number),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    state: String(row.state ?? ""),
    authorLogin: (row.authorLogin as string | null) ?? null,
    url: pullUrl(Number(row.number)),
    createdAt: (row.createdAt as string | null) ?? null,
    updatedAt: (row.updatedAt as string | null) ?? null,
    mergedAt: (row.mergedAt as string | null) ?? null,
    additions: Number(row.additions ?? 0) || 0,
    deletions: Number(row.deletions ?? 0) || 0,
    files: parseJson<string[]>(row.filesJson, [])
  }));

  const byModule = new Map<number, Array<{ kind: PullKind; pull: PullCore }>>();
  for (const pull of pulls) {
    for (const association of associatePull(pull, tasks, rfcIndex)) {
      const kind = classifyPullKind(pull.files, pull.title);
      const list = byModule.get(association.moduleId) ?? [];
      list.push({ kind, pull });
      byModule.set(association.moduleId, list);
    }
  }

  const userNameById = new Map<number, string>();
  for (const row of queryAll<{ id: number; displayName: string }>(`SELECT id, display_name AS displayName FROM users`)) {
    userNameById.set(row.id, row.displayName);
  }

  const groups = new Map<string, BoardGroup>();
  for (const task of tasks) {
    const groupName = task.group ?? "未分组";
    const associated = byModule.get(task.id) ?? [];
    const boardTask: BoardTask = {
      moduleId: task.id,
      key: task.key,
      name: task.name,
      ownerUserId: task.ownerUserId,
      ownerName: task.ownerUserId ? userNameById.get(task.ownerUserId) ?? null : null,
      state: taskStateOf(associated.map((item) => ({ kind: item.kind, state: item.pull.state }))),
      docMerged: associated.filter((item) => item.kind === "doc" && item.pull.state === "merged").length,
      docOpen: associated.filter((item) => item.kind === "doc" && item.pull.state === "open").length,
      codeMerged: associated.filter((item) => item.kind !== "doc" && item.pull.state === "merged").length,
      codeOpen: associated.filter((item) => item.kind !== "doc" && item.pull.state === "open").length,
      lastActivityAt: associated
        .map((item) => item.pull.mergedAt ?? item.pull.updatedAt ?? item.pull.createdAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
      authorLogins: [...new Set(associated.map((item) => item.pull.authorLogin).filter(Boolean) as string[])],
      pulls: associated
        .slice()
        .sort((a, b) => b.pull.number - a.pull.number)
        .slice(0, 20)
        .map((item) => ({
          number: item.pull.number,
          title: item.pull.title,
          state: item.pull.state,
          kind: item.kind,
          url: item.pull.url,
          mergedAt: item.pull.mergedAt,
          authorLogin: item.pull.authorLogin
        }))
    };
    const top = topRows.find((row) => row.name === groupName);
    const group = groups.get(groupName) ?? {
      name: groupName,
      moduleId: top?.id ?? null,
      ownerUserId: top?.ownerUserId ?? null,
      ownerName: top?.ownerName ?? null,
      tasks: [],
      summary: emptySummary()
    };
    group.tasks.push(boardTask);
    group.summary[boardTask.state] += 1;
    groups.set(groupName, group);
  }

  const summary = emptySummary();
  for (const group of groups.values()) {
    for (const task of group.tasks) {
      summary[task.state] += 1;
      summary.total += 1;
    }
  }
  return { initialized: tasks.length > 0, summary, groups: [...groups.values()] };
}

/**
 * 给没有文件列表的 merged PR 回填文件（决定它能否按路径关联到任务）。
 * 分块可续跑：每次最多 max 条，返回 remaining 让调用方循环到 0。
 */
export async function backfillMergedFiles(
  options: { max?: number } = {},
  projectId = 1
): Promise<{ fetched: number; remaining: number; skipped: number }> {
  const max = Math.max(1, Math.min(options.max ?? 40, 200));
  const pending = queryAll<{ number: number }>(
    `SELECT number FROM pull_requests WHERE project_id = ? AND state = 'merged' AND files_json = '[]'
     ORDER BY number DESC LIMIT ?`,
    [projectId, max]
  );
  const [{ remaining: totalLeft }] = [
    { remaining: queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM pull_requests WHERE project_id = ? AND state = 'merged' AND files_json = '[]'`,
      [projectId]
    )?.c ?? 0 }
  ];
  let fetched = 0;
  let skipped = 0;
  for (const row of pending) {
    const files = await fetchPullFiles(row.number).catch(() => [] as string[]);
    if (!files.length) {
      skipped += 1;
      continue;
    }
    execute(`UPDATE pull_requests SET files_json = ?, synced_at = datetime('now') WHERE project_id = ? AND number = ?`,
      [JSON.stringify(files), projectId, row.number]);
    fetched += 1;
  }
  const remaining = Math.max(totalLeft - fetched - skipped, 0);
  return { fetched, remaining, skipped };
}

/* ---------- 身份：Gitee 账号 / git 署名 / 邮箱 → 人 ---------- */

export interface UserIndex {
  byLogin: Map<string, number>;
  namesByLogin: Map<string, string[]>;
  resolveCommit(login: string | null, name: string | null, email: string | null): number | null;
}

export function buildUserIndex(projectId = 1): UserIndex {
  const byLogin = new Map<string, number>();
  const nameById = new Map<number, string>();
  const byName = new Map<string, number>();
  const byEmail = new Map<string, number>();
  for (const row of queryAll<{ id: number; displayName: string; giteeLogin: string | null; email: string | null }>(
    `SELECT id, display_name AS displayName, gitee_login AS giteeLogin, email FROM users`
  )) {
    nameById.set(row.id, row.displayName);
    byName.set(row.displayName.trim(), row.id);
    if (row.giteeLogin) byLogin.set(row.giteeLogin, row.id);
    if (row.email) byEmail.set(row.email.toLowerCase(), row.id);
  }
  for (const row of queryAll<{ alias: string; userId: number }>(
    `SELECT alias, user_id AS userId FROM identity_aliases WHERE project_id = ?`, [projectId]
  )) {
    if (!byLogin.has(row.alias)) byLogin.set(row.alias, row.userId);
    // 邮箱形态的别名进 byEmail（提交邮箱是最可靠的身份），其余当姓名别名
    if (row.alias.includes("@")) {
      if (!byEmail.has(row.alias.toLowerCase())) byEmail.set(row.alias.toLowerCase(), row.userId);
    } else if (!byName.has(row.alias.trim())) {
      byName.set(row.alias.trim(), row.userId);
    }
  }
  // 共用账号问题的正解：login 本身没有区分度，但它在 commits 里对应的作者名有
  const namesByLogin = new Map<string, string[]>();
  for (const row of queryAll<{ login: string; name: string | null; c: number }>(
    `SELECT author_login AS login, author_name AS name, COUNT(*) AS c FROM commits
     WHERE project_id = ? AND author_login IS NOT NULL GROUP BY author_login, author_name ORDER BY c DESC`, [projectId]
  )) {
    const names = namesByLogin.get(row.login) ?? [];
    if (row.name && !names.includes(row.name)) names.push(row.name);
    namesByLogin.set(row.login, names);
  }

  return {
    byLogin,
    namesByLogin,
    resolveCommit(login, name, email) {
      if (login && byLogin.has(login)) return byLogin.get(login)!;
      if (email && byEmail.has(email.toLowerCase())) return byEmail.get(email.toLowerCase())!;
      const candidates = [name, ...(login ? namesByLogin.get(login) ?? [] : [])];
      for (const candidate of candidates) {
        if (candidate && byName.has(candidate.trim())) return byName.get(candidate.trim())!;
      }
      return null;
    }
  };
}

/* ---------- 个人成长轨迹 ---------- */

export interface PersonMetrics {
  userId: number;
  name: string;
  tasksOwned: number;
  tasksDone: number;
  /** 独占合并 PR：关联任务的负责人只有他一个人 */
  mergedPrs: number;
  /** 跨人协作 PR：一条 PR 关联了多个人的任务（共享 RFC/代码面的常态），不重复计入任何人的独立数 */
  sharedMergedPrs: number;
  openPrs: number;
  docPrs: number;
  codePrs: number;
  additions: number;
  deletions: number;
  avgMergeHours: number | null;
  commitCount: number;
  /** [星期(0=周日..6)][小时(0-23)]，东八区 */
  heat: number[][];
  referencedBy: number;
  referencesOut: number;
  logins: string[];
}

function toStamp(value: string | null | undefined): number {
  if (!value) return 0;
  const stamp = Date.parse(value.includes("T") || value.includes("+") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(stamp) ? stamp : 0;
}

export function buildPeople(projectId = 1): PersonMetrics[] {
  const index = buildUserIndex(projectId);
  const board = buildBoard(projectId);
  /**
   * PR 归属到人：这个团队的 Gitee 账号是共用的（gux12 推了 254 个 PR），
   * 按 PR 署名归属会把所有人的工作算到一个人头上。因此归属走
   * 「PR → 关联任务（三级证据）→ 任务负责人」。一条 PR 关联多个人的任务时
   * （共享 RFC/代码面的常态）不算任何人的独占数，如实标为跨人协作。
   */
  const pullOwners = new Map<number, Set<number>>();
  for (const group of board.groups) {
    for (const task of group.tasks) {
      for (const pull of task.pulls) {
        const owners = pullOwners.get(pull.number) ?? new Set<number>();
        if (task.ownerUserId) owners.add(task.ownerUserId);
        pullOwners.set(pull.number, owners);
      }
    }
  }
  const pulls = queryAll<Record<string, unknown>>(
    `SELECT number, state, title, author_login AS authorLogin, created_at AS createdAt, merged_at AS mergedAt,
            additions, deletions, files_json AS filesJson
     FROM pull_requests WHERE project_id = ?`, [projectId]
  ).map((row): PullCore & { kind: PullKind } => ({
    number: Number(row.number),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    state: String(row.state ?? ""),
    authorLogin: (row.authorLogin as string | null) ?? null,
    url: null,
    createdAt: (row.createdAt as string | null) ?? null,
    updatedAt: (row.updatedAt as string | null) ?? null,
    mergedAt: (row.mergedAt as string | null) ?? null,
    additions: Number(row.additions ?? 0) || 0,
    deletions: Number(row.deletions ?? 0) || 0,
    files: parseJson<string[]>(row.filesJson, []),
    kind: classifyPullKind(parseJson<string[]>(row.filesJson, []), String(row.title ?? ""))
  }));
  const commits = queryAll<{ login: string | null; name: string | null; email: string | null; committedAt: string | null }>(
    `SELECT author_login AS login, author_name AS name, author_email AS email, committed_at AS committedAt
     FROM commits WHERE project_id = ?`, [projectId]
  );
  const references = queryAll<{ fromNumber: number; toNumber: number }>(
    `SELECT from_number AS fromNumber, to_number AS toNumber FROM pull_references WHERE project_id = ?`, [projectId]
  );

  const metrics: PersonMetrics[] = [];
  for (const row of queryAll<{ id: number; displayName: string }>(`SELECT id, display_name AS displayName FROM users WHERE active = 1 ORDER BY id`)) {
    const owned = board.groups.flatMap((group) => group.tasks).filter((task) => task.ownerUserId === row.id);
    const involved = pulls.filter((pull) => (pullOwners.get(pull.number)?.size ?? 0) > 0);
    const exclusive = involved.filter((pull) => {
      const owners = pullOwners.get(pull.number)!;
      return owners.size === 1 && owners.has(row.id);
    });
    const logins = [...new Set(involved.map((pull) => pull.authorLogin).filter(Boolean) as string[])];
    const personCommits = commits.filter((commit) => index.resolveCommit(commit.login, commit.name, commit.email) === row.id);
    const pullNumbers = new Set(involved.map((pull) => pull.number));
    const merged = exclusive.filter((pull) => pull.state === "merged");
    const sharedMergedPrs = involved.filter((pull) => {
      const owners = pullOwners.get(pull.number)!;
      return pull.state === "merged" && owners.size > 1 && owners.has(row.id);
    }).length;
    const mergeHours = merged
      .map((pull) => (toStamp(pull.mergedAt) - toStamp(pull.createdAt)) / 3_600_000)
      .filter((hours) => Number.isFinite(hours) && hours >= 0);
    const heat: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const commit of personCommits) {
      const stamp = toStamp(commit.committedAt);
      if (!stamp) continue;
      // 仓库团队在东八区：统计口径按 +08:00 落格
      const local = new Date(stamp + 8 * 3_600_000);
      heat[local.getUTCDay()][local.getUTCHours()] += 1;
    }
    metrics.push({
      userId: row.id,
      name: row.displayName,
      tasksOwned: owned.length,
      tasksDone: owned.filter((task) => task.state === "done").length,
      mergedPrs: merged.length,
      sharedMergedPrs,
      openPrs: involved.filter((pull) => pull.state === "open" && pullOwners.get(pull.number)!.has(row.id)).length,
      docPrs: exclusive.filter((pull) => pull.kind === "doc").length,
      codePrs: exclusive.filter((pull) => pull.kind !== "doc").length,
      additions: exclusive.reduce((sum, pull) => sum + pull.additions, 0),
      deletions: exclusive.reduce((sum, pull) => sum + pull.deletions, 0),
      avgMergeHours: mergeHours.length
        ? Math.round(mergeHours.reduce((sum, hours) => sum + hours, 0) / mergeHours.length)
        : null,
      commitCount: personCommits.length,
      heat,
      referencedBy: references.filter((ref) => pullNumbers.has(ref.toNumber)).length,
      referencesOut: references.filter((ref) => pullNumbers.has(ref.fromNumber)).length,
      logins
    });
  }
  // 有 PR/提交但身份没对上的人也会在向导第三步处理；这里只返回能对上身份的成员
  return metrics.filter((person) => person.tasksOwned > 0 || person.mergedPrs > 0 || person.openPrs > 0 || person.commitCount > 0);
}

/* ---------- 分工导入（初始化向导第二步） ---------- */

export interface AssignmentTask {
  key?: string;
  name: string;
  owner?: string;
  upstream?: string;
  downstream?: string;
  note?: string;
}

export interface AssignmentModule {
  name: string;
  owners: string[];
  tasks: AssignmentTask[];
}

export interface AssignmentPreview {
  modules: AssignmentModule[];
}

/** CSV 导入：首行表头需含「模块」和「任务」列；逗号或制表符分隔 */
export function parseAssignmentCsv(text: string): AssignmentPreview {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim());
  if (!lines.length) throw new Error("内容为空");
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const splitLine = (line: string) =>
    line.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));
  const header = splitLine(lines[0]);
  const col = (...names: string[]) => header.findIndex((h) => names.some((name) => h.includes(name)));
  const iModule = col("模块", "领域");
  const iTask = col("任务", "工作项", "功能点");
  if (iModule < 0 || iTask < 0) throw new Error("表头需要包含「模块」和「任务」列");
  const iOwner = col("负责人");
  const iKey = col("编号", "BOSC", "WS-");
  const iUp = col("上游");
  const iDown = col("下游", "依赖");
  const iNote = col("说明", "备注");
  const byModule = new Map<string, AssignmentModule>();
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const moduleName = cells[iModule] ?? "";
    const taskName = cells[iTask] ?? "";
    if (!moduleName && !taskName) continue;
    const task: AssignmentTask = {
      key: iKey >= 0 ? cells[iKey] || undefined : undefined,
      name: taskName,
      owner: iOwner >= 0 ? cells[iOwner] || undefined : undefined,
      upstream: iUp >= 0 ? cells[iUp] || undefined : undefined,
      downstream: iDown >= 0 ? cells[iDown] || undefined : undefined,
      note: iNote >= 0 ? cells[iNote] || undefined : undefined
    };
    const module = byModule.get(moduleName) ?? { name: moduleName, owners: [], tasks: [] };
    if (task.owner && !module.owners.includes(task.owner)) module.owners.push(task.owner);
    module.tasks.push(task);
    byModule.set(moduleName, module);
  }
  const modules = [...byModule.values()].filter((module) => module.name || module.tasks.length);
  if (!modules.length) throw new Error("没有解析到任何模块");
  return { modules };
}

/** 粘贴文本导入：交给大模型整理成结构化分工（未配置 LLM 时明确报错，引导用 CSV） */
export async function parseAssignmentWithLlm(text: string): Promise<AssignmentPreview> {
  if (!config.llmApiKey || !config.llmApiBase) {
    throw new Error("未配置大模型（LLM_API_BASE / LLM_API_KEY），请改用 CSV 导入");
  }
  const response = await fetch(`${config.llmApiBase}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.llmApiKey}` },
    body: JSON.stringify({
      model: config.llmModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            '你是分工表解析器。把输入的分工/计划文本整理成 JSON：{"tasks":[{"module":"顶层模块名","task":"任务名","owner":"负责人姓名","key":"编号(如BOSC-0100,没有则留空)","upstream":"上游依赖(可空)","downstream":"下游(可空)","note":"说明(可空)"}]}。module 是较大的功能域（如 实验/运行/评分），task 是其下独立功能点。owner 保留原文写法（哪怕是 用户205043 这类匿名名）。只输出 JSON。'
        },
        { role: "user", content: (text ?? "").slice(0, 6000) }
      ],
      temperature: 0.1,
      max_tokens: 4000,
      signal: AbortSignal.timeout(90_000)
    })
  });
  if (!response.ok) throw new Error(`大模型解析失败：HTTP ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  const json = JSON.parse(raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim()) as {
    tasks?: Array<Record<string, string>>;
  };
  const byModule = new Map<string, AssignmentModule>();
  for (const item of json.tasks ?? []) {
    const moduleName = String(item.module ?? "").trim() || "未分组";
    const module = byModule.get(moduleName) ?? { name: moduleName, owners: [], tasks: [] };
    const owner = String(item.owner ?? "").trim() || undefined;
    if (owner && !module.owners.includes(owner)) module.owners.push(owner);
    module.tasks.push({
      key: String(item.key ?? "").trim() || undefined,
      name: String(item.task ?? "").trim(),
      owner,
      upstream: String(item.upstream ?? "").trim() || undefined,
      downstream: String(item.downstream ?? "").trim() || undefined,
      note: String(item.note ?? "").trim() || undefined
    });
    byModule.set(moduleName, module);
  }
  const modules = [...byModule.values()].filter((module) => module.tasks.length);
  if (!modules.length) throw new Error("大模型没有解析出任务，请检查文本内容");
  return { modules };
}

function md5Short(value: string): string {
  // 只为生成稳定的导入 key，不涉及安全
  return crypto.createHash("md5").update(value).digest("hex").slice(0, 8);
}

/** 把预览落库：缺失的用户/模块会创建；已有模块只补空缺字段，不覆盖人工改动 */
export function applyAssignment(preview: AssignmentPreview, actor = "system", projectId = 1): {
  modules: number; tasks: number; usersCreated: number; aliases: number;
} {
  const existingUsers = queryAll<{ id: number; displayName: string }>(`SELECT id, display_name AS displayName FROM users`);
  const nameToUser = new Map<string, number>();
  for (const user of existingUsers) nameToUser.set(user.displayName.trim(), user.id);
  let usersCreated = 0;
  let aliases = 0;

  const ensureUser = (name: string): number => {
    const clean = name.trim();
    const existing = nameToUser.get(clean);
    if (existing) return existing;
    const username = `import-${md5Short(clean)}`;
    const inserted = execute(
      `INSERT INTO users (username, display_name, role, active) VALUES (?, ?, 'developer', 1)`,
      [username, clean]
    );
    const id = Number(inserted.lastInsertRowid);
    nameToUser.set(clean, id);
    usersCreated += 1;
    return id;
  };

  const alias = (name: string, userId: number) => {
    execute(
      `INSERT INTO identity_aliases (project_id, alias, user_id, source) VALUES (?, ?, ?, 'import')
       ON CONFLICT(project_id, alias) DO UPDATE SET user_id = excluded.user_id`,
      [projectId, name.trim(), userId]
    );
    aliases += 1;
  };

  let moduleCount = 0;
  let taskCount = 0;
  const existingModules = queryAll<{ id: number; name: string; moduleKey: string }>(
    `SELECT id, name, module_key AS moduleKey FROM modules WHERE project_id = ?`, [projectId]
  );
  for (const module of preview.modules) {
    const moduleName = module.name.trim();
    if (!moduleName) continue;
    let top = existingModules.find((row) => row.name === moduleName);
    if (!top) {
      const key = `module-${md5Short(moduleName)}`;
      execute(
        `INSERT INTO modules (project_id, module_key, name, owner_user_id, status) VALUES (?, ?, ?, NULL, 'not_started')`,
        [projectId, key, moduleName]
      );
      top = { id: Number(queryOne(`SELECT id FROM modules WHERE project_id = ? AND module_key = ?`, [projectId, key])!.id), name: moduleName, moduleKey: key };
      moduleCount += 1;
    }
    const ownerIds = module.owners.filter(Boolean).map(ensureUser);
    for (const [index, name] of module.owners.entries()) {
      if (name) alias(name, ownerIds[index]);
    }
    // 顶层模块只有一列 owner：取第一负责人，其余进 description 备注（限制已写进文档）
    if (ownerIds.length) {
      const current = queryOne<{ owner: number | null }>(`SELECT owner_user_id AS owner FROM modules WHERE id = ?`, [top.id])?.owner;
      if (!current) execute(`UPDATE modules SET owner_user_id = ? WHERE id = ?`, [ownerIds[0], top.id]);
    }

    for (const task of module.tasks) {
      const taskName = task.name?.trim();
      if (!taskName) continue;
      const key = /^[A-Za-z]+-\d+$/.test(task.key ?? "")
        ? `work-${task.key!.toLowerCase()}`
        : `work-${md5Short(`${moduleName}/${taskName}`)}`;
      const exists = existingModules.find((row) => row.moduleKey === key || row.name === taskName);
      if (exists) continue;
      const ownerUserId = task.owner ? ensureUser(task.owner) : null;
      if (task.owner) alias(task.owner, ownerUserId!);
      const noteBits = [
        task.upstream ? `上游：${task.upstream}` : "",
        task.downstream ? `下游：${task.downstream}` : "",
        task.note ? `说明：${task.note}` : ""
      ].filter(Boolean);
      execute(
        `INSERT INTO modules (project_id, module_key, name, owner_user_id, status, group_name, description)
         VALUES (?, ?, ?, ?, 'not_started', ?, ?)`,
        [projectId, key, taskName, ownerUserId, moduleName, noteBits.join("；")]
      );
      taskCount += 1;
    }
  }
  return { modules: moduleCount, tasks: taskCount, usersCreated, aliases };
}

/** 身份对齐（向导第三步）：列出 PR 作者账号与解析结果，未解析的就是待确认别名 */
export function identitySuggestions(projectId = 1): Array<{
  login: string; prs: number; resolvedTo: number | null; resolvedName: string | null; sampleNames: string[];
}> {
  const index = buildUserIndex(projectId);
  const rows = queryAll<{ login: string; c: number }>(
    `SELECT author_login AS login, COUNT(*) AS c FROM pull_requests
     WHERE project_id = ? AND author_login IS NOT NULL GROUP BY author_login ORDER BY c DESC`,
    [projectId]
  );
  const nameById = new Map<number, string>();
  for (const row of queryAll<{ id: number; displayName: string }>(`SELECT id, display_name AS displayName FROM users`)) {
    nameById.set(row.id, row.displayName);
  }
  return rows.map((row) => {
    const userId = index.byLogin.get(row.login) ?? null;
    return {
      login: row.login,
      prs: row.c,
      resolvedTo: userId,
      resolvedName: userId ? nameById.get(userId) ?? null : null,
      sampleNames: index.namesByLogin.get(row.login) ?? []
    };
  });
}

export function upsertIdentityAlias(alias: string, userId: number, projectId = 1) {
  execute(
    `INSERT INTO identity_aliases (project_id, alias, user_id, source) VALUES (?, ?, ?, 'manual')
     ON CONFLICT(project_id, alias) DO UPDATE SET user_id = excluded.user_id`,
    [projectId, alias.trim(), userId]
  );
  return { ok: true };
}
