import { config } from "./config.js";
import { queryOne } from "./db.js";
import { extractPushCommits, normalizeGiteeEvent } from "./gitee.js";
import { persistEventAndImpacts, type EventInput } from "./impact.js";
import { createIntegrationRun } from "./integration.js";
import { CONFLICT_SEVERITIES, ingestCommit, recordWebhookDelivery, updateWebhookDelivery } from "./commits.js";
import { buildCommitConflictCard, buildImpactCard, sendFeishuText, type CommitConflictLine } from "./feishu.js";

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

/**
 * Gitee WebHook 的完整处理链：统一事件 → 影响分析 → 提交入库 → 联调记录 → 冲突通知。
 * 提交类事件按 commit 粒度归属，保证“谁提交、改了什么、影响了谁”可以逐条追溯。
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
    const pushed = event.eventType === "push" ? extractPushCommits(payload, config.giteeRepo) : [];

    if (pushed.length > 0) {
      const createdConflicts: CommitConflictLine[] = [];
      const conflictedModules = new Set<number>();
      for (const commit of pushed) {
        const result = ingestCommit(commit);
        if (!result.created) continue;
        commits += 1;
        impacts += result.impacts.length;
        eventId ??= result.eventId;
        const analysis = result.analysis;
        if (!analysis) continue;
        const conflictImpacts = analysis.affectedModules.filter((module) => CONFLICT_SEVERITIES.includes(module.severity));
        conflicts += conflictImpacts.length;
        if (analysis.conflict) {
          createdConflicts.push({
            sha: commit.sha,
            shortSha: commit.sha.slice(0, 8),
            summary: analysis.summary,
            author: commit.authorLogin || commit.authorName || "unknown",
            url: commit.url,
            conflicts: conflictImpacts.map((module) => ({
              moduleName: module.name,
              severity: module.severity,
              owner: module.owner,
              nextAction: module.nextAction
            }))
          });
          for (const module of conflictImpacts) if (module.id) conflictedModules.add(module.id);
        }
      }

      for (const moduleId of [...conflictedModules].slice(0, MAX_RUNS_PER_PUSH)) {
        const moduleKey = moduleKeyOf(moduleId);
        if (moduleKey) runs.push((await createIntegrationRun(moduleKey, eventId)).id);
      }

      if (createdConflicts.length > 0) {
        const unattributed = createdConflicts.filter((commit) => commit.conflicts.length === 0).length;
        await sendFeishuText(buildCommitConflictCard(event.branch ?? null, createdConflicts, commits, unattributed));
        notified = true;
      }
      updateWebhookDelivery(deliveryId, {
        status: "processed",
        detail: `新提交 ${commits} 个，冲突 ${conflicts} 项`,
        eventId, commits, impacts, conflicts
      });
      return { deliveryId, eventId, commits, impacts, conflicts, runs, notified };
    }

    const persisted = persistEventAndImpacts(event);
    eventId = persisted.eventId;
    impacts = persisted.impacts.length;
    conflicts = persisted.impacts.filter((impact) => CONFLICT_SEVERITIES.includes(impact.severity)).length;
    for (const impact of persisted.impacts) {
      if (!impact.moduleId) continue;
      const moduleKey = moduleKeyOf(impact.moduleId);
      if (moduleKey) runs.push((await createIntegrationRun(moduleKey, eventId)).id);
    }
    if (persisted.impacts.length) {
      await sendFeishuText(buildImpactCard(event.title, persisted.impacts.map((impact) => ({
        reason: impact.reason,
        nextAction: impact.nextAction,
        severity: impact.severity
      }))));
      notified = true;
    }
    updateWebhookDelivery(deliveryId, {
      status: "processed",
      detail: persisted.impacts.length ? `影响 ${impactedModulesLabel(persisted.impacts.length)}` : "已记录，无需下游动作",
      eventId, commits: 0, impacts, conflicts
    });
    return { deliveryId, eventId, commits, impacts, conflicts, runs, notified };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateWebhookDelivery(deliveryId, { status: "error", detail: message.slice(0, 300) });
    throw error;
  }
}

function impactedModulesLabel(count: number) {
  return `${count} 个模块`;
}

export function webhookEventInputFromPayload(payload: Record<string, unknown>, headerEvent?: string): EventInput {
  return normalizeGiteeEvent(payload, headerEvent);
}
