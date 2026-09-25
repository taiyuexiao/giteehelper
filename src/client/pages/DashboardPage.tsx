import { useEffect, useState } from "react";
import { Activity, AlertOctagon, ArrowRight, Boxes, GitPullRequest, MessageSquareWarning, Wrench } from "lucide-react";
import { api } from "../api";
import { EmptyState, Loading, PageHeader, SeverityBadge, StatusBadge } from "../components";
import type { DashboardData, Impact } from "../../shared/types";

type ActionItem = Impact & { moduleName?: string; ownerName?: string; eventTitle?: string; eventUrl?: string };

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(0);

  const load = () => api<DashboardData>("/dashboard").then(setData).catch((reason) => setError(String(reason)));
  useEffect(() => { void load(); }, []);

  async function makeRepair(impactId: number) {
    setBusy(impactId);
    try {
      await api("/repairs", { method: "POST", body: JSON.stringify({ impactId }) });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(0);
    }
  }

  if (!data) return <Loading />;

  return (
    <>
      <PageHeader
        title="待处理"
        description="优先处理阻塞项、契约冲突和需要个人确认的影响。"
        actions={<button className="secondary-button" onClick={() => void load()}><Activity size={16} />刷新</button>}
      />
      {error && <div className="alert">{error}</div>}

      <section className="metric-grid">
        <article className="metric"><span>开放影响</span><strong>{data.stats.openImpacts}</strong><MessageSquareWarning size={19} /></article>
        <article className="metric metric-danger"><span>阻塞影响</span><strong>{data.stats.blockingImpacts}</strong><AlertOctagon size={19} /></article>
        <article className="metric"><span>活跃模块</span><strong>{data.stats.activeModules}</strong><Boxes size={19} /></article>
        <article className="metric"><span>待处理修复</span><strong>{data.stats.pendingRepairs}</strong><Wrench size={19} /></article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div><h2>影响与行动</h2><p>每条结论均包含来源证据和下一步。</p></div>
        </div>
        {data.actions.length === 0 ? (
          <EmptyState icon={<AlertOctagon size={25} />} title="当前没有待处理影响" text="新的 Gitee 变化完成分析后会出现在这里。" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>严重度</th><th>影响对象</th><th>原因与下一步</th><th>负责人</th><th>操作</th></tr></thead>
              <tbody>
                {data.actions.map((impact: ActionItem) => (
                  <tr key={impact.id}>
                    <td><SeverityBadge value={impact.severity} /></td>
                    <td><strong>{impact.moduleName ?? "未归属"}</strong><small>{impact.eventTitle}</small></td>
                    <td><div className="cell-main">{impact.reason}</div><small>下一步：{impact.nextAction}</small></td>
                    <td>{impact.ownerName ?? "待确认"}</td>
                    <td><button className="small-button" disabled={busy === impact.id} onClick={() => void makeRepair(impact.id)}><Wrench size={14} />{busy === impact.id ? "生成中" : "生成修复"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="two-column">
        <section className="panel">
          <div className="panel-header"><div><h2>最近变化</h2><p>Gitee 与手动事件。</p></div></div>
          <div className="activity-list">
            {data.recentEvents.map((event) => (
              <article key={event.id}>
                <GitPullRequest size={18} />
                <div><strong>{event.title}</strong><span>{event.author} · {event.eventType}/{event.action} · {event.branch ?? "—"}</span></div>
                <ArrowRight size={15} />
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><div><h2>最近联调</h2><p>真实模块与契约桩的验证结果。</p></div></div>
          <div className="activity-list">
            {data.recentRuns.map((run) => (
              <article key={run.id}>
                <Activity size={18} />
                <div><strong>{run.moduleKey}</strong><span>{run.combination.length} 个组合项</span></div>
                <StatusBadge value={run.status} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
