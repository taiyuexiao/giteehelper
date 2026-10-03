/**
 * 时间线：把提交、PR 开合、评论统一成一条事件流，供「进度 → 时间线」可视化。
 *
 * 事件类型：push（提交）/ pr_open / pr_merged / pr_closed / comment（评论·评审）
 * 身份口径与人员指标一致：提交作者看署名邮箱（登录账号共用不可用）；
 * 评论作者看 Gitee 用户名经别名表解析。
 */
import { parseJson, queryAll } from "./db.js";
import { buildUserIndex, toStamp } from "./progress.js";

export type TimelineEventType = "push" | "pr_open" | "pr_merged" | "pr_closed" | "comment";

export interface TimelineEvent {
  /** epoch ms（服务器按 UTC 解析后折算，客户端直接用于定位） */
  ts: number;
  at: string | null;
  type: TimelineEventType;
  actorId: number | null;
  /** 解析后的成员名；对不上身份时为原始署名 */
  actor: string;
  title: string;
  detail: string | null;
  url: string | null;
  number: number | null;
  sha: string | null;
}

function firstLine(text: string, limit = 160) {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, limit) || null;
}

export function buildTimeline(projectId = 1): TimelineEvent[] {
  const index = buildUserIndex(projectId);
  const events: TimelineEvent[] = [];
  const seen = new Set<string>();

  const resolve = (login: string | null, name: string | null, email: string | null) => {
    const userId = index.resolveCommit(login, name, email);
    return {
      actorId: userId,
      actor: (userId ? index.nameOf(userId) : null) ?? name ?? login ?? "未知"
    };
  };

  // 提交：时间取 committed_at（回落到入库时间），作者按署名邮箱解析
  for (const row of queryAll<{
    sha: string; subject: string; message: string; authorLogin: string | null;
    authorName: string | null; authorEmail: string | null; committedAt: string | null;
    firstSeenAt: string; branch: string | null; url: string | null; changedFiles: number;
    additions: number; deletions: number;
  }>(
    `SELECT sha, subject, message, author_login AS authorLogin, author_name AS authorName, author_email AS authorEmail,
            committed_at AS committedAt, first_seen_at AS firstSeenAt, branch, url, changed_files AS changedFiles,
            additions, deletions
     FROM commits WHERE project_id = ?`, [projectId]
  )) {
    const ts = toStamp(row.committedAt) || toStamp(row.firstSeenAt);
    if (!ts) continue;
    const who = resolve(row.authorLogin, row.authorName, row.authorEmail);
    events.push({
      ts,
      at: row.committedAt ?? row.firstSeenAt,
      type: "push",
      ...who,
      title: row.subject || row.message.split("\n")[0] || "(无标题提交)",
      detail: firstLine(`${row.message.split("\n").slice(1).join(" ").trim()} ${row.branch ? `| 分支 ${row.branch}` : ""}`),
      url: row.url,
      number: null,
      sha: row.sha.slice(0, 8)
    });
  }

  // PR：开启 / 合并 / 关闭未合 三个时间点
  for (const row of queryAll<{
    number: number; title: string; state: string; url: string | null;
    createdAt: string | null; mergedAt: string | null; updatedAt: string | null;
    authorsJson: string; additions: number; deletions: number;
  }>(
    `SELECT number, title, state, null AS url, created_at AS createdAt, merged_at AS mergedAt,
            updated_at AS updatedAt, authors_json AS authorsJson, additions, deletions
     FROM pull_requests WHERE project_id = ?`, [projectId]
  )) {
    const authors = parseJson<Array<{ name: string | null; email: string | null }>>(row.authorsJson, []);
    const first = authors[0] ?? null;
    const who = resolve(null, first?.name ?? null, first?.email ?? null);
    const base = {
      title: row.title,
      detail: `+${row.additions}/-${row.deletions}${authors.length > 1 ? ` · ${authors.length} 位作者` : ""}`,
      url: row.url,
      number: row.number,
      sha: null
    };
    const openTs = toStamp(row.createdAt);
    if (openTs) {
      events.push({ ts: openTs, at: row.createdAt, type: "pr_open", ...who, ...base });
    }
    const mergedTs = toStamp(row.mergedAt);
    if (mergedTs) {
      events.push({ ts: mergedTs, at: row.mergedAt, type: "pr_merged", ...who, ...base });
    } else if (row.state === "closed") {
      const closedTs = toStamp(row.updatedAt) || openTs;
      if (closedTs) events.push({ ts: closedTs, at: row.updatedAt, type: "pr_closed", ...who, ...base });
    }
  }

  // 评论/评审：(number, remoteId) 跨 source 去重（webhook 与回填可能各存一份）
  for (const row of queryAll<{
    pullNumber: number; remoteId: number | null; body: string;
    authorLogin: string | null; authorName: string | null; createdAt: string | null; url: string | null;
  }>(
    `SELECT pull_number AS pullNumber, remote_id AS remoteId, body,
            author_login AS authorLogin, author_name AS authorName, created_at AS createdAt, url
     FROM pull_comments WHERE project_id = ?`, [projectId]
  )) {
    const ts = toStamp(row.createdAt);
    if (!ts) continue;
    const key = `comment:${row.pullNumber}:${row.remoteId ?? `${ts}:${(row.body ?? "").slice(0, 40)}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const who = resolve(row.authorLogin, row.authorName, null);
    events.push({
      ts,
      at: row.createdAt,
      type: "comment",
      ...who,
      title: `!${row.pullNumber} 评论`,
      detail: firstLine(row.body),
      url: row.url,
      number: row.pullNumber,
      sha: null
    });
  }

  return events.sort((a, b) => b.ts - a.ts);
}
