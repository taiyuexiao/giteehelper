import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { api } from "../api";
import { Loading } from "../components";

/**
 * 责任矩阵：每个任务一行——交付面（后端/前端自动推导）、五态、阻塞标注（人工维护）。
 * 交付列：✅ 已合并 · 🟡 在飞 · ❌ 未动 · — 无此面；阻塞三字段为人工标注（admin/maintainer 可编辑）。
 */

type TaskState = "not_started" | "designing" | "designed" | "developing" | "done";

type MatrixTask = {
  moduleId: number; key: string; name: string; ownerUserId: number | null; ownerName: string | null;
  group: string; state: TaskState; docMerged: number; docOpen: number; codeMerged: number; codeOpen: number;
  sub: { backend: boolean; frontend: boolean; docs: boolean; openBackend: boolean; openFrontend: boolean };
  frontendPending: boolean;
};
type Blocker = { moduleId: number; blocked: boolean | null; blockerNote: string; actionNote: string; updatedBy: string | null; updatedAt: string };
type MatrixGroup = { name: string; ownerNames: string[]; tasks: MatrixTask[] };

const STATE_LABELS: Record<TaskState, string> = {
  not_started: "未开始", designing: "设计中", designed: "设计定稿", developing: "开发中", done: "完成"
};
const STATE_BADGE: Record<TaskState, string> = {
  not_started: "status-blocked", designing: "status-running", designed: "status-clarification",
  developing: "status-running", done: "status-passed"
};

/** 交付面单元格：✅ 已合并 · 🟡 在飞 · ❌ 未动 · — 无此面 */
function DeliveryCell({ merged, open, declared, title }: { merged: boolean; open: boolean; declared: boolean; title: string }) {
  if (merged) return <span className="delivery yes" title={`${title}：已合并交付`}>✅</span>;
  if (open) return <span className="delivery wip" title={`${title}：在飞 PR 进行中`}>🟡</span>;
  if (declared) return <span className="delivery no" title={`${title}：声明了此面但未动`}>❌</span>;
  return <span className="delivery na" title={`${title}：无此交付面`}>—</span>;
}

export default function MatrixTab({ user }: { user: { role: string } }) {
  const [board, setBoard] = useState<MatrixGroup[] | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [error, setError] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const canEdit = user.role === "admin" || user.role === "maintainer";
  const [busy, setBusy] = useState(false);

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

  // WebHook 落库后矩阵数据即新：每 60 秒自动重取，挂着页面就能看到 PR 提交/合并的实时变化
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
          <label className="legend-chip on" style={{ cursor: "default" }}>
            <input type="checkbox" checked={onlyOpen} onChange={(event) => setOnlyOpen(event.target.checked)} style={{ accentColor: "#2f7fa8" }} />
            隐藏已完成
          </label>
          <label className="stream-search"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索任务 / 编号" /></label>
          <small className="delivery-legend">交付列：✅ 已合并 · 🟡 在飞 · ❌ 未动 · — 无此面</small>
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
                    <th style={{ width: "26%" }}>任务</th>
                    <th>负责人</th>
                    <th style={{ width: 56 }}>后端</th>
                    <th style={{ width: 56 }}>前端</th>
                    <th style={{ width: 90 }}>状态</th>
                    <th style={{ width: 70 }}>阻塞</th>
                    <th style={{ width: "30%" }}>阻塞点与阻塞方</th>
                    <th style={{ width: "22%" }}>介入建议</th>
                    {canEdit && <th style={{ width: 40 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {group.tasks.map((task) => (
                    <MatrixRow
                      key={task.moduleId}
                      task={task}
                      blocker={blockerByModule.get(task.moduleId)}
                      canEdit={canEdit}
                      onSaved={() => load()}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

function MatrixRow({ task, blocker, canEdit, onSaved }: {
  task: MatrixTask; blocker?: Blocker; canEdit: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string>(blocker?.blocked === null || blocker === undefined ? "" : blocker.blocked ? "yes" : "no");
  const [note, setNote] = useState(blocker?.blockerNote ?? "");
  const [action, setAction] = useState(blocker?.actionNote ?? "");

  useEffect(() => {
    setBlocked(blocker?.blocked === null || blocker === undefined ? "" : blocker.blocked ? "yes" : "no");
    setNote(blocker?.blockerNote ?? "");
    setAction(blocker?.actionNote ?? "");
  }, [blocker]);

  async function save() {
    setBusy(true);
    try {
      await api("/progress/blocker", {
        method: "POST",
        body: JSON.stringify({ moduleId: task.moduleId, blocked: blocked === "" ? null : blocked === "yes", blockerNote: note, actionNote: action })
      });
      setEditing(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const feDeclared = task.frontendPending || task.sub.frontend || task.sub.openFrontend;
  const beDeclared = task.sub.backend || task.sub.openBackend || task.codeMerged > 0 || task.codeOpen > 0;

  return (
    <tr className="matrix-row">
      <td>
        <strong>{task.name}</strong>
        <small>{task.key}{task.frontendPending && <em className="fe-pending">前端未动</em>}</small>
      </td>
      <td>{task.ownerName ?? <small>未分配</small>}</td>
      <td><DeliveryCell merged={task.sub.backend} open={task.sub.openBackend} declared={beDeclared} title="后端" /></td>
      <td><DeliveryCell merged={task.sub.frontend} open={task.sub.openFrontend} declared={feDeclared} title="前端" /></td>
      <td><span className={`badge ${STATE_BADGE[task.state]}`}>{STATE_LABELS[task.state]}</span></td>
      {editing && canEdit ? (
        <>
          <td>
            <select value={blocked} onChange={(event) => setBlocked(event.target.value)}>
              <option value="">未标注</option>
              <option value="yes">是</option>
              <option value="no">否</option>
            </select>
          </td>
          <td><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="阻塞点、阻塞方与进展" /></td>
          <td><textarea rows={2} value={action} onChange={(event) => setAction(event.target.value)} placeholder="可否部分介入与建议" /></td>
          <td>
            <div className="row-actions">
              <button className="small-button" disabled={busy} onClick={() => void save()}>{busy ? "…" : "存"}</button>
              <button className="small-button" onClick={() => setEditing(false)}>取消</button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td>
            {blocker === undefined ? (
              <span className="block-chip unset">未标注</span>
            ) : blocker.blocked === true ? <span className="block-chip yes">阻塞</span>
              : blocker.blocked === false ? <span className="block-chip no">否</span>
                : <span className="block-chip unset">未标注</span>}
          </td>
          <td className="matrix-note">{blocker?.blockerNote || <small>—</small>}</td>
          <td className="matrix-note">{blocker?.actionNote || <small>—</small>}</td>
          {canEdit && (
            <td>
              <button className="icon-button" title="编辑阻塞标注" onClick={() => setEditing(true)}><Pencil size={13} /></button>
            </td>
          )}
        </>
      )}
    </tr>
  );
}
