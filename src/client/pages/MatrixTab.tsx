import { useCallback, useEffect, useMemo, useState } from "react";
import { Maximize2, Pencil, Plus, Search, X } from "lucide-react";
import { api } from "../api";
import { Loading, Modal } from "../components";

/**
 * 责任矩阵 v2：交付项粒度（对齐负责人的交付表）——
 * 大模块 | 小模块 | 后端 | 前端 | 完成 | 阻塞？ | 阻塞模块 | 阻塞方负责人 | 阻塞方进展 | 我们可否部分介入
 * PR 号（!399）自动解析出状态、交付面与可点链接；阻塞字段人工维护。
 */

type PrInfo = { number: number; state: string; url: string | null; backend: boolean; frontend: boolean; sync: boolean };
type Row = {
  id: number; groupName: string; itemName: string; owner: string; prNumbers: string;
  prs: PrInfo[];
  blocked: boolean | null;
  blockerModule: string; blockerOwner: string; blockerProgress: string; engageNote: string;
  updatedBy: string | null; updatedAt: string;
};

const prLink = (pr: PrInfo) => (
  pr.url
    ? <a key={pr.number} className="pr-link" href={pr.url} target="_blank" rel="noreferrer">!{pr.number}</a>
    : <span key={pr.number} className="pr-link plain">!{pr.number}</span>
);

/** 交付面/完成列：符号 + 可点 PR 号 */
function MarkCell({ kind, prs }: { kind: "backend" | "frontend" | "done"; prs: PrInfo[] }) {
  const relevant = prs.filter((pr) => !pr.sync && (kind === "done" || (kind === "backend" ? pr.backend : pr.frontend)));
  const merged = relevant.filter((pr) => pr.state === "merged");
  const open = relevant.filter((pr) => pr.state === "open");
  if (merged.length) {
    return (
      <span className="mark-cell">
        <span className="delivery yes">✅</span>
        {merged.slice(0, 3).map(prLink)}
        {merged.length > 3 && <small>+{merged.length - 3}</small>}
      </span>
    );
  }
  if (open.length) {
    return (
      <span className="mark-cell">
        <span className="delivery wip">🟡</span>
        {open.slice(0, 3).map(prLink)}
        {open.length > 3 && <small>+{open.length - 3}</small>}
      </span>
    );
  }
  return <span className="mark-cell"><span className="delivery no">❌</span></span>;
}

export default function MatrixTab({ user }: { user: { role: string } }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [editing, setEditing] = useState<Partial<Row> | null>(null);
  const canEdit = user.role === "admin" || user.role === "maintainer";

  const load = useCallback(() => {
    setBusy(true);
    api<Row[]>("/progress/matrix-rows").then((data) => {
      if (data.length === 0 && canEdit) {
        // 空表时自动初始化（BOSC 任务 → 交付项行），之后完全人工维护
        api("/progress/matrix-init", { method: "POST", body: JSON.stringify({}) })
          .then(() => api<Row[]>("/progress/matrix-rows"))
          .then((rows2) => setRows(rows2));
      } else {
        setRows(data);
      }
      setError("");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [canEdit]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const people = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) if (row.owner) map.set(row.owner, (map.get(row.owner) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const isDone = (row: Row) => row.prs.some((pr) => !pr.sync && pr.state === "merged");
  const filtered = useMemo(() => (rows ?? []).filter((row) => {
    if (person && row.owner !== person) return false;
    if (onlyOpen && isDone(row)) return false;
    if (keyword && !`${row.groupName} ${row.itemName} ${row.owner}`.toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  }), [rows, person, onlyOpen, keyword]);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of filtered) {
      const list = map.get(row.groupName) ?? [];
      list.push(row);
      map.set(row.groupName, list);
    }
    return [...map.entries()];
  }, [filtered]);

  if (!rows && !error) return <Loading />;

  const table = (compact: boolean) => (
    groups.map(([groupName, list]) => (
      <section key={groupName} className="panel matrix-panel">
        <header className="matrix-group-head">
          <div>
            <h3>{groupName}</h3>
            <small>{list.length} 个交付项{list.some((row) => row.owner) ? ` · 负责人 ${[...new Set(list.map((row) => row.owner).filter(Boolean))].join(" · ")}` : ""}</small>
          </div>
          {canEdit && !compact && (
            <button className="secondary-button" onClick={() => setEditing({ groupName, itemName: "", owner: "", prNumbers: "", blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "" })}>
              <Plus size={14} />添加交付项
            </button>
          )}
        </header>
        <div className="table-wrap matrix-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                <th className="col-item">小模块</th>
                <th className="col-mark">后端</th>
                <th className="col-mark">前端</th>
                <th className="col-mark">完成</th>
                <th className="col-blocked">阻塞？</th>
                <th className="col-note">阻塞模块</th>
                <th className="col-owner">阻塞方负责人</th>
                <th className="col-note">阻塞方进展（RFC/PR/合入）</th>
                <th className="col-note">我们可否部分介入</th>
                {canEdit && <th className="col-op"></th>}
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id} className="matrix-row">
                  <td className="col-item">
                    <strong>{row.itemName}</strong>
                    {row.owner && <small>{row.owner}</small>}
                  </td>
                  <td className="col-mark"><MarkCell kind="backend" prs={row.prs} /></td>
                  <td className="col-mark"><MarkCell kind="frontend" prs={row.prs} /></td>
                  <td className="col-mark"><MarkCell kind="done" prs={row.prs} /></td>
                  <td className="col-blocked">
                    {row.blocked === true ? <span className="block-chip yes">是</span>
                      : row.blocked === false ? <span className="block-chip no">否</span>
                        : <span className="block-chip unset">未标注</span>}
                  </td>
                  <td className="col-note matrix-note">{row.blockerModule || <small>—</small>}</td>
                  <td className="col-owner matrix-note">{row.blockerOwner || <small>—</small>}</td>
                  <td className="col-note matrix-note">{row.blockerProgress || <small>—</small>}</td>
                  <td className="col-note matrix-note">{row.engageNote || <small>—</small>}</td>
                  {canEdit && (
                    <td className="col-op">
                      <button className="icon-button" onClick={() => setEditing(row)}><Pencil size={13} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ))
  );

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
          <label className="stream-search"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索交付项 / 大模块" /></label>
          <small className="delivery-legend">✅ 已合并 · 🟡 在审在飞 · ❌ 未动（符号旁 !NN 点击直达 PR）</small>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="secondary-button" onClick={() => setFullscreen(true)}><Maximize2 size={14} />全屏</button>
            <button className="secondary-button" onClick={load} disabled={busy}>{busy ? "刷新中…" : "刷新"}</button>
          </div>
        </div>
      </section>

      {table(false)}

      {groups.length === 0 && (
        <section className="panel"><div className="empty-state"><h2>没有匹配的交付项</h2><p>调整成员或筛选条件后重试。</p></div></section>
      )}

      {fullscreen && (
        <Modal title="责任矩阵" wide onClose={() => setFullscreen(false)}>
          <div className="matrix-fullscreen">{table(true)}</div>
        </Modal>
      )}

      {editing && (
        <Modal title={editing.id ? "编辑交付项" : "添加交付项"} onClose={() => setEditing(null)}>
          <div className="form-grid matrix-edit">
            <label>大模块<input value={editing.groupName ?? ""} onChange={(e) => setEditing({ ...editing, groupName: e.target.value })} placeholder="如 评分规则库（RFC-20260911）" /></label>
            <label>小模块<input value={editing.itemName ?? ""} onChange={(e) => setEditing({ ...editing, itemName: e.target.value })} placeholder="如 T2 判法引擎+样题验证" /></label>
            <label>负责人<input value={editing.owner ?? ""} onChange={(e) => setEditing({ ...editing, owner: e.target.value })} placeholder="如 师沛琳" /></label>
            <label>PR 号（逗号分隔）<input value={editing.prNumbers ?? ""} onChange={(e) => setEditing({ ...editing, prNumbers: e.target.value })} placeholder="!399, !417" /></label>
            <label>阻塞？
              <select value={editing.blocked === true ? "yes" : editing.blocked === false ? "no" : ""} onChange={(e) => setEditing({ ...editing, blocked: e.target.value === "" ? null : e.target.value === "yes" })}>
                <option value="">未标注</option><option value="yes">是</option><option value="no">否</option>
              </select>
            </label>
            <label>阻塞方负责人<input value={editing.blockerOwner ?? ""} onChange={(e) => setEditing({ ...editing, blockerOwner: e.target.value })} placeholder="谁负责解锁" /></label>
            <label className="full">阻塞模块<input value={editing.blockerModule ?? ""} onChange={(e) => setEditing({ ...editing, blockerModule: e.target.value })} placeholder="卡住这项工作的是什么" /></label>
            <label className="full">阻塞方进展（RFC/PR/合入）<textarea value={editing.blockerProgress ?? ""} onChange={(e) => setEditing({ ...editing, blockerProgress: e.target.value })} rows={2} /></label>
            <label className="full">我们可否部分介入<textarea value={editing.engageNote ?? ""} onChange={(e) => setEditing({ ...editing, engageNote: e.target.value })} rows={2} placeholder="可以 / 有限 / 部分 / 否 + 说明" /></label>
          </div>
          <div className="modal-actions">
            {editing.id && (
              <button className="danger-button" onClick={() => {
                void api("/progress/matrix-row/delete", { method: "POST", body: JSON.stringify({ id: editing.id }) }).then(() => { setEditing(null); load(); });
              }}><X size={15} />删除</button>
            )}
            <button className="secondary-button" onClick={() => setEditing(null)}>取消</button>
            <button className="primary-button" onClick={() => {
              void api("/progress/matrix-row", { method: "POST", body: JSON.stringify(editing) }).then(() => { setEditing(null); load(); });
            }}>保存</button>
          </div>
        </Modal>
      )}
    </>
  );
}
