import { useEffect, useState } from "react";
import { CheckCircle2, Download, FileDiff, FlaskConical, ShieldCheck, Wrench } from "lucide-react";
import { api } from "../api";
import { EmptyState, PageHeader, StatusBadge } from "../components";

type Repair = {
  id: number; eventId: number; impactId: number; status: string;
  provenance: { source?: string; sourceUrl?: string; generatedAt?: string; approval?: string };
  createdAt: string;
};
type RepairDetail = Repair & { diff: string; testsPatch: string; testReport: Record<string, unknown>; provenance: Record<string, unknown> };

export default function RepairsPage() {
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [selected, setSelected] = useState<RepairDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = () => api<Repair[]>("/repairs").then((data) => {
    setRepairs(data);
    if (data[0]) void api<RepairDetail>(`/repairs/${data[0].id}`).then(setSelected);
  }).catch((reason) => setError(String(reason)));
  useEffect(() => { void load(); }, []);

  async function select(id: number) {
    setSelected(await api<RepairDetail>(`/repairs/${id}`));
  }

  async function action(id: number, kind: "test" | "approve") {
    try {
      await api(`/repairs/${id}/${kind}`, { method: "POST", body: JSON.stringify({}) });
      setMessage(kind === "test" ? "本地测试结果已记录为通过" : "修复包已批准；下一步是创建修复分支和 PR");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <PageHeader title="修复包" description="修复必须先本地测试和 review；批准后也只创建 PR，不直接写入主干。" />
      {error && <div className="alert">{error}</div>}
      {message && <div className="success">{message}</div>}
      <section className="runs-layout">
        <aside className="panel run-list">
          <div className="panel-header"><div><h2>Repair Bundle</h2></div></div>
          {repairs.length === 0 ? <EmptyState icon={<Wrench size={23} />} title="还没有修复包" text="从待处理影响中生成修复建议。" /> : repairs.map((repair) => (
            <button key={repair.id} className={selected?.id === repair.id ? "run-item active" : "run-item"} onClick={() => void select(repair.id)}>
              <div><strong>Repair #{repair.id}</strong><small>Impact #{repair.impactId} · {repair.createdAt}</small></div>
              <StatusBadge value={repair.status} />
            </button>
          ))}
        </aside>
        <article className="panel run-detail">
          {!selected ? <EmptyState icon={<FileDiff size={25} />} title="选择修复包" text="查看 diff、测试补丁、来源证据和审批状态。" /> : (
            <>
              <div className="panel-header">
                <div><h2>Repair Bundle #{selected.id}</h2><p>Source: {selected.provenance.source ?? selected.eventId}</p></div>
                <StatusBadge value={selected.status} />
              </div>
              <div className="repair-actions">
                <a className="secondary-button" href={`/api/repairs/${selected.id}/files/repair.diff`} download><Download size={16} />下载 Diff</a>
                <button className="secondary-button" onClick={() => void action(selected.id, "test")} disabled={selected.status === "approved"}><FlaskConical size={16} />记录本地测试</button>
                <button className="primary-button" onClick={() => void action(selected.id, "approve")} disabled={selected.status !== "tested"}><ShieldCheck size={16} />批准修复</button>
              </div>
              <div className="security-note"><CheckCircle2 size={17} />批准只授权创建修复分支/PR，不授权直接提交主干或自动合并。</div>
              <h3>repair.diff</h3><pre className="code-block">{selected.diff}</pre>
              <h3>tests.patch</h3><pre className="code-block">{selected.testsPatch}</pre>
              <h3>provenance.json</h3><pre className="code-block">{JSON.stringify(selected.provenance, null, 2)}</pre>
            </>
          )}
        </article>
      </section>
    </>
  );
}
