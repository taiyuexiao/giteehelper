import { useEffect, useState } from "react";
import { CheckCircle2, Download, FileDiff, FlaskConical, GitPullRequest, ShieldCheck, Wrench } from "lucide-react";
import { api, downloadFile } from "../api";
import { EmptyState, Loading, PageHeader, StatusBadge } from "../components";
import type { Role } from "../../shared/types";

type Repair = {
  id: number; eventId: number; impactId: number; status: string;
  provenance: { source?: string; sourceUrl?: string; generatedAt?: string; approval?: string };
  createdAt: string;
};
type RepairDetail = Repair & { diff: string; testsPatch: string; testReport: Record<string, unknown>; provenance: Record<string, unknown> };

const PR_ROLES: Role[] = ["admin", "maintainer", "reviewer"];

export default function RepairsPage({ user }: { user: { role: Role } }) {
  const [repairs, setRepairs] = useState<Repair[] | null>(null);
  const [selected, setSelected] = useState<RepairDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [branchName, setBranchName] = useState("");

  const load = async (keepId?: number) => {
    try {
      const data = await api<Repair[]>("/repairs");
      setRepairs(data);
      const wanted = keepId ?? selected?.id ?? data[0]?.id;
      const target = data.find((repair) => repair.id === wanted) ?? data[0];
      setSelected(target ? await api<RepairDetail>(`/repairs/${target.id}`) : null);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  useEffect(() => { void load(); }, []);

  async function select(id: number) {
    try {
      setSelected(await api<RepairDetail>(`/repairs/${id}`));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function action(id: number, kind: "test" | "approve") {
    setMessage("");
    setError("");
    try {
      await api(`/repairs/${id}/${kind}`, { method: "POST", body: JSON.stringify({}) });
      setMessage(kind === "test" ? "本地测试结果已记录为通过" : "修复包已批准；下一步可以创建修复分支和 PR");
      await load(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function createPr(id: number) {
    setMessage("");
    setError("");
    setBusy(true);
    try {
      const result = await api<{ branchName: string; pullRequest?: { html_url?: string; number?: number } }>(
        `/repairs/${id}/create-pr`,
        { method: "POST", body: JSON.stringify({ branchName: branchName.trim() || undefined }) }
      );
      const url = result.pullRequest?.html_url;
      setMessage(`已创建分支 ${result.branchName}${url ? `，PR 地址：${url}` : ""}`);
      await load(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function download(id: number) {
    try {
      await downloadFile(`/repairs/${id}/files/repair.diff`, `repair-${id}.diff`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const canCreatePr = PR_ROLES.includes(user.role);

  return (
    <>
      <PageHeader title="修复包" description="修复必须先本地测试和 review；批准后也只创建 PR，不直接写入主干。" />
      {error && <div className="alert">{error}</div>}
      {message && <div className="success">{message}</div>}
      <section className="runs-layout">
        <aside className="panel run-list">
          <div className="panel-header"><div><h2>Repair Bundle</h2></div></div>
          {!repairs ? <Loading /> : repairs.length === 0 ? <EmptyState icon={<Wrench size={23} />} title="还没有修复包" text="从待处理影响中生成修复建议。" /> : repairs.map((repair) => (
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
                <button className="secondary-button" onClick={() => void download(selected.id)}><Download size={16} />下载 Diff</button>
                <button className="secondary-button" onClick={() => void action(selected.id, "test")} disabled={selected.status === "approved"}><FlaskConical size={16} />记录本地测试</button>
                <button className="primary-button" onClick={() => void action(selected.id, "approve")} disabled={selected.status !== "tested"}><ShieldCheck size={16} />批准修复</button>
              </div>
              {selected.status === "approved" && canCreatePr && (
                <div className="pr-panel">
                  <div><GitPullRequest size={17} /><strong>创建修复分支与 PR</strong></div>
                  <input
                    value={branchName}
                    onChange={(event) => setBranchName(event.target.value)}
                    placeholder={`giteehelper/repair-${selected.id}`}
                    aria-label="修复分支名"
                  />
                  <button className="primary-button" onClick={() => void createPr(selected.id)} disabled={busy}>
                    <GitPullRequest size={16} />{busy ? "创建中…" : "创建 PR"}
                  </button>
                  <small>只会创建分支和 PR，不会直接写入主干，也不会自动合并。</small>
                </div>
              )}
              <div className="security-note"><CheckCircle2 size={17} />批准只授权创建修复分支/PR，不授权直接提交主干或自动合并。</div>
              <h3>repair.diff</h3><pre className="code-block">{selected.diff}</pre>
              <h3>tests.patch</h3><pre className="code-block">{selected.testsPatch}</pre>
              <h3>test-report.json</h3><pre className="code-block">{JSON.stringify(selected.testReport, null, 2)}</pre>
              <h3>provenance.json</h3><pre className="code-block">{JSON.stringify(selected.provenance, null, 2)}</pre>
            </>
          )}
        </article>
      </section>
    </>
  );
}
