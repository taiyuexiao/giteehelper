import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Maximize2, Pencil, Plus, RotateCcw, Search, X } from "lucide-react";
import { api } from "../api";
import { Loading, Modal } from "../components";

/**
 * 责任矩阵：全景策展模式——
 * 大模块 | 小模块 | 后端 | 前端 | 完成 | 阻塞？ | 阻塞模块 | 阻塞方负责人 | 阻塞方进展 | 我们可否部分介入
 * 基线由「全景模板」（src/server/matrixTemplate.ts 手工策展）一键导入（merge 补缺 / replace 重建），
 * 落库后完全人工维护；PR 号（!399）自动解析出状态、交付面与可点 chip（含标题/合并日期的悬停提示）。
 */

type PrInfo = {
  number: number; state: string; url: string | null; title: string; mergedAt: string | null;
  backend: boolean; frontend: boolean; sync: boolean;
};
type Row = {
  id: number; groupName: string; itemName: string; owner: string; prNumbers: string;
  prs: PrInfo[];
  blocked: boolean | null;
  blockerModule: string; blockerOwner: string; blockerProgress: string; engageNote: string;
  statusNote: string;
  updatedBy: string | null; updatedAt: string;
};

const PR_STATE_LABEL: Record<string, string> = { merged: "已合并", open: "在审", closed: "已关闭", unknown: "未同步" };

function prStateClass(state: string): string {
  if (state === "merged") return "state-merged";
  if (state === "open") return "state-open";
  if (state === "closed") return "state-closed";
  return "state-unknown";
}

/** PR 状态徽章 chip：颜色随状态，悬停显示标题/状态/合并日期，点击新窗口直达 Gitee */
function prChip(pr: PrInfo) {
  const label = PR_STATE_LABEL[pr.state] ?? PR_STATE_LABEL.unknown;
  const tooltip = [
    pr.title || `PR !${pr.number}`,
    label,
    pr.state === "merged" && pr.mergedAt ? `合并于 ${pr.mergedAt.slice(0, 10)}` : ""
  ].filter(Boolean).join(" · ");
  const className = `pr-chip ${prStateClass(pr.state)}`;
  return pr.url
    ? <a key={pr.number} className={className} href={pr.url} target="_blank" rel="noreferrer" title={tooltip}>!{pr.number}</a>
    : <span key={pr.number} className={`${className} plain`} title={tooltip}>!{pr.number}</span>;
}

/** 一格里最多平铺的 chip 数，多余的收成 +N（悬停列出全部），不再竖堆 */
const MAX_CHIPS = 4;

function chipList(list: PrInfo[]) {
  const shown = list.slice(0, MAX_CHIPS);
  const rest = list.slice(MAX_CHIPS);
  return (
    <>
      {shown.map(prChip)}
      {rest.length > 0 && (
        <span
          className="pr-chip more"
          title={rest.map((pr) => `!${pr.number} ${PR_STATE_LABEL[pr.state] ?? ""} ${pr.title || ""}`.trim()).join("\n")}
        >
          +{rest.length}
        </span>
      )}
    </>
  );
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
      setRows(data);
      setError("");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const importTemplate = useCallback((mode: "merge" | "replace") => {
    if (mode === "replace" && !window.confirm("将清空当前全部责任矩阵行并按全景模板重建，人工修改会丢失。确定？")) return;
    api<{ created: number; replaced: boolean }>("/progress/matrix-template", { method: "POST", body: JSON.stringify({ mode }) })
      .then(() => load())
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [load]);

  const initFromBoard = useCallback(() => {
    api("/progress/matrix-init", { method: "POST", body: JSON.stringify({}) })
      .then(() => load())
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
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

  /** 后端/前端列：只要符号（✅ 已合并 / 🟡 在审 / ❌ 未动 / — 不涉及），与对话里的表一致 */
  function faceSymbol(prs: PrInfo[], face: "backend" | "frontend"): string {
    const relevant = prs.filter((pr) => !pr.sync && (face === "backend" ? pr.backend : pr.frontend));
    if (relevant.some((pr) => pr.state === "merged")) return "✅";
    if (relevant.some((pr) => pr.state === "open")) return "🟡";
    if (relevant.length) return "❌";
    return "—";
  }

  function doneSymbol(row: Row): string {
    const relevant = row.prs.filter((pr) => !pr.sync);
    if (relevant.some((pr) => pr.state === "merged")) return "✅";
    if (relevant.some((pr) => pr.state === "open")) return "🟡";
    return "❌";
  }

  const flat = groups.flatMap(([group, list]) =>
    list.map((row, index) => ({ row, group, first: index === 0, span: list.length }))
  );

  const table = (compact: boolean) => (
    <section className="panel matrix-panel">
      <header className="matrix-group-head">
        <div>
          <h3>责任矩阵</h3>
          <small>{filtered.length} 个交付项 · 点击上方人名切换成个人视图</small>
        </div>
        {canEdit && !compact && (
          <button className="secondary-button" onClick={() => setEditing({ groupName: "", itemName: "", owner: "", prNumbers: "", blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "", statusNote: "" })}>
            <Plus size={14} />添加交付项
          </button>
        )}
      </header>
      <div className="table-wrap matrix-scroll">
        <table className="matrix-table matrix-one">
          <thead>
            <tr>
              <th className="col-group">大模块</th>
              <th className="col-item">小模块</th>
              <th className="col-owner2">负责人</th>
              <th className="col-pr">相关 PR</th>
              <th className="col-mark">后端</th>
              <th className="col-mark">前端</th>
              <th className="col-done">完成</th>
              <th className="col-blocked">阻塞？</th>
              <th className="col-note">阻塞模块</th>
              <th className="col-owner">阻塞方负责人</th>
              <th className="col-note">阻塞方进展（RFC/PR/合入）</th>
              <th className="col-note">我们可否部分介入</th>
              {canEdit && <th className="col-op"></th>}
            </tr>
          </thead>
          <tbody>
            {flat.map(({ row, group, first, span }) => (
              <tr key={row.id} className="matrix-row">
                {first && <td className="col-group" rowSpan={span}>{group}</td>}
                <td className="col-item"><strong>{row.itemName}</strong></td>
                <td className="col-owner2 matrix-note">{row.owner || <small>—</small>}</td>
                <td className="col-pr">
                  {row.prs.some((pr) => !pr.sync)
                    ? <span className="mark-cell">{chipList(row.prs.filter((pr) => !pr.sync))}</span>
                    : <small>—</small>}
                </td>
                <td className="col-mark"><span className="face-symbol">{faceSymbol(row.prs, "backend")}</span></td>
                <td className="col-mark"><span className="face-symbol">{faceSymbol(row.prs, "frontend")}</span></td>
                <td className="col-done">
                  <span className="face-symbol">{doneSymbol(row)}</span>
                  {row.statusNote && <small className="status-inline">{row.statusNote}</small>}
                </td>
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
          <small className="delivery-legend">✅/绿 已合并 · 🟡/蓝 在审 · 灰 已关闭或未同步（chip 点击直达 PR，悬停看标题与合并日期）</small>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {canEdit && (
              <>
                <button className="secondary-button" onClick={() => importTemplate("merge")} title="按全景模板补齐缺失的交付项行，不动已有人工修改"><Download size={14} />导入全景模板</button>
                <button className="secondary-button" onClick={() => importTemplate("replace")} title="清空全部矩阵行后按全景模板重建"><RotateCcw size={14} />重置为模板</button>
              </>
            )}
            <button className="secondary-button" onClick={() => setFullscreen(true)}><Maximize2 size={14} />全屏</button>
            <button className="secondary-button" onClick={load} disabled={busy}>{busy ? "刷新中…" : "刷新"}</button>
          </div>
        </div>
      </section>

      {table(false)}

      {rows && rows.length === 0 && (
        <section className="panel">
          <div className="empty-state">
            <h2>责任矩阵还没有内容</h2>
            <p>导入全景模板（按大模块→交付项策展的基线，PR 状态自动解析），或从看板任务初始化骨架。</p>
            {canEdit && (
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
                <button className="primary-button" onClick={() => importTemplate("merge")}><Download size={14} />导入全景模板</button>
                <button className="secondary-button" onClick={initFromBoard}>从看板任务初始化</button>
              </div>
            )}
          </div>
        </section>
      )}

      {rows && rows.length > 0 && groups.length === 0 && (
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
            <label className="full">完成备注<input value={editing.statusNote ?? ""} onChange={(e) => setEditing({ ...editing, statusNote: e.target.value })} placeholder="完成列下方的一行说明（如 主体在 main；面板在审）" /></label>
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
