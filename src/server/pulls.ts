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
import { giteeRequest } from "./gitee.js";

export interface PullRecord {
  number: number;
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

function upsertPull(project: number, pull: PullRecord) {
  execute(
    `INSERT INTO pull_requests (project_id, number, title, body, state, base_ref, head_ref, head_sha, author_login,
       merged_at, created_at, updated_at, files_json, additions, deletions, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, number) DO UPDATE SET
       title = excluded.title, body = excluded.body, state = excluded.state,
       base_ref = excluded.base_ref, head_ref = excluded.head_ref, head_sha = excluded.head_sha,
       author_login = excluded.author_login, merged_at = excluded.merged_at,
       updated_at = excluded.updated_at, files_json = excluded.files_json,
       additions = excluded.additions, deletions = excluded.deletions, synced_at = datetime('now')`,
    [project, pull.number, pull.title, pull.body, pull.state, pull.baseRef, pull.headRef, pull.headSha,
      pull.authorLogin, pull.mergedAt, pull.createdAt, pull.updatedAt, JSON.stringify(pull.files),
      pull.additions, pull.deletions]
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
