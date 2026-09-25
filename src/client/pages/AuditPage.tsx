import { useEffect, useState } from "react";
import { Filter, History, Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, Loading, PageHeader } from "../components";

type AuditRow = { id: number; actor: string; action: string; resourceType: string; resourceId: string; detail: Record<string, unknown>; createdAt: string };

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [error, setError] = useState("");
  const load = () => api<AuditRow[]>(`/audit?action=${encodeURIComponent(action)}&resource=${encodeURIComponent(resource)}`).then(setRows).catch((reason) => setError(String(reason)));
  useEffect(() => { void load(); }, [action, resource]);
  if (!rows) return <Loading />;

  return (
    <>
      <PageHeader title="审计中心" description="追踪事件、配置、通知、联调和修复审批等关键操作。" />
      {error && <div className="alert">{error}</div>}
      <section className="filter-bar panel">
        <Search size={17} />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="按动作筛选，例如 rule_update" />
        <Filter size={17} />
        <select value={resource} onChange={(e) => setResource(e.target.value)}>
          <option value="">全部资源</option><option value="user">用户</option><option value="module">模块</option><option value="rule">规则</option>
          <option value="change_event">事件</option><option value="integration_run">联调</option><option value="repair_bundle">修复</option>
        </select>
      </section>
      <section className="panel">
        {rows.length === 0 ? <EmptyState icon={<History size={25} />} title="没有匹配记录" text="调整筛选条件后重试。" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>资源</th><th>详情</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><small>{row.createdAt}</small></td><td>{row.actor}</td><td><code>{row.action}</code></td>
                    <td>{row.resourceType} #{row.resourceId}</td><td><code className="detail-code">{JSON.stringify(row.detail)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
