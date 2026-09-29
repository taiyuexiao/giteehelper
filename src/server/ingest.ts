import { config } from "./config.js";
import { queryOne } from "./db.js";
import { extractPushCommits, fetchPullRequestCommits, fetchPullRequestFiles, normalizeGiteeEvent, pickHeadCommit } from "./gitee.js";
import { persistEventAndImpacts, type EventInput } from "./impact.js";
import { createIntegrationRun } from "./integration.js";
import {
  CONFLICT_SEVERITIES, describeImpacts, ingestCommit, recordWebhookDelivery, updateWebhookDelivery
} from "./commits.js";
import { buildCommitImpactCard, sendFeishuText, type CommitLine, type ImpactLine } from "./feishu.js";
import { mineReferences, pullsTouchedBy } from "./pulls.js";
import { queryAll as queryAllRows } from "./db.js";

/** 一次 Push 里最多自动创建多少条联调记录，避免刷屏 */
const MAX_RUNS_PER_PUSH = 5;

export interface IngestResult {
  deliveryId: number;
  eventId: number | null;
  commits: number;
  impacts: number;
  conflicts: number;
  runs: number[];
  notified: boolean;
}

function moduleKeyOf(moduleId: number) {
  return queryOne<{ moduleKey: string }>(`SELECT module_key AS moduleKey FROM modules WHERE id = ?`, [moduleId])?.moduleKey;
}

function isConflict(severity: string) {
  return CONFLICT_SEVERITIES.includes(severity as never);
}

function collectEventFiles(event: EventInput): string[] {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const files = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) files.add(value.trim());
    else if (Array.isArray(value)) value.forEach(add);
  };
  add(payload.files);
  add(payload.paths);
  return [...files];
}

function consoleLink(path: string) {
  return config.publicBaseUrl ? `${config.publicBaseUrl}${path}` : "";
}

/**
 * Gitee WebHook 的完整处理链：统一事件 → 影响分析 → 提交入库 → 联调记录 → 通知。
 *
 * 两个关键点：
 * 1. Push 事件按 commit 粒度归属，保证"谁提交、改了什么、影响了谁"可逐条追溯。
 * 2. PR 事件的回调里**没有变更文件清单**，只能拿标题/正文去猜，长正文会造出大量假影响
 *    （实测一个 docs PR 命中 20 个工作项）。因此这里回查一次真实的文件列表与提交，
 *    改用路径归属，并用提交里的邮箱确定提交者身份（Gitee 账号是多人共用的）。
 */
export async function ingestGiteeWebhook(
  payload: Record<string, unknown>,
  headerEvent: string | undefined,
  hookName?: string | null
): Promise<IngestResult> {
  const event = normalizeGiteeEvent(payload, headerEvent);
  const deliveryId = recordWebhookDelivery({
    hookName: hookName ?? (payload.hook_name as string | undefined) ?? null,
    eventType: event.eventType,
    action: event.action,
    status: "processing",
    detail: "已接收，正在分析",
    payload: { title: event.title, author: event.author, branch: event.branch }
  });

  const runs: number[] = [];
  let impacts = 0;
  let conflicts = 0;
  let commits = 0;
  let eventId: number | null = null;
  let notified = false;

  try {
    await enrichPullRequest(event, payload);

    const pushed = event.eventType === "push" ? extractPushCommits(payload, config.giteeRepo) : [];

    if (pushed.length > 0) {
      const lines: ImpactLine[] = [];
      const commitLines: CommitLine[] = [];
      const conflictedModules = new Set<number>();

      for (const commit of pushed) {
        const result = ingestCommit(commit);
        if (!result.created) continue;
        commits += 1;
        impacts += result.impacts.length;
        eventId ??= result.eventId;
        const analysis = result.analysis;
        if (!analysis) continue;
        const conflictImpacts = analysis.affectedModules.filter((module) => isConflict(module.severity));
        conflicts += conflictImpacts.length;
        for (const module of conflictImpacts) if (module.id) conflictedModules.add(module.id);
        lines.push(...analysis.affectedModules.map((module) => ({
          moduleName: module.name,
          owner: module.owner,
          severity: module.severity,
          reasonLabel: module.reasonLabel ?? null,
          reasonNature: module.reasonNature ?? null,
          reasonAction: module.reasonAction ?? null
        })));
        const sender = (payload.sender ?? {}) as Record<string, unknown>;
        commitLines.push({
          shortSha: commit.sha.slice(0, 8),
          summary: analysis.summary,
          authorName: commit.authorName ?? commit.authorLogin ?? "未知",
          authorEmail: commit.authorEmail ?? null,
          url: commit.url ?? null,
          branch: commit.branch ?? null,
          committedAt: commit.committedAt ?? null,
          linkCount: analysis.affectedModules.length,
          // 推送账号与代码作者分开：账号可能被多人共用，作者才是写代码的人
          actorLogin: typeof sender.login === "string" ? sender.login : null,
          actorName: typeof sender.name === "string" ? sender.name : null
        });
      }

      for (const moduleId of [...conflictedModules].slice(0, MAX_RUNS_PER_PUSH)) {
        const moduleKey = moduleKeyOf(moduleId);
        if (moduleKey) runs.push((await createIntegrationRun(moduleKey, eventId)).id);
      }

      // 主干前进会影响在飞 PR：这是该团队反复人工做的事（「进 main 前的合并同步」）
      const pushedFiles = pushed.flatMap((commit) => (commit.files ?? []).map((file) => file.path));
      const onMain = pushed.some((commit) => /^(main|master)$/.test(commit.branch ?? ""));
      const affectedPulls = onMain && pushedFiles.length ? pullsTouchedBy(pushedFiles) : [];

      // 每一次推送都广播：群里能持续看到"谁提交了什么、影响了谁"
      if (commitLines.length > 0) {
        await sendFeishuText(buildCommitImpactCard(commitLines, lines, {
          baseUrl: config.publicBaseUrl,
          affectedPulls
        }));
        notified = true;
      }
      updateWebhookDelivery(deliveryId, {
        status: "processed",
        detail: `新提交 ${commits} 个，影响 ${lines.length} 项，冲突 ${conflicts} 项${affectedPulls.length ? `，影响 ${affectedPulls.length} 个在飞 PR` : ""}`,
        eventId, commits, impacts, conflicts
      });
      return { deliveryId, eventId, commits, impacts, conflicts, runs, notified };
    }

    const pullNumber = Number(payload.number ?? payload.iid ?? (payload.pull_request as Record<string, unknown> | undefined)?.number ?? 0);
    const pullRow = event.eventType === "pull_request" && pullNumber
      ? queryOne<{ baseRef: string | null; headRef: string | null; number: number }>(
        `SELECT number, base_ref AS baseRef, head_ref AS headRef FROM pull_requests WHERE project_id = 1 AND number = ?`,
        [pullNumber]
      )
      : undefined;

    // 这次改动与哪些在飞 PR 撞了同一批文件（返工成本落在后合入者）
    const eventFiles = collectEventFiles(event);
    const parallelPulls = eventFiles.length
      ? pullsTouchedBy(eventFiles).filter((pull) => pull.number !== pullNumber)
      : [];

    // 引用了哪些尚未合入主干的 PR —— 它们的说法不能当作已生效的事实
    const mergedNumbers = new Set(queryAllRows<{ number: number }>(
      `SELECT number FROM pull_requests WHERE project_id = 1 AND merged_at IS NOT NULL`
    ).map((row) => row.number));
    const unmergedReferences = mineReferences(`${event.title}\n${String(payload.body ?? "")}`)
      .filter((number) => !mergedNumbers.has(number))
      .slice(0, 5);

    const persisted = persistEventAndImpacts(event, 1, {
      pull: pullRow
        ? {
          number: pullRow.number,
          base: pullRow.baseRef ?? "main",
          head: pullRow.headRef ?? "",
          headChanged: /update|synchronize|reopen/i.test(event.action)
        }
        : null,
      parallelPulls,
      unmergedReferences
    });
    eventId = persisted.eventId;
    impacts = persisted.impacts.length;
    conflicts = persisted.impacts.filter((impact) => isConflict(impact.severity)).length;
    for (const impact of persisted.impacts) {
      if (!impact.moduleId) continue;
      const moduleKey = moduleKeyOf(impact.moduleId);
      if (moduleKey) runs.push((await createIntegrationRun(moduleKey, eventId)).id);
    }

    if (persisted.impacts.length) {
      // 所有事件类型统一用"按人分组"的格式；PR 的提交者取该 PR 最新提交的邮箱
      const head = (event.payload?.pullHead as CommitLine | undefined) ?? {
        shortSha: "",
        summary: event.title,
        authorName: event.author,
        authorEmail: null,
        url: event.url ?? null,
        branch: event.branch ?? null,
        committedAt: null,
        linkCount: persisted.impacts.length
      };
      await sendFeishuText(buildCommitImpactCard([head], describeImpacts(persisted.impacts), { baseUrl: config.publicBaseUrl }));
      notified = true;
    }

    updateWebhookDelivery(deliveryId, {
      status: "processed",
      detail: persisted.impacts.length ? `影响 ${persisted.impacts.length} 项` : "已记录，无需下游动作",
      eventId, commits: 0, impacts, conflicts
    });
    return { deliveryId, eventId, commits, impacts, conflicts, runs, notified };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateWebhookDelivery(deliveryId, { status: "error", detail: message.slice(0, 300) });
    throw error;
  }
}

/**
 * PR 事件补齐两样东西：
 * - 真实变更文件 → 用路径归属模块，而不是拿正文猜
 * - 该 PR 的提交 → 拿到提交者邮箱（共用账号时唯一可靠的身份）
 * 任何一步失败都不阻断主流程，只是退回原来的语义匹配。
 */
async function enrichPullRequest(event: EventInput, payload: Record<string, unknown>) {
  if (event.eventType !== "pull_request" || !config.giteeRepo) return;
  const pull = (payload.pull_request ?? {}) as Record<string, unknown>;
  const number = payload.number ?? payload.iid ?? pull.number ?? pull.id;
  if (number === undefined) return;

  const files = await fetchPullRequestFiles(config.giteeRepo, number as never).catch(() => [] as string[]);
  if (files.length) event.payload = { ...(event.payload ?? {}), files };

  const commits = await fetchPullRequestCommits(config.giteeRepo, number as never).catch(() => []);
  // 用 PR 的 head sha 定位这次真正推进的提交；列表是新提交在前且会分页，不能按位置取
  const headSha = typeof (pull.head as Record<string, unknown> | undefined)?.sha === "string"
    ? String((pull.head as Record<string, unknown>).sha)
    : null;
  const latest = pickHeadCommit(commits, headSha);
  const headRef = (pull.head as Record<string, unknown> | undefined)?.ref;
  const sender = (payload.sender ?? {}) as Record<string, unknown>;
  const pullAuthor = (payload.author ?? {}) as Record<string, unknown>;
  const projectAuthorName = typeof pullAuthor.name === "string" ? pullAuthor.name : null;
  const projectAuthorLogin = typeof pullAuthor.login === "string" ? pullAuthor.login : null;
  if (latest) {
    event.payload = {
      ...(event.payload ?? {}),
      pullHead: {
        shortSha: latest.sha.slice(0, 8),
        summary: latest.message.split("\n")[0] || event.title,
        authorName: latest.name ?? event.author,
        authorEmail: latest.email,
        url: event.url ?? null,
        // PR 的目标分支是 main，但这次推送落在源分支上，写 main 会让人以为直接推了主干
        branch: typeof headRef === "string" && headRef ? headRef : event.branch ?? null,
        committedAt: latest.date,
        // Gitee 账号常常是共用的：账号是谁、代码是谁写的、PR 是谁开的，必须分开说
        actorLogin: typeof sender.login === "string" ? sender.login : null,
        actorName: typeof sender.name === "string" ? sender.name : null,
        pullAuthorName: projectAuthorName,
        pullAuthorLogin: projectAuthorLogin,
        linkCount: 0
      } satisfies CommitLine
    };
  }
}
