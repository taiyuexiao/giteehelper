import { config } from "./config.js";
import { audit } from "./db.js";

type ImpactSummary = {
  reason: string;
  nextAction: string;
  severity: string;
  owner?: string | null;
  moduleName?: string | null;
};

export interface CommitConflictLine {
  sha: string;
  shortSha: string;
  summary: string;
  author: string;
  url?: string | null;
  conflicts: Array<{ moduleName: string; severity: string; owner?: string | null; nextAction: string }>;
}

const severityLabels: Record<string, string> = {
  blocking: "阻塞",
  contract: "契约",
  implementation: "实现",
  clarification: "待澄清",
  informational: "提示"
};

const severityOrder = ["blocking", "contract", "implementation", "clarification", "informational"];

function isOperationalImpact(impact: ImpactSummary) {
  const text = `${impact.reason}${impact.moduleName ?? ""}`;
  return !text.includes("[示例]") && !text.includes("[旧导入]");
}

function moduleFromReason(reason: string) {
  const match = reason.match(/影响模块「([^」]+)」/);
  return match?.[1] ?? (reason.includes("全局影响") ? "全局影响" : "未归属影响");
}

export async function sendFeishuText(text: string, target = config.feishuWebhookUrl) {
  if (!target) {
    audit(null, "system", "feishu_dry_run", "notification", "feishu", { text });
    return { ok: true, dryRun: true, text };
  }
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "text", content: { text } })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Feishu ${response.status}: ${body.slice(0, 300)}`);
  audit(null, "system", "feishu_send", "notification", "feishu", { ok: true });
  return { ok: true, dryRun: false };
}

export function buildImpactCard(eventTitle: string, impacts: ImpactSummary[]) {
  const visible = impacts.filter(isOperationalImpact);
  const counts = severityOrder
    .map((severity) => ({ severity, count: visible.filter((impact) => impact.severity === severity).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${severityLabels[item.severity] ?? item.severity} ${item.count}`)
    .join(" · ");
  const preview = visible.slice(0, 6).map((impact) => {
    const label = severityLabels[impact.severity] ?? impact.severity;
    const owner = impact.owner ? `｜负责人 ${impact.owner}` : "";
    return `- ${impact.moduleName ?? moduleFromReason(impact.reason)}｜${label}${owner}｜${impact.nextAction}`;
  });
  const omitted = Math.max(0, visible.length - preview.length);
  return [
    "【GiteeHelper】影响提示",
    `变更：${eventTitle}`,
    `影响：${visible.length} 项${counts ? `（${counts}）` : ""}`,
    ...preview,
    ...(omitted > 0 ? [`其余 ${omitted} 项已合并，请在 GiteeHelper 控制台查看证据链。`] : []),
    "详情：GiteeHelper 控制台"
  ].join("\n");
}

/**
 * 新提交的冲突提醒：只列出真正需要下游动作的模块和它的负责人，
 * 保证「谁需要处理」在飞书里一眼可见。
 */
export function buildCommitConflictCard(branch: string | null, commits: CommitConflictLine[], totalCommits: number, unattributed: number) {
  const conflictCount = commits.reduce((total, commit) => total + commit.conflicts.length, 0);
  const lines: string[] = [
    "【GiteeHelper】新提交冲突提醒",
    `分支：${branch || "未知"} · 新提交 ${totalCommits} 个 · 冲突 ${conflictCount} 项`
  ];
  for (const commit of commits.slice(0, 3)) {
    lines.push(`${commit.shortSha}｜${commit.summary}｜${commit.author}`);
    for (const conflict of commit.conflicts.slice(0, 2)) {
      const label = severityLabels[conflict.severity] ?? conflict.severity;
      const owner = conflict.owner ? `｜负责人 ${conflict.owner}` : "｜负责人待确认";
      lines.push(`　· ${conflict.moduleName}｜${label}${owner} → ${conflict.nextAction}`);
    }
  }
  if (commits.length > 3) lines.push(`其余 ${commits.length - 3} 个冲突提交请在控制台查看。`);
  if (unattributed > 0) lines.push(`${unattributed} 个提交未归属模块，请补充模块路径模式。`);
  lines.push("详情：GiteeHelper 控制台 · 仓库全景");
  const text = lines.join("\n");
  return text.length > 1200 ? `${text.slice(0, 1180)}…` : text;
}
