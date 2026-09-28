import { useEffect, useState } from "react";
import { Activity, Boxes, CheckCircle2, Play } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, Loading, PageHeader, StatusBadge } from "../components";

type Run = {
  id: number; triggerEventId: number | null; moduleKey: string; status: string;
  combination: Array<{ moduleKey: string; version: string; mode: string; status: string }>;
  result: Record<string, unknown>; createdAt: string;
};

export default function RunsPage({ user }: { user: { role: string } }) {
  const canLaunch = user.role !== "observer";
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [selected, setSelected] = useState<Run | null>(null);
  const [moduleKey, setModuleKey] = useState("");
  const [error, setError] = useState("");
  const requestedRun = Number(searchParams.get("run")) || null;

  const load = async () => {
    try {
      const data = await api<Run[]>("/runs");
      setRuns(data);
      setSelected((current) => {
        const wanted = requestedRun ?? current?.id;
        return data.find((run) => run.id === wanted) ?? data[0] ?? null;
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  useEffect(() => { void load(); }, [requestedRun]);

  function select(run: Run) {
    setSelected(run);
    // 深链可分享：把当前选中的运行写回地址栏
    setSearchParams({ run: String(run.id) }, { replace: true });
  }

  async function launch() {
    if (!moduleKey) return;
    try {
      const created = await api<Run>("/runs", { method: "POST", body: JSON.stringify({ moduleKey }) });
      setModuleKey("");
      await load();
      if (created?.id) setSearchParams({ run: String(created.id) }, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <PageHeader title="联调运行" description="只有执行真实命令并通过后才算代码联调；否则仅记录契约组合并标记阻塞。" />
      {error && <div className="alert">{error}</div>}
      {canLaunch && <section className="run-launch panel">
        <div><Boxes size={21} /><strong>发起增量联调</strong></div>
        <input value={moduleKey} onChange={(e) => setModuleKey(e.target.value)} placeholder="模块 Key，例如 frontend" aria-label="模块 Key" />
        <button className="primary-button" onClick={() => void launch()} disabled={!moduleKey}><Play size={16} />运行</button>
      </section>}
      <section className="runs-layout">
        <aside className="panel run-list">
          <div className="panel-header"><div><h2>运行记录</h2></div></div>
          {!runs ? <Loading /> : runs.length === 0 ? <EmptyState icon={<Activity size={23} />} title="还没有运行" text="发起一次模块联调后会出现在这里。" /> : runs.map((runItem) => (
            <button key={runItem.id} className={selected?.id === runItem.id ? "run-item active" : "run-item"} onClick={() => select(runItem)}>
              <div><strong>{runItem.moduleKey}</strong><small>#{runItem.id} · {runItem.createdAt}</small></div>
              <StatusBadge value={runItem.status} />
            </button>
          ))}
        </aside>
        <article className="panel run-detail">
          {!selected ? <EmptyState icon={<Activity size={25} />} title="选择一次运行" text="查看真实/Stub 组合、场景和测试输出。" /> : (
            <>
              <div className="panel-header"><div><h2>{selected.moduleKey} · Run #{selected.id}</h2><p>{selected.createdAt}</p></div><StatusBadge value={selected.status} /></div>
              {selected.result.executionVerified !== true && <div className="alert">该记录只完成契约组合检查，不是真实代码联调。</div>}
              {selected.result.contractVerified === false && (
                <div className="alert">存在未注册或版本不兼容的必需契约：{String((selected.result.missingContracts as string[] | undefined)?.join("、") ?? "")}</div>
              )}
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
