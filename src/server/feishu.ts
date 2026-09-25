import { config } from "./config.js";
import { audit } from "./db.js";

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

export function buildImpactCard(eventTitle: string, impacts: Array<{ reason: string; nextAction: string; severity: string }>) {
  return [
    `【GiteeHelper】${eventTitle}`,
    ...impacts.map((impact, index) => `${index + 1}. [${impact.severity}] ${impact.reason}\n   下一步：${impact.nextAction}`),
    "详情请打开 GiteeHelper 控制台查看证据链。"
  ].join("\n");
}
