/**
 * PR 级数据：同步、引用关系挖掘、与主干的偏离检测。
 *
 * 为什么需要 PR 级而不只是模块级：
 * 该仓库 315 个 PR 的 960 条评审里，72% 的评论引用了其他 PR（共 4395 次、936 组关系），
 * 25% 的 PR 直接叠在另一个 PR 的分支上（base 不是 main），还有 8 个以上专门的
 * 「进 main 前的合并同步」PR。也就是说真正需要协调的耦合大量发生在 PR 之间，
 * 而不是模块之间——只按模块粒度看会漏掉这一类。
 */
import { audit, execute, parseJson, queryAll, queryOne } from "./db.js";
import { config } from "./config.js";
import { fetchPullRequestCommits, giteeRequest, type PullCommit } from "./gitee.js";
import type { CommitLine } from "./feishu.js";

export interface PullRecord {
  number: number;
  /** Gitee 内部的数据库 id。评论类 WebHook 只给 noteable_id（就是这个值），不给 PR 编号，靠它反查 */
  remoteId: number | null;
  title: string;
  body: string;
  state: string;
  baseRef: string | null;
  headRef: string | null;
  headSha: string | null;
  authorLogin: string | null;
  mergedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  files: string[];
  additions: number;
  deletions: number;
}

const REF_RE = /!(?:\d{1,4})(?!\d)/g;

/** 从任意文本里挖 PR 引用（该仓库的固定写法是 `!78`） */
export function mineReferences(text: string): number[] {
  if (!text) return [];
  const found = new Set<number>();
  for (const match of text.matchAll(REF_RE)) {
    const value = Number(match[0].slice(1));
    if (Number.isFinite(value) && value > 0) found.add(value);
  }
  return [...found];
}

function projectId() {
  return queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)?.id ?? 1;
}

function mapPull(row: Record<string, unknown>): PullRecord {
  const head = (row.head ?? {}) as Record<string, unknown>;
  const base = (row.base ?? {}) as Record<string, unknown>;
  const user = (row.user ?? {}) as Record<string, unknown>;
  return {
    number: Number(row.number ?? 0),
    remoteId: Number(row.id ?? 0) || null,
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    state: String(row.state ?? "open"),
    baseRef: typeof base.ref === "string" ? base.ref : null,
    headRef: typeof head.ref === "string" ? head.ref : null,
    headSha: typeof head.sha === "string" ? head.sha : null,
    authorLogin: typeof user.login === "string" ? user.login : null,
    mergedAt: typeof row.merged_at === "string" ? row.merged_at : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    files: [],
    additions: Number(row.additions ?? 0) || 0,
    deletions: Number(row.deletions ?? 0) || 0
  };
}

export async function fetchPullFiles(number: number): Promise<string[]> {
  if (!config.giteeRepo) return [];
  const [owner, name] = config.giteeRepo.split("/");
  const rows = await giteeRequest<Array<Record<string, unknown>>>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/files`
  );
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => String(row.filename ?? "").trim()).filter(Boolean);
}

export async function fetchPullComments(number: number): Promise<string[]> {
  if (!config.giteeRepo) return [];
  const [owner, name] = config.giteeRepo.split("/");
  const rows = await giteeRequest<Array<Record<string, unknown>>>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/comments?per_page=100`
  );
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => String(row.body ?? ""));
}

function upsertPull(project: number, pull: PullRecord, authors?: Array<{ name: string | null; email: string | null }>) {
  execute(
    `INSERT INTO pull_requests (project_id, number, remote_id, title, body, state, base_ref, head_ref, head_sha, author_login,
       merged_at, created_at, updated_at, files_json, additions, deletions, authors_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, number) DO UPDATE SET
       remote_id = excluded.remote_id,
       title = excluded.title, body = excluded.body, state = excluded.state,
       base_ref = excluded.base_ref, head_ref = excluded.head_ref, head_sha = excluded.head_sha,
       author_login = excluded.author_login, merged_at = excluded.merged_at,
       updated_at = excluded.updated_at, files_json = excluded.files_json,
       additions = excluded.additions, deletions = excluded.deletions,
       authors_json = COALESCE(excluded.authors_json, pull_requests.authors_json), synced_at = datetime('now')`,
    [project, pull.number, pull.remoteId, pull.title, pull.body, pull.state, pull.baseRef, pull.headRef, pull.headSha,
      pull.authorLogin, pull.mergedAt, pull.createdAt, pull.updatedAt, JSON.stringify(pull.files),
      pull.additions, pull.deletions, authors ? JSON.stringify(authors) : null]
  );
}

function recordReferences(project: number, from: number, texts: string[], source: string) {
  const counts = new Map<number, number>();
  for (const text of texts) {
    for (const to of mineReferences(text)) {
      if (to === from) continue;
      counts.set(to, (counts.get(to) ?? 0) + 1);
    }
  }
  for (const [to, hits] of counts) {
    execute(
      `INSERT INTO pull_references (project_id, from_number, to_number, source, hits, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(project_id, from_number, to_number) DO UPDATE SET hits = excluded.hits, updated_at = datetime('now')`,
      [project, from, to, source, hits]
    );
  }
  return counts.size;
}

/**
 * 同步 PR 元数据。变更文件只对**未合并**的 PR 拉取（它们才是需要判断冲突的对象），
 * 已合并的历史 PR 只留元信息与引用关系，避免几百次 API 调用。
 */
export async function syncPullRequests(options: { withComments?: boolean; withFiles?: boolean } = {}) {
  if (!config.giteeRepo || !config.giteeToken) throw new Error("GITEE_TOKEN 与 GITEE_REPO 未配置");
  const project = projectId();
  const [owner, name] = config.giteeRepo.split("/");
  const pulls: PullRecord[] = [];

  for (let page = 1; page <= 12; page += 1) {
    const batch = await giteeRequest<Array<Record<string, unknown>>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=all&per_page=100&page=${page}&sort=created&direction=desc`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    pulls.push(...batch.map(mapPull));
    if (batch.length < 100) break;
  }

  let filesFetched = 0;
  let references = 0;
  for (const pull of pulls) {
    const open = pull.state === "open" || pull.state === "progressing";
    if (options.withFiles !== false && open) {
      pull.files = await fetchPullFiles(pull.number).catch(() => []);
      filesFetched += pull.files.length ? 1 : 0;
    } else {
      const existing = queryOne<{ filesJson: string }>(
        `SELECT files_json AS filesJson FROM pull_requests WHERE project_id = ? AND number = ?`,
        [project, pull.number]
      );
      pull.files = existing ? parseJson<string[]>(existing.filesJson, []) : [];
    }
    upsertPull(project, pull);
    references += recordReferences(project, pull.number, [pull.body], "body");
    if (options.withComments) {
      const comments = await fetchPullComments(pull.number).catch(() => [] as string[]);
      references += recordReferences(project, pull.number, comments, "comment");
    }
  }

  audit(null, "system", "pulls_sync", "project", config.giteeRepo, { pulls: pulls.length, filesFetched, references });
  return {
    pulls: pulls.length,
    openPulls: pulls.filter((item) => item.state === "open").length,
    filesFetched,
    references
  };
}

/**
 * WebHook 收到 PR 事件时直接落库，让进度页的数据跟上实时回调，
 * 而不是等下一次手动 sync-pulls。state 优先取事件动作（merge 动作的
 * payload 里 state 可能还是 open，但它已经合并了）。
 */
export function upsertPullFromWebhook(
  projectId: number,
  raw: Record<string, unknown>,
  options: { files?: string[]; authors?: Array<{ name: string | null; email: string | null }>; action?: string } = {}
) {
  const pull = mapPull(raw);
  if (options.files) pull.files = options.files;
  if (/^(merge|merged)$/i.test(options.action ?? "")) {
    pull.state = "merged";
    pull.mergedAt = pull.mergedAt ?? new Date().toISOString();
  }
  upsertPull(projectId, pull, options.authors);
  return pull;
}

export function listPulls(options: { state?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = queryAll<Record<string, unknown>>(
    `SELECT number, title, state, base_ref AS baseRef, head_ref AS headRef, head_sha AS headSha,
            author_login AS authorLogin, merged_at AS mergedAt, created_at AS createdAt, updated_at AS updatedAt,
            files_json AS filesJson, additions, deletions, synced_at AS syncedAt
     FROM pull_requests WHERE (? = '' OR state = ?) ORDER BY number DESC LIMIT ?`,
    [options.state ?? "", options.state ?? "", limit]
  );
  return rows.map((row) => ({
    ...row,
    open: row.state === "open",
    stacked: Boolean(row.baseRef) && !/^(main|master)$/.test(String(row.baseRef)),
    files: parseJson<string[]>(row.filesJson, [])
  }));
}

export function getPull(number: number) {
  const row = queryOne<Record<string, unknown>>(
    `SELECT number, title, body, state, base_ref AS baseRef, head_ref AS headRef, head_sha AS headSha,
            author_login AS authorLogin, merged_at AS mergedAt, created_at AS createdAt, updated_at AS updatedAt,
            files_json AS filesJson, additions, deletions
     FROM pull_requests WHERE project_id = ? AND number = ?`,
    [projectId(), number]
  );
  if (!row) return undefined;
  return { ...row, files: parseJson<string[]>(row.filesJson, []) };
}

/** PR 级依赖图：节点是 PR，边是评论/正文里的引用 */
export function pullGraph(limit = 120) {
  const pulls = queryAll<Record<string, unknown>>(
    `SELECT number, title, state, base_ref AS baseRef, author_login AS authorLogin, merged_at AS mergedAt
     FROM pull_requests ORDER BY number DESC LIMIT ?`,
    [limit]
  );
  const numbers = new Set(pulls.map((row) => Number(row.number)));
  const edges = queryAll<Record<string, unknown>>(
    `SELECT from_number AS fromNumber, to_number AS toNumber, source, hits FROM pull_references ORDER BY hits DESC`
  ).filter((row) => numbers.has(Number(row.fromNumber)) && numbers.has(Number(row.toNumber)));
  const inDegree = new Map<number, number>();
  const outDegree = new Map<number, number>();
  for (const edge of edges) {
    inDegree.set(Number(edge.toNumber), (inDegree.get(Number(edge.toNumber)) ?? 0) + 1);
    outDegree.set(Number(edge.fromNumber), (outDegree.get(Number(edge.fromNumber)) ?? 0) + 1);
  }
  return {
    nodes: pulls.map((row) => ({
      number: Number(row.number),
      title: String(row.title),
      state: String(row.state),
      base: row.baseRef ? String(row.baseRef) : null,
      author: row.authorLogin ? String(row.authorLogin) : null,
      stacked: Boolean(row.baseRef) && !/^(main|master)$/.test(String(row.baseRef)),
      referencedBy: inDegree.get(Number(row.number)) ?? 0,
      references: outDegree.get(Number(row.number)) ?? 0
    })),
    edges: edges.map((row) => ({
      from: Number(row.fromNumber), to: Number(row.toNumber),
      source: String(row.source), hits: Number(row.hits)
    }))
  };
}

export function pullStats() {
  const total = queryOne<{ c: number }>(`SELECT COUNT(*) c FROM pull_requests`)?.c ?? 0;
  const open = queryOne<{ c: number }>(`SELECT COUNT(*) c FROM pull_requests WHERE state = 'open'`)?.c ?? 0;
  const merged = queryOne<{ c: number }>(`SELECT COUNT(*) c FROM pull_requests WHERE merged_at IS NOT NULL`)?.c ?? 0;
  const stacked = queryAll<{ baseRef: string | null }>(
    `SELECT base_ref AS baseRef FROM pull_requests WHERE state = 'open'`
  ).filter((row) => row.baseRef && !/^(main|master)$/.test(row.baseRef)).length;
  const refs = queryOne<{ c: number }>(`SELECT COUNT(*) c FROM pull_references`)?.c ?? 0;
  const lastSync = queryOne<{ at: string }>(`SELECT MAX(synced_at) AS at FROM pull_requests`)?.at ?? null;
  return { total, open, merged, stacked, references: refs, lastSync };
}

/**
 * 主干前进会影响哪些在飞 PR：
 * 用本次推送到主干的文件集合，与未合并 PR 的变更文件求交。
 * 这是该仓库里靠人工反复做的事（「进 main 前的合并同步」PR 出现 8 次以上）。
 */
export function pullsTouchedBy(files: string[]) {
  if (!files.length) return [];
  const changed = new Set(files.map((file) => file.replace(/\\/g, "/")));
  const impacted: Array<{ number: number; title: string; author: string | null; base: string | null; shared: string[] }> = [];
  for (const row of queryAll<Record<string, unknown>>(
    `SELECT number, title, base_ref AS baseRef, head_ref AS headRef, author_login AS authorLogin, files_json AS filesJson
     FROM pull_requests WHERE state = 'open'`
  )) {
    const own = parseJson<string[]>(row.filesJson, []);
    const shared = own.filter((file) => changed.has(file.replace(/\\/g, "/")));
    if (!shared.length) continue;
    impacted.push({
      number: Number(row.number),
      title: String(row.title),
      author: row.authorLogin ? String(row.authorLogin) : null,
      base: row.baseRef ? String(row.baseRef) : null,
      shared: shared.slice(0, 5)
    });
  }
  return impacted.sort((a, b) => b.shared.length - a.shared.length);
}

/**
 * 把已经同步下来的 PR 文件列表回填进历史 WebHook 事件。
 *
 * 为什么需要：影响分析的路径证据来自事件 payload 里的文件列表，而 PR 与评论类事件的
 * payload 本身不带文件。实测某仓库 284 个事件里有 207 个（占影响的 60%）没有文件列表，
 * 于是这些影响只能靠语义猜词——不是模式不好，是**根本没有路径可匹配**。
 * PR 的文件列表在 `sync-pulls` 时已经落库，因此回填不需要任何额外 API 调用。
 */
export async function backfillEventFiles(
  options: { fetchMissing?: boolean; maxFetches?: number } = {},
  projectId = 1
): Promise<{ scanned: number; filled: number; files: number; unresolved: number; fetched: number }> {
  const pulls = queryAll<{ number: number; remoteId: number | null; state: string; filesJson: string }>(
    `SELECT number, remote_id AS remoteId, state, files_json AS filesJson FROM pull_requests WHERE project_id = ?`,
    [projectId]
  );
  const byNumber = new Map<number, string[]>();
  const byRemoteId = new Map<number, string[]>();
  const numberByRemoteId = new Map<number, number>();
  for (const pull of pulls) {
    if (pull.remoteId) numberByRemoteId.set(pull.remoteId, pull.number);
    const files = parseJson<string[]>(pull.filesJson, []).filter(Boolean);
    if (!files.length) continue;
    byNumber.set(pull.number, files);
    if (pull.remoteId) byRemoteId.set(pull.remoteId, files);
  }
  // 历史上已合入/已关闭的 PR 在同步时不会去拉文件（只有在飞 PR 才需要），
  // 但要给历史事件补路径证据就得按需回查，并缓存回库避免重复调用。
  const maxFetches = options.maxFetches ?? 200;
  let fetched = 0;
  const loadFiles = async (number: number): Promise<string[]> => {
    const cached = byNumber.get(number);
    if (cached) return cached;
    if (options.fetchMissing !== true || fetched >= maxFetches) return [];
    fetched += 1;
    const files = await fetchPullFiles(number).catch(() => [] as string[]);
    if (!files.length) return [];
    byNumber.set(number, files);
    const remoteId = [...numberByRemoteId.entries()].find(([, value]) => value === number)?.[0];
    if (remoteId) byRemoteId.set(remoteId, files);
    execute(`UPDATE pull_requests SET files_json = ?, synced_at = datetime('now') WHERE project_id = ? AND number = ?`,
      [JSON.stringify(files), projectId, number]);
    return files;
  };

  const events = queryAll<{ id: number; payloadJson: string }>(
    `SELECT id, payload_json AS payloadJson FROM change_events
     WHERE project_id = ? AND (event_type = 'pull_request' OR event_type = 'note')`,
    [projectId]
  );
  let scanned = 0;
  let filled = 0;
  let filesTotal = 0;
  let unresolved = 0;
  for (const event of events) {
    const payload = parseJson<Record<string, unknown>>(event.payloadJson, {});
    if (Array.isArray(payload.files) && payload.files.length) continue;
    scanned += 1;
    const pull = (payload.pull_request ?? {}) as Record<string, unknown>;
    const number = Number(payload.number ?? payload.iid ?? pull.number ?? 0) || 0;
    // 评论类事件只给 noteable_id（Gitee 的数据库 id），PR 类事件才给编号
    const noteableId = Number(payload.noteable_id ?? 0) || 0;
    const resolved = number || numberByRemoteId.get(noteableId) || 0;
    const files = resolved ? await loadFiles(resolved) : [];
    if (!files.length) {
      unresolved += 1;
      continue;
    }
    execute(`UPDATE change_events SET payload_json = ? WHERE id = ?`, [
      JSON.stringify({ ...payload, files }),
      event.id
    ]);
    filled += 1;
    filesTotal += files.length;
  }
  return { scanned, filled, files: filesTotal, unresolved, fetched };
}

/** 事件接收时间（SQLite UTC 串）与提交时间都折成毫秒；SQLite 串没有时区标记，按 UTC 解读 */
function toStamp(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const stamp = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(stamp) ? stamp : 0;
}

/**
 * 为历史 PR 事件挑出「这次事件真正推进的那个提交」。
 *
 * 规则与实时路径的 pickHeadCommit 同源，但多一层事件时间约束：
 * - 优先按事件 payload 里存的 head sha 精确匹配（那就是事件当时的状态）；
 * - head sha 缺失或已被 force push 抹掉时，取**事件时刻之前**的最新提交——
 *   当前提交列表里的更新提交在事件发生时还不存在，绝不能拿；
 * - 两者都不可得返回 null（unresolved），不按列表位置猜。
 */
export function pickHistoricalHead<T extends { sha: string; date: string | null }>(
  commits: T[],
  headSha: string | null | undefined,
  receivedAt: string | number | null | undefined
): T | null {
  if (!commits.length) return null;
  if (headSha) {
    const exact = commits.find((commit) => commit.sha === headSha || commit.sha.startsWith(headSha.slice(0, 8)));
    if (exact) return exact;
  }
  const bound = toStamp(receivedAt) + 120_000; // 2 分钟时钟余量
  const candidates = commits
    .map((commit) => ({ commit, stamp: toStamp(commit.date) }))
    .filter((item) => item.stamp > 0 && item.stamp <= bound)
    .sort((a, b) => b.stamp - a.stamp);
  return candidates[0]?.commit ?? null;
}

export interface BackfillPullHeadSample {
  event: number;
  pull: number | null;
  before: string;
  after: string;
}

/**
 * 把历史 PR 事件里存错的 pullHead（提交者身份）重算。
 *
 * 为什么需要：旧实现取 `/pulls/{n}/commits` 的 `at(-1)`（最老提交）当"提交者"，
 * PR !309 的一次 update 被写成一天前最老提交的作者。`pickHeadCommit` 修复了新事件，
 * 但已落库的 payload_json 里还是错的 pullHead——控制台回看旧事件看到的仍是错误身份。
 *
 * 默认只预览（options.apply 为 false），会照常回查 Gitee 提交列表（只读）；
 * 每个 PR 只拉一次并分页取全（head sha 可能不在第一页），`--max` 限制回查的 PR 数。
 */
export async function backfillPullHeads(
  options: { apply?: boolean; maxFetches?: number } = {},
  projectId = 1
): Promise<{
  scanned: number; withoutHead: number; fixed: number; alreadyCorrect: number; unresolved: number;
  fetched: number; samples: BackfillPullHeadSample[];
}> {
  if (!config.giteeRepo || !config.giteeToken) throw new Error("GITEE_TOKEN 与 GITEE_REPO 未配置");
  const events = queryAll<{ id: number; payloadJson: string; createdAt: string }>(
    `SELECT id, payload_json AS payloadJson, created_at AS createdAt FROM change_events
     WHERE project_id = ? AND event_type = 'pull_request'`,
    [projectId]
  );
  const commitsByPull = new Map<number, PullCommit[]>();
  const maxFetches = options.maxFetches ?? 200;
  let fetched = 0;
  let scanned = 0;
  let withoutHead = 0;
  let fixed = 0;
  let alreadyCorrect = 0;
  let unresolved = 0;
  const samples: BackfillPullHeadSample[] = [];
  const describe = (head: CommitLine) =>
    `${head.shortSha} ${head.authorName}${head.authorEmail ? ` <${head.authorEmail}>` : ""}`;

  const loadCommits = async (number: number): Promise<PullCommit[] | null> => {
    const cached = commitsByPull.get(number);
    if (cached) return cached;
    if (fetched >= maxFetches) return null;
    fetched += 1;
    const commits = await fetchPullRequestCommits(config.giteeRepo, number, { perPage: 100, maxPages: 5 }).catch(() => [] as PullCommit[]);
    commitsByPull.set(number, commits);
    return commits;
  };

  for (const event of events) {
    const payload = parseJson<Record<string, unknown>>(event.payloadJson, {});
    const head = payload.pullHead as CommitLine | undefined;
    if (!head) {
      // `/api/gitee/sync` 建的事件从未走过 enrich，没有 pullHead，不在本次修正范围
      withoutHead += 1;
      continue;
    }
    scanned += 1;
    const pull = (payload.pull_request ?? {}) as Record<string, unknown>;
    const pullHeadRef = (pull.head ?? {}) as Record<string, unknown>;
    const number = Number(payload.number ?? payload.iid ?? pull.number ?? 0) || 0;
    const commits = number ? await loadCommits(number) : null;
    if (!commits || commits.length === 0) {
      unresolved += 1;
      continue;
    }
    const headSha = typeof pullHeadRef.sha === "string" ? pullHeadRef.sha : null;
    const candidate = pickHistoricalHead(commits, headSha, event.createdAt);
    if (!candidate) {
      unresolved += 1;
      continue;
    }
    const nextHead: CommitLine = {
      ...head,
      shortSha: candidate.sha.slice(0, 8),
      summary: candidate.message.split("\n")[0] || head.summary,
      authorName: candidate.name ?? head.authorName,
      authorEmail: candidate.email,
      committedAt: candidate.date ?? head.committedAt,
      // 旧数据把「分支」写成目标分支 main，同样按 payload 里的源分支修正
      branch: typeof pullHeadRef.ref === "string" && pullHeadRef.ref ? pullHeadRef.ref : head.branch
    };
    if (nextHead.shortSha === head.shortSha && nextHead.authorEmail === head.authorEmail && nextHead.branch === head.branch) {
      alreadyCorrect += 1;
      continue;
    }
    if (samples.length < 8) {
      samples.push({ event: event.id, pull: number || null, before: describe(head), after: describe(nextHead) });
    }
    if (options.apply) {
      execute(`UPDATE change_events SET payload_json = ? WHERE id = ?`, [
        JSON.stringify({ ...payload, pullHead: nextHead }),
        event.id
      ]);
    }
    fixed += 1;
  }

  if (options.apply) {
    audit(null, "system", "backfill_pull_head", "project", projectId, { scanned, fixed, alreadyCorrect, unresolved, fetched });
  }
  return { scanned, withoutHead, fixed, alreadyCorrect, unresolved, fetched, samples };
}

/* ---------- PR 评论：时间线的评审事件源 ---------- */

export interface PullCommentRecord {
  remoteId: number | null;
  pullNumber: number;
  source: "issue" | "pull" | "webhook";
  body: string;
  authorLogin: string | null;
  authorName: string | null;
  createdAt: string | null;
  url: string | null;
}

function mapComment(number: number, raw: Record<string, unknown>, source: "issue" | "pull"): PullCommentRecord {
  const user = (raw.user ?? {}) as Record<string, unknown>;
  return {
    remoteId: Number(raw.id ?? 0) || null,
    pullNumber: number,
    source,
    body: String(raw.body ?? "").slice(0, 2000),
    authorLogin: typeof user.login === "string" ? user.login : null,
    authorName: typeof user.name === "string" ? user.name : null,
    createdAt: typeof raw.created_at === "string" ? raw.created_at : null,
    url: typeof raw.html_url === "string" ? raw.html_url : null
  };
}

/**
 * 拉一个 PR 的全部评论：会话评论（issues 端点）+ 行内评审（pulls 端点）。
 * 两个端点的 id 空间独立，用 source 区分；时间线层再按 (number, remoteId) 去重。
 */
export async function fetchPullCommentRecords(number: number): Promise<PullCommentRecord[]> {
  const out: PullCommentRecord[] = [];
  const fetchEndpoint = async (path: string, source: "issue" | "pull") => {
    for (let page = 1; page <= 2; page += 1) {
      const rows = await giteeRequest<Array<Record<string, unknown>>>(`${path}?per_page=100&page=${page}`);
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) out.push(mapComment(number, row, source));
      if (rows.length < 100) break;
    }
  };
  const [owner, name] = (config.giteeRepo ?? "").split("/");
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  await fetchEndpoint(`${base}/issues/${number}/comments`, "issue").catch(() => undefined);
  await fetchEndpoint(`${base}/pulls/${number}/comments`, "pull").catch(() => undefined);
  return out;
}

function saveComment(projectId: number, comment: PullCommentRecord) {
  execute(
    `INSERT INTO pull_comments (project_id, pull_number, remote_id, source, body, author_login, author_name, created_at, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, pull_number, source, remote_id) DO UPDATE SET
       body = excluded.body, author_login = excluded.author_login,
       author_name = excluded.author_name, created_at = excluded.created_at, url = excluded.url`,
    [projectId, comment.pullNumber, comment.remoteId, comment.source,
     comment.body, comment.authorLogin, comment.authorName, comment.createdAt, comment.url]
  );
}

/** 分块回填评论：每次最多 max 个 PR，返回 remaining 供循环 */
export async function backfillPullComments(
  options: { max?: number } = {},
  projectId = 1
): Promise<{ pulls: number; comments: number; remaining: number }> {
  const max = Math.max(1, Math.min(options.max ?? 40, 200));
  if (!config.giteeRepo || !config.giteeToken) throw new Error("GITEE_TOKEN 与 GITEE_REPO 未配置");
  const done = new Set<number>(
    queryAll<{ pullNumber: number }>(
      `SELECT DISTINCT pull_number AS pullNumber FROM pull_comments WHERE project_id = ?`, [projectId]
    ).map((row) => row.pullNumber)
  );
  const candidates = queryAll<{ number: number }>(
    `SELECT number FROM pull_requests WHERE project_id = ? ORDER BY number DESC`, [projectId]
  ).map((row) => row.number);
  const targets = candidates.filter((number) => !done.has(number)).slice(0, max);
  let comments = 0;
  for (const number of targets) {
    const records = await fetchPullCommentRecords(number).catch(() => [] as PullCommentRecord[]);
    for (const record of records) {
      saveComment(projectId, { ...record, pullNumber: number });
      comments += 1;
    }
  }
  return { pulls: targets.length, comments, remaining: Math.max(candidates.filter((n) => !done.has(n)).length - targets.length, 0) };
}

/** WebHook note 事件增量落评论（PR 会话评论）；pull_number 靠 noteable_id 反查 */
export function upsertPullCommentFromWebhook(projectId: number, payload: Record<string, unknown>) {
  const note = (payload.note ?? {}) as Record<string, unknown>;
  const noteId = Number(note.id ?? 0) || 0;
  if (!noteId) return null;
  let number = Number(payload.number ?? payload.iid ?? 0) || 0;
  if (!number) {
    const noteableId = Number(payload.noteable_id ?? 0) || 0;
    if (noteableId) {
      number = Number(
        queryOne<{ number: number }>(
          `SELECT number FROM pull_requests WHERE project_id = ? AND remote_id = ?`,
          [projectId, noteableId]
        )?.number ?? 0
      );
    }
  }
  if (!number) return null;
  const user = (note.user ?? {}) as Record<string, unknown>;
  const record: PullCommentRecord = {
    remoteId: noteId,
    pullNumber: number,
    source: "webhook",
    body: String(note.body ?? "").slice(0, 2000),
    authorLogin: typeof user.login === "string" ? user.login : null,
    authorName: typeof user.name === "string" ? user.name : null,
    createdAt: typeof note.created_at === "string" ? note.created_at : null,
    url: typeof note.html_url === "string" ? note.html_url : null
  };
  execute(
    `INSERT INTO pull_comments (project_id, pull_number, remote_id, source, body, author_login, author_name, created_at, url)
     VALUES (?, ?, ?, 'webhook', ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, pull_number, source, remote_id) DO UPDATE SET
       body = excluded.body, created_at = excluded.created_at`,
    [projectId, record.pullNumber, record.remoteId, record.body, record.authorLogin, record.authorName, record.createdAt, record.url]
  );
  return record;
}
