import { config } from "./config.js";
import { audit } from "./db.js";

type ImpactSummary = {
  reason: string;
  nextAction: string;
  severity: string;
};

const severityLabels: Record<string, string> = {
  blocking: "阻塞",
  contract: "契约",
  implementation: "实现",
  clarification: "待澄清",
  informational: "提示"
};

const severityOrder = ["blocking", "contract", "implementation", "clarification", "informational"];

function isOperationalImpact(impact: ImpactSummary) {
  return !impact.reason.includes("[示例]") && !impact.reason.includes("[旧导入]");
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
    return `- ${moduleFromReason(impact.reason)}｜${label}｜${impact.nextAction}`;
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
