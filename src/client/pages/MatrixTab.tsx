import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { api } from "../api";
import { Loading } from "../components";

/**
 * 责任矩阵：字段与负责人交付表一一对应——
 * 大模块 | 小模块 | 后端 | 前端 | 完成 | 阻塞？ | 阻塞模块 | 阻塞方负责人 | 阻塞方进展（RFC/PR/合入） | 我们可否部分介入
 * 后端/前端/完成由 PR 数据自动推导；阻塞五字段人工标注（admin/maintainer 行内编辑）。
 */

type TaskState = "not_started" | "designing" | "designed" | "developing" | "done";

type MatrixTask = {
  moduleId: number; key: string; name: string; ownerUserId: number | null; ownerName: string | null;
  group: string; state: TaskState; codeMerged: number; codeOpen: number;
  sub: { backend: boolean; frontend: boolean; docs: boolean; openBackend: boolean; openFrontend: boolean };
  frontendPending: boolean;
};
type Blocker = {
  moduleId: number; blocked: boolean | null;
  blockerModule: string; blockerOwner: string; blockerProgress: string; engageNote: string;
  updatedBy: string | null; updatedAt: string;
};

const PAGE_SIZE_NOTE = "点击铅笔编辑本行的阻塞标注";

/** 完成列：✅ 已合并 · 🟡 在审/在飞 · ❌ 未完成 */
function DoneCell({ state }: { state: TaskState }) {
  if (state === "done") return <span className="delivery yes" title="代码 PR 已合并">✅</span>;
  if (state === "developing") return <span className="delivery wip" title="PR 在审/在飞">🟡</span>;
  return <span className="delivery no" title="未完成">❌</span>;
}

/** 交付面单元格：✅ 已合并 · 🟡 在飞 · ❌ 未动 · — 无此面 */
function DeliveryCell({ merged, open, declared, title }: { merged: boolean; open: boolean; declared: boolean; title: string }) {
  if (merged) return <span className="delivery yes" title={`${title}：已合并交付`}>✅</span>;
  if (open) return <span className="delivery wip" title={`${title}：在飞 PR 进行中`}>🟡</span>;
  if (declared) return <span className="delivery no" title={`${title}：声明了此面但未动`}>❌</span>;
  return <span className="delivery na" title={`${title}：无此交付面`}>—</span>;
}

export default function MatrixTab({ user }: { user: { role: string } }) {
  const [board, setBoard] = useState<Array<{ name: string; ownerNames: string[]; tasks: MatrixTask[] }> | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [error, setError] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = user.role === "admin" || user.role === "maintainer";

  const load = useCallback(() => {
    setBusy(true);
    Promise.all([
      api<{ groups: Array<{ name: string; ownerNames: string[]; tasks: Array<MatrixTask & { group?: string }> }> }>("/progress/board"),
      api<Blocker[]>("/progress/blockers")
    ]).then(([boardData, blockerData]) => {
      setBoard(boardData.groups.map((group) => ({ ...group, tasks: group.tasks.map((task) => ({ ...task, group: group.name })) })));
      setBlockers(blockerData);
      setError("");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  useEffect(() => { load(); }, [load]);

  // WebHook 落库后矩阵即新：60 秒自动重取
  useEffect(() => {
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const blockerByModule = useMemo(() => new Map(blockers.map((item) => [item.moduleId, item])), [blockers]);

  const people = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of board ?? []) for (const task of group.tasks) {
      if (task.ownerName) map.set(task.ownerName, (map.get(task.ownerName) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [board]);

  const matches = (task: MatrixTask) => {
    if (person && task.ownerName !== person) return false;
    if (onlyOpen && task.state === "done") return false;
    if (keyword && !`${task.name} ${task.key} ${task.ownerName ?? ""}`.toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  };

  const groups = useMemo(() => {
    if (!board) return [];
    return board
      .map((group) => ({ ...group, tasks: group.tasks.filter(matches) }))
      .filter((group) => group.tasks.length > 0);
  }, [board, person, onlyOpen, keyword]);

  if (!board && !error) return <Loading />;

  return (
    <>
      {error && <div className="alert">{error}</div>}
      <section className="panel matrix-filters">
        <div className="stream-people" role="group" aria-label="按人筛选">
          <button className={person === null ? "chip active" : "chip"} onClick={() => setPerson(null)}>全员</button>
          {people.map(([name, count]) => (
            <button key={name} className={person === name ? "chip active" : "chip"} onClick={() => setPerson(person === name ? null : name)}>
              <span className="chip-avatar">{name.slice(0, 1)}</span>{name}<small>{count}</small>
            </button>
          ))}
        </div>
        <div className="stream-toolbar">
          <label className="legend-chip on" style={{ cursor: "default", gap: 6 }}>
            <input type="checkbox" checked={onlyOpen} onChange={(event) => setOnlyOpen(event.target.checked)} style={{ accentColor: "#2f7fa8" }} />
            隐藏已完成
          </label>
          <label className="stream-search"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索任务 / 编号" /></label>
          <small className="delivery-legend">后端/前端：✅ 已合并 · 🟡 在飞 · ❌ 未动 · — 无此面</small>
          <button className="secondary-button" style={{ marginLeft: "auto" }} onClick={load} disabled={busy}>
            {busy ? "刷新中…" : "刷新"}
          </button>
        </div>
      </section>

      {groups.map((group) => {
        const done = group.tasks.filter((task) => task.state === "done").length;
        const rate = group.tasks.length ? Math.round((done / group.tasks.length) * 100) : 0;
        return (
          <section key={group.name} className="panel matrix-panel">
            <header className="matrix-group-head">
              <div>
                <h3>{group.name}</h3>
                <small>{group.ownerNames.length ? `负责人 ${group.ownerNames.join(" · ")}` : "未分配负责人"}</small>
              </div>
              <div className="matrix-group-progress">
                <div className="task-progress-track"><i style={{ width: `${rate}%` }} /></div>
                <small>{done}/{group.tasks.length} 完成 · {rate}%</small>
              </div>
            </header>
            <div className="table-wrap">
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th style={{ width: "22%" }}>小模块</th>
                    <th style={{ width: 52, textAlign: "center" }}>后端</th>
                    <th style={{ width: 52, textAlign: "center" }}>前端</th>
                    <th style={{ width: 52, textAlign: "center" }}>完成</th>
                    <th style={{ width: 64 }}>阻塞？</th>
                    <th style={{ width: "17%" }}>阻塞模块</th>
                    <th style={{ width: "11%" }}>阻塞方负责人</th>
                    <th style={{ width: "17%" }}>阻塞方进展（RFC/PR/合入）</th>
                    <th>我们可否部分介入</th>
                    {canEdit && <th style={{ width: 36 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {group.tasks.map((task) => (
                    <MatrixRow
                      key={task.moduleId}
                      task={task}
                      blocker={blockerByModule.get(task.moduleId)}
                      canEdit={canEdit}
                      onSaved={load}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {groups.length === 0 && <section className="panel"><div className="empty-state"><h2>没有匹配的任务</h2><p>调整成员或筛选条件后重试。</p></div></section>}
    </>
  );
}

function MatrixRow({ task, blocker, canEdit, onSaved }: {
  task: MatrixTask; blocker?: Blocker; canEdit: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(blocker?.blocked === true ? "yes" : blocker?.blocked === false ? "no" : "");
  const [blockerModule, setBlockerModule] = useState(blocker?.blockerModule ?? "");
  const [blockerOwner, setBlockerOwner] = useState(blocker?.blockerOwner ?? "");
  const [blockerProgress, setBlockerProgress] = useState(blocker?.blockerProgress ?? "");
  const [engageNote, setEngageNote] = useState(blocker?.engageNote ?? "");

  useEffect(() => {
    setBlocked(blocker?.blocked === true ? "yes" : blocker?.blocked === false ? "no" : "");
    setBlockerModule(blocker?.blockerModule ?? "");
    setBlockerOwner(blocker?.blockerOwner ?? "");
    setBlockerProgress(blocker?.blockerProgress ?? "");
    setEngageNote(blocker?.engageNote ?? "");
  }, [blocker]);

  async function save() {
    setBusy(true);
    try {
      await api("/progress/blocker", {
        method: "POST",
        body: JSON.stringify({
          moduleId: task.moduleId,
          blocked: blocked === "" ? null : blocked === "yes",
          blockerModule, blockerOwner, blockerProgress, engageNote
        })
      });
      setEditing(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const feDeclared = task.frontendPending || task.sub.frontend || task.sub.openFrontend;
  const beDeclared = task.sub.backend || task.sub.openBackend || task.codeMerged > 0 || task.codeOpen > 0;
  const blockChip = blocker === undefined || blocker.blocked === null
    ? <span className="block-chip unset">未标注</span>
    : blocker.blocked ? <span className="block-chip yes">是</span>
      : <span className="block-chip no">否</span>;

  return (
    <tr className="matrix-row">
      <td>
        <strong>{task.name}</strong>
        <small>{task.key} · {task.ownerName ?? "未分配"}{task.frontendPending && task.state !== "not_started" && task.state !== "designing" && <em className="fe-pending">前端未动</em>}</small>
      </td>
      <td style={{ textAlign: "center" }}><DeliveryCell merged={task.sub.backend} open={task.sub.openBackend} declared={beDeclared} title="后端" /></td>
      <td style={{ textAlign: "center" }}><DeliveryCell merged={task.sub.frontend} open={task.sub.openFrontend} declared={feDeclared} title="前端" /></td>
      <td style={{ textAlign: "center" }}><DoneCell state={task.state} /></td>
      {editing && canEdit ? (
        <>
          <td>
            <select value={blocked} onChange={(event) => setBlocked(event.target.value)}>
              <option value="">未标注</option>
              <option value="yes">是</option>
              <option value="no">否</option>
            </select>
          </td>
          <td><textarea rows={2} value={blockerModule} onChange={(event) => setBlockerModule(event.target.value)} placeholder="卡住这项工作的是什么" /></td>
          <td><input value={blockerOwner} onChange={(event) => setBlockerOwner(event.target.value)} placeholder="谁负责解锁" /></td>
          <td><textarea rows={2} value={blockerProgress} onChange={(event) => setBlockerProgress(event.target.value)} placeholder="对方的 RFC/PR/合入进展" /></td>
          <td><textarea rows={2} value={engageNote} onChange={(event) => setEngageNote(event.target.value)} placeholder="可以 / 有限 / 部分 / 否，加一句说明" /></td>
          {canEdit && (
            <td>
              <div className="row-actions">
                <button className="small-button" disabled={busy} onClick={() => void save()}>{busy ? "…" : "存"}</button>
                <button className="small-button" onClick={() => setEditing(false)}>取消</button>
              </div>
            </td>
          )}
        </>
      ) : (
        <>
          <td>{blockChip}</td>
          <td className="matrix-note">{blocker?.blockerModule || <small>—</small>}</td>
          <td className="matrix-note">{blocker?.blockerOwner || <small>—</small>}</td>
          <td className="matrix-note">{blocker?.blockerProgress || <small>—</small>}</td>
          <td className="matrix-note">{blocker?.engageNote || <small>—</small>}</td>
          {canEdit && (
            <td title={PAGE_SIZE_NOTE}>
              <button className="icon-button" onClick={() => setEditing(true)}><Pencil size={13} /></button>
            </td>
          )}
        </>
      )}
    </tr>
  );
}

