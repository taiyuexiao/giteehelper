import { parseJson, queryAll, queryOne } from "./db.js";
import { isOperationalModule } from "./impact.js";
import { ownerPalette, UNASSIGNED_OWNER } from "../shared/ownerColor.js";
import type {
  GraphEdge, GraphNode, RepoCommitMeta, RepoGraphData, RepoGraphStats, RepoOwnerCluster, Severity
} from "../shared/types.js";

/** 24 小时内收到的提交在 3D 图中带脉冲特效 */
const NEW_COMMIT_WINDOW_HOURS = 24;
/** 30 分钟内刚收到的提交触发一次爆发特效 */
const JUST_ARRIVED_MINUTES = 30;

function ageInHours(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(timestamp)) return null;
  return (Date.now() - timestamp) / 3_600_000;
}

function minutesSince(value: string | null): number | null {
  const hours = ageInHours(value);
  return hours === null ? null : hours * 60;
}

export function buildRepoGraph(limit = 80, projectId = 1): RepoGraphData {  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const commitIdsByOwner = new Map<string, string[]>();

  const project = queryOne<{ id: number; name: string; giteeRepo: string | null; defaultBranch: string }>(
    `SELECT id, name, gitee_repo AS giteeRepo, default_branch AS defaultBranch FROM projects ORDER BY id LIMIT 1`
  );
  if (project) {
    nodes.set(`project:${project.id}`, {
      id: `project:${project.id}`,
      label: project.giteeRepo || project.name,
      type: "project",
      meta: { branch: project.defaultBranch, name: project.name }
    });
  }
  const projectId_ = project ? `project:${project.id}` : null;

  const moduleRows = queryAll<{
    id: number; moduleKey: string; name: string; ownerName: string | null; status: string;
    pathsJson: string; scenariosJson: string; providesJson: string; requiresJson: string; description: string | null;
  }>(
    `SELECT m.id, m.module_key AS moduleKey, m.name, u.display_name AS ownerName, m.status,
            m.paths_json AS pathsJson, m.scenarios_json AS scenariosJson,
            m.provides_json AS providesJson, m.requires_json AS requiresJson, m.description
     FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id`
  ).filter((row) => isOperationalModule(row));

  const clusters = new Map<string, RepoOwnerCluster>();
  const moduleOwner = new Map<number, string>();

  for (const module of moduleRows) {
    const owner = module.ownerName?.trim() || UNASSIGNED_OWNER;
    moduleOwner.set(module.id, owner);
    const palette = ownerPalette(owner);
    const paths = parseJson<string[]>(module.pathsJson, []);
    nodes.set(`module:${module.id}`, {
      id: `module:${module.id}`,
      label: module.name,
      type: "module",
      meta: {
        key: module.moduleKey,
        status: module.status,
        owner,
        ownerFill: palette.fill,
        ownerStroke: palette.stroke,
        ownerText: palette.text,
        paths,
        description: module.description
      }
    });
    if (projectId_) edges.push({ id: `project-module-${module.id}`, source: projectId_, target: `module:${module.id}`, label: "contains", confidence: "manual" });

    const cluster = clusters.get(owner) ?? {
      owner, fill: palette.fill, fillSoft: palette.fillSoft, stroke: palette.stroke, text: palette.text,
      moduleIds: [], commitIds: [], moduleNames: []
    };
    cluster.moduleIds.push(`module:${module.id}`);
    cluster.moduleNames.push(module.name);
    clusters.set(owner, cluster);

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
  }

  const commitRows = queryAll<{
    id: number; sha: string; shortSha: string; subject: string; message: string; authorLogin: string | null;
    authorName: string | null; committedAt: string | null; branch: string | null; url: string | null;
    additions: number; deletions: number; changedFiles: number; pullNumber: number | null; pullTitle: string | null;
    severity: string | null; conflict: number; analysisJson: string; firstSeenAt: string; filesJson: string;
  }>(
    `SELECT id, sha, short_sha AS shortSha, subject, message, author_login AS authorLogin, author_name AS authorName,
            committed_at AS committedAt, branch, url, additions, deletions, changed_files AS changedFiles,
            pull_number AS pullNumber, pull_title AS pullTitle, severity, conflict, analysis_json AS analysisJson,
            first_seen_at AS firstSeenAt, files_json AS filesJson
     FROM commits WHERE project_id = ? ORDER BY COALESCE(committed_at, first_seen_at) DESC, id DESC LIMIT ?`,
    [projectId, limit]
  );

  let unattributed = 0;
  const pullNodes = new Map<number, { id: string; title: string; commitIds: string[] }>();

  for (const row of commitRows) {
    const analysis = parseJson<{
      summary?: string; kind?: string; kindLabel?: string; scope?: string | null; issueRefs?: string[];
      affectedModules?: RepoCommitMeta["affectedModules"]; conflict?: boolean; areas?: string[];
    }>(row.analysisJson, {});
    const ageHours = ageInHours(row.committedAt ?? row.firstSeenAt);
    const arrivedMinutes = minutesSince(row.firstSeenAt);
    const author = row.authorLogin || row.authorName || "unknown";
    const authorId = `author:${author}`;
    const affectedModules = analysis.affectedModules ?? [];

    const meta: RepoCommitMeta = {
      sha: row.sha,
      shortSha: row.shortSha,
      subject: row.subject,
      summary: analysis.summary ?? row.subject,
      kind: analysis.kind ?? "change",
      kindLabel: analysis.kindLabel ?? "变更",
      scope: analysis.scope ?? null,
      issueRefs: analysis.issueRefs ?? [],
      author,
      authorLogin: row.authorLogin,
      committedAt: row.committedAt,
      receivedAt: row.firstSeenAt,
      ageHours,
      isNew: ageHours !== null && ageHours <= NEW_COMMIT_WINDOW_HOURS,
      justArrived: arrivedMinutes !== null && arrivedMinutes <= JUST_ARRIVED_MINUTES,
      branch: row.branch,
      url: row.url,
      additions: row.additions,
      deletions: row.deletions,
      changedFiles: row.changedFiles,
      areas: analysis.areas ?? [],
      severity: (row.severity as Severity | null) ?? null,
      conflict: Boolean(row.conflict),
      pullNumber: row.pullNumber,
      pullTitle: row.pullTitle,
      affectedModules,
      files: parseJson<Array<{ path: string; additions?: number; deletions?: number }>>(row.filesJson, [])
    };

    nodes.set(`commit:${row.sha}`, {
      id: `commit:${row.sha}`,
      label: row.shortSha,
      type: "commit",
      meta: meta as unknown as Record<string, unknown>
    });

    if (!nodes.has(authorId)) {
      nodes.set(authorId, { id: authorId, label: author, type: "author", meta: { commits: 0 } });
    }
    const authorNode = nodes.get(authorId)!;
    authorNode.meta = { ...authorNode.meta, commits: Number(authorNode.meta?.commits ?? 0) + 1 };
    edges.push({ id: `authored-${row.sha}`, source: authorId, target: `commit:${row.sha}`, label: "authored", confidence: "history" });

    const attributedOwners = new Set<string>();
    for (const [index, affected] of affectedModules.entries()) {
      if (!affected.id || !nodes.has(`module:${affected.id}`)) continue;
      edges.push({
        id: `commit-module-${row.sha}-${index}`,
        source: `commit:${row.sha}`,
        target: `module:${affected.id}`,
        label: affected.severity,
        confidence: "inferred"
      });
      const owner = moduleOwner.get(affected.id);
      if (owner) attributedOwners.add(owner);
    }
    if (attributedOwners.size === 0) {
      unattributed += 1;
      if (projectId_) edges.push({ id: `commit-project-${row.sha}`, source: projectId_, target: `commit:${row.sha}`, label: "unattributed", confidence: "inferred" });
    }
    for (const owner of attributedOwners) {
      const cluster = clusters.get(owner);
      if (cluster) cluster.commitIds.push(`commit:${row.sha}`);
    }

    if (row.pullNumber) {
      const pullId = `pull:${row.pullNumber}`;
      const pull = pullNodes.get(row.pullNumber) ?? { id: pullId, title: row.pullTitle ?? `PR !${row.pullNumber}`, commitIds: [] };
      pull.commitIds.push(`commit:${row.sha}`);
      pullNodes.set(row.pullNumber, pull);
      edges.push({ id: `pull-commit-${row.sha}`, source: pullId, target: `commit:${row.sha}`, label: "contains", confidence: "history" });
    }
    commitIdsByOwner.set(authorId, [...(commitIdsByOwner.get(authorId) ?? []), `commit:${row.sha}`]);
  }

  for (const pull of pullNodes.values()) {
    nodes.set(pull.id, { id: pull.id, label: `!${pull.id.split(":")[1]}`, type: "pull", meta: { title: pull.title, commits: pull.commitIds.length } });
    if (projectId_) edges.push({ id: `project-${pull.id}`, source: projectId_, target: pull.id, label: "pull", confidence: "history" });
  }

  const stats = commitStatsForGraph(projectId, commitRows.length, unattributed);

  return { nodes: [...nodes.values()], edges, clusters: [...clusters.values()], stats };
}

function commitStatsForGraph(projectId: number, shown: number, unattributed: number): RepoGraphStats {
  const totals = queryOne<{ total: number; conflicts: number; authors: number; latest: string | null }>(
    `SELECT COUNT(*) AS total, SUM(conflict) AS conflicts,
            COUNT(DISTINCT COALESCE(author_login, author_name)) AS authors,
            MAX(COALESCE(committed_at, first_seen_at)) AS latest
     FROM commits WHERE project_id = ?`,
    [projectId]
  );
  const last24h = queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM commits WHERE project_id = ?
       AND COALESCE(committed_at, first_seen_at) >= datetime('now', '-24 hours')`,
    [projectId]
  );
  const delivery = queryOne<{ createdAt: string; status: string }>(
    `SELECT created_at AS createdAt, status FROM webhook_deliveries ORDER BY id DESC LIMIT 1`
  );
  const modulesWithoutPaths = queryAll<{ pathsJson: string; name: string; moduleKey: string }>(
    `SELECT paths_json AS pathsJson, name, module_key AS moduleKey FROM modules WHERE project_id = ?`,
    [projectId]
  ).filter((row) => isOperationalModule(row) && parseJson<string[]>(row.pathsJson, []).length === 0).length;

  return {
    totalCommits: totals?.total ?? 0,
    shownCommits: shown,
    conflicts: totals?.conflicts ?? 0,
    authors: totals?.authors ?? 0,
    last24h: last24h?.count ?? 0,
    unattributedCommits: unattributed,
    latestCommitAt: totals?.latest ?? null,
    lastDeliveryAt: delivery?.createdAt ?? null,
    lastDeliveryStatus: delivery?.status ?? null,
    modulesWithoutPaths,
    generatedAt: new Date().toISOString()
  };
}
