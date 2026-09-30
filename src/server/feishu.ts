import { config } from "./config.js";
import { audit } from "./db.js";

export interface CommitLine {
  shortSha: string;
  summary: string;
  /** 代码作者身份：多人共用一个 Gitee 账号，因此必须以提交里的邮箱为准 */
  authorName: string;
  authorEmail: string | null;
  url: string | null;
  branch: string | null;
  committedAt: string | null;
  linkCount: number;
  /** 这次动作是谁按下的（Gitee 账号）。账号可能是共用的，所以和代码作者分开写 */
  actorLogin?: string | null;
  actorName?: string | null;
  /** PR 事件才有：谁开的这个 PR。与提交作者、推送账号都不同，是找人对齐时的第一联系人 */
  pullAuthorName?: string | null;
  pullAuthorLogin?: string | null;
}

export interface ImpactLine {
  moduleName: string;
  owner: string | null;
  severity: string;
  /** 影响原因（规则判定） */
  reasonLabel?: string | null;
  reasonNature?: string | null;
  reasonAction?: string | null;
  /**
   * 有路径证据 = 确定；只有语义证据 = 线索。
   * 这条区分是通知可信度的底线：靠词面猜出来的影响不能写成结论，
   * 否则收到的人无法判断要不要动手。
   */
  grounded?: boolean;
  /** 命中的具体文件，供收到通知的人复核 */
  evidenceHint?: string | null;
}

export interface AffectedPull {
  number: number;
  title: string;
  author: string | null;
  shared: string[];
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

function shortTime(value: string | null) {
  if (!value) return "未知";
  const stamp = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(stamp)) return value;
  const minutes = Math.round((Date.now() - stamp) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)} 分钟前`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`;
  return `${Math.round(minutes / 1440)} 天前`;
}

/** 首行的事件类型标注：让收到消息的人不用点开就知道这是提交、PR 还是评论 */
const EVENT_KIND_LABELS: Record<string, string> = {
  push: "提交Commit",
  commit: "提交Commit",
  pull_request: "提交PR",
  note: "评论",
  issue: "议题"
};

/**
 * 新提交影响卡片。
 * 格式目标：一眼看出「这次是什么动作、谁提交的、影响了谁、影响他的哪一部分」。
 * - 首行标注事件类型（提交Commit / 提交PR / 评论 / 议题）
 * - 提交者按提交里的邮箱显示（多人共用 Gitee 账号，账号名没有区分度）
 * - 概要为大模型生成（未配置或失败时整行省略，不影响卡片）
 * - 分割线把「这次动作」与「影响清单」隔开；影响项按负责人分组
 */
export function buildCommitImpactCard(
  commits: CommitLine[],
  impacts: ImpactLine[],
  options: { eventType?: string; summary?: string | null; maxPeople?: number; maxItemsPerPerson?: number; affectedPulls?: AffectedPull[] } = {}
) {
  const { eventType = "", summary, maxPeople = 5, maxItemsPerPerson = 4, affectedPulls = [] } = options;
  // 只有"有路径证据"的契约/阻塞级才算需要确认的冲突。
  // 线索本来就没坐实，再挂 ⚠ 会把整张卡片变成噪音（实测一次评分 PR 有 12 条线索一起报警）。
  const isConflict = (item: ImpactLine) =>
    (item.severity === "blocking" || item.severity === "contract") && item.grounded !== false;
  const conflicts = impacts.filter(isConflict);
  const grouped = new Map<string, { owner: string; items: ImpactLine[]; conflicts: number }>();
  for (const item of impacts) {
    const owner = item.owner?.trim() || "未分配负责人";
    const group = grouped.get(owner) ?? { owner, items: [], conflicts: 0 };
    if (!group.items.some((existing) => existing.moduleName === item.moduleName)) group.items.push(item);
    if (isConflict(item)) group.conflicts += 1;
    grouped.set(owner, group);
  }
  const people = [...grouped.values()].sort((a, b) => b.conflicts - a.conflicts || b.items.length - a.items.length);

  const kind = eventType ? (EVENT_KIND_LABELS[eventType] ?? "其他") : undefined;
  const lines: string[] = [`【GiteeHelper】新提交影响${kind ? ` - 「${kind}」` : ""}`];
  const head = commits[0];
  if (head) {
    // 代码作者与操作用户是两件事：一个 Gitee 账号可能被多人共用，
    // 只写账号会让人以为"是他提交的"，只写作者又追不到是谁推的。
    const who = head.authorEmail ? `${head.authorName} <${head.authorEmail}>` : head.authorName;
    lines.push(`提交作者：${who}`);
    const actor = head.actorLogin ? `${head.actorName ? `${head.actorName} / ` : ""}${head.actorLogin}（Gitee 账号）` : null;
    if (actor) lines.push(`推送账号：${actor}`);
    // PR 作者往往既不是提交作者也不是推送账号，对齐时要找的是他
    if (head.pullAuthorName && head.pullAuthorName !== head.authorName) {
      lines.push(`PR 作者：${head.pullAuthorName}${head.pullAuthorLogin ? `（${head.pullAuthorLogin}）` : ""}`);
    }
    lines.push(`内容：${head.summary}`);
    if (head.url) lines.push(`链接：${head.url}`);
    lines.push(`分支 ${head.branch || "未知"} ｜ ${shortTime(head.committedAt)}`);
    if (summary) lines.push(`概要：${summary}`);
    if (commits.length > 1) lines.push(`本次推送共 ${commits.length} 个提交，以下为第 1 个，其余见控制台。`);
  }

  lines.push("-------");
  if (people.length === 0) {
    lines.push("影响：没有命中他人负责的模块。");
  } else {
    const total = people.reduce((sum, person) => sum + person.items.length, 0);
    const grounded = impacts.filter((item) => item.grounded === true).length;
    const leads = impacts.length - grounded;
    lines.push(`影响 ${people.length} 人 · ${total} 个工作项${conflicts.length ? `（其中 ${conflicts.length} 项为契约/阻塞级）` : ""}`);
    lines.push(`依据：${grounded} 项有文件路径证据（确定）${leads ? `，${leads} 项仅语义匹配（线索，请人工判断）` : ""}`);
    for (const person of people.slice(0, maxPeople)) {
      lines.push(`▸ ${person.owner}${person.conflicts ? " ⚠ 需确认" : ""}`);
      for (const item of person.items.slice(0, maxItemsPerPerson)) {
        lines.push(`   · ${item.moduleName}${item.grounded === false ? "（线索）" : ""}`);
        // 影响原因要写清楚"为什么"，否则收到的人只知道被点名、不知道要做什么
        if (item.reasonLabel) {
          lines.push(`     原因：${item.reasonLabel}${item.reasonAction ? ` → ${item.reasonAction}` : ""}`);
        }
        if (item.evidenceHint) lines.push(`     依据：${item.evidenceHint}`);
      }
      if (person.items.length > maxItemsPerPerson) lines.push(`   · 其余 ${person.items.length - maxItemsPerPerson} 项见控制台`);
    }
    if (people.length > maxPeople) lines.push(`其余 ${people.length - maxPeople} 人见控制台。`);
    if (conflicts.length) {
      const owners = [...new Set(conflicts.map((item) => item.owner?.trim() || "未分配负责人"))];
      lines.push(`⚠ 契约/阻塞级影响涉及：${owners.slice(0, 4).join("、")}${owners.length > 4 ? " 等" : ""}`);
    }
  }
  if (affectedPulls.length) {
    lines.push("");
    lines.push(`⚠ 主干这次前进会影响 ${affectedPulls.length} 个在飞 PR：`);
    for (const pull of affectedPulls.slice(0, 4)) {
      lines.push(`   · !${pull.number} ${pull.title.slice(0, 30)}${pull.author ? `（${pull.author}）` : ""} —— 共同改动 ${pull.shared.length} 个文件`);
    }
    if (affectedPulls.length > 4) lines.push(`   其余 ${affectedPulls.length - 4} 个见控制台`);
    lines.push("   这些 PR 需要合并同步后重跑门禁。");
  }
  const text = lines.join("\n");
  return text.length > 1400 ? `${text.slice(0, 1380)}…` : text;
}
