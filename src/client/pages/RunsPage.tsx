import { useEffect, useState } from "react";
import { Activity, Boxes, CheckCircle2, Play, XCircle } from "lucide-react";
import { api } from "../api";
import { EmptyState, Loading, PageHeader, StatusBadge } from "../components";

type Run = {
  id: number; triggerEventId: number | null; moduleKey: string; status: string;
  combination: Array<{ moduleKey: string; version: string; mode: string; status: string }>;
  result: Record<string, unknown>; createdAt: string;
};

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [moduleKey, setModuleKey] = useState("");
  const [error, setError] = useState("");
  const load = () => api<Run[]>("/runs").then((data) => { setRuns(data); setSelected((current) => current ? data.find((run) => run.id === current.id) ?? data[0] ?? null : data[0] ?? null); }).catch((reason) => setError(String(reason)));
  useEffect(() => { void load(); }, []);

  async function run() {
    if (!moduleKey) return;
    try {
      await api("/runs", { method: "POST", body: JSON.stringify({ moduleKey }) });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <PageHeader title="联调运行" description="一跳依赖优先使用真实模块；缺席依赖使用契约桩并明确标记。" />
      {error && <div className="alert">{error}</div>}
      <section className="run-launch panel">
        <div><Boxes size={21} /><strong>发起增量联调</strong></div>
        <input value={moduleKey} onChange={(e) => setModuleKey(e.target.value)} placeholder="模块 Key，例如 frontend" />
        <button className="primary-button" onClick={() => void run()}><Play size={16} />运行</button>
      </section>
      <section className="runs-layout">
        <aside className="panel run-list">
          <div className="panel-header"><div><h2>运行记录</h2></div></div>
          {runs.length === 0 ? <EmptyState icon={<Activity size={23} />} title="还没有运行" text="发起一次模块联调后会出现在这里。" /> : runs.map((runItem) => (
            <button key={runItem.id} className={selected?.id === runItem.id ? "run-item active" : "run-item"} onClick={() => setSelected(runItem)}>
              <div><strong>{runItem.moduleKey}</strong><small>#{runItem.id} · {runItem.createdAt}</small></div>
              <StatusBadge value={runItem.status} />
            </button>
          ))}
        </aside>
        <article className="panel run-detail">
          {!selected ? <EmptyState icon={<Activity size={25} />} title="选择一次运行" text="查看真实/Stub 组合、场景和测试输出。" /> : (
            <>
              <div className="panel-header"><div><h2>{selected.moduleKey} · Run #{selected.id}</h2><p>{selected.createdAt}</p></div><StatusBadge value={selected.status} /></div>
              <div className="combination-grid">
                {selected.combination.map((item, index) => (
                  <article key={`${item.moduleKey}-${index}`} className={`combination ${item.mode}`}>
                    <div>{item.mode === "real" ? <CheckCircle2 size={18} /> : <Boxes size={18} />}<strong>{item.moduleKey}</strong></div>
                    <span>{item.version}</span>
                    <small>{item.mode === "real" ? "真实模块" : "契约桩"} · {item.status}</small>
                  </article>
                ))}
              </div>
              <h3>运行结果</h3>
              <pre className="code-block">{JSON.stringify(selected.result, null, 2)}</pre>
            </>
          )}
        </article>
      </section>
    </>
  );
}
