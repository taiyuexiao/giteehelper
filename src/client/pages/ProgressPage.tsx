import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Download, ExternalLink, ListChecks, RefreshCw, UserRound, Users } from "lucide-react";
import { api } from "../api";
import { EmptyState, Loading, PageHeader, StatusBadge } from "../components";
import type { Role } from "../../shared/types";

type TaskState = "not_started" | "designing" | "designed" | "developing" | "done";

const STATE_LABELS: Record<TaskState, string> = {
  not_started: "未开始",
  designing: "设计中",
  designed: "设计定稿",
  developing: "开发中",
  done: "已完成"
};

type BoardTaskPull = { number: number; title: string; state: string; kind: string; url: string | null; mergedAt: string | null; authorLogin: string | null };
type BoardTask = {
  moduleId: number; key: string; name: string; ownerUserId: number | null; ownerName: string | null;
  state: TaskState; docMerged: number; docOpen: number; codeMerged: number; codeOpen: number;
  lastActivityAt: string | null; authorLogins: string[]; pulls: BoardTaskPull[];
};
type BoardGroup = { name: string; moduleId: number | null; ownerUserId: number | null; ownerName: string | null; tasks: BoardTask[] };
type BoardData = {
  initialized: boolean;
  summary: Record<TaskState, number> & { total: number };
  groups: BoardGroup[];
};

type PersonMetrics = {
  userId: number; name: string; tasksOwned: number; tasksDone: number;
  mergedPrs: number; openPrs: number; docPrs: number; codePrs: number;
  additions: number; deletions: number; avgMergeHours: number | null;
  commitCount: number; heat: number[][]; referencedBy: number; referencesOut: number; emails: string[];
};

type IdentitySuggestion = { login: string; prs: number; resolvedTo: number | null; resolvedName: string | null; sampleNames: string[] };

type AssignmentPreview = {
  modules: Array<{
    name: string;
    owners: string[];
    tasks: Array<{ key?: string; name: string; owner?: string; upstream?: string; downstream?: string; note?: string }>;
  }>;
};

const STATE_ORDER: TaskState[] = ["done", "developing", "designed", "designing", "not_started"];

function timeAgo(value: string | null | undefined) {
  if (!value) return "—";
  const text = value.includes("T") || value.includes("+") ? value : `${value.replace(" ", "T")}Z`;
  const stamp = Date.parse(text);
  if (!Number.isFinite(stamp)) return value;
  const days = Math.round((Date.now() - stamp) / 86_400_000);
  if (days <= 0) return "今天";
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.round(days / 30)} 个月前`;
  return `${Math.round(days / 365)} 年前`;
}

/* ---------- 初始化向导 ---------- */

function Wizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [backfill, setBackfill] = useState<{ done: number; remaining: number } | null>(null);
  const [importMode, setImportMode] = useState<"csv" | "text">("csv");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [suggestions, setSuggestions] = useState<IdentitySuggestion[]>([]);
  const [aliasChoice, setAliasChoice] = useState<Record<string, string>>({});

  async function syncPulls() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ pulls: number }>("/gitee/sync-pulls", { method: "POST", body: JSON.stringify({ withFiles: true }) });
      setMessage(`已同步 ${result.pulls} 个 PR，开始回填历史文件与提交作者…`);
      await runBackfill();
      setStep(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function runBackfill() {
    let total = 0;
    for (let round = 0; round < 40; round += 1) {
      const result = await api<{ fetched: number; remaining: number }>("/progress/backfill-files", {
        method: "POST", body: JSON.stringify({ max: 40 })
      });
      total += result.fetched;
      setBackfill({ done: total, remaining: result.remaining });
      if (result.remaining === 0) break;
    }
    total = 0;
    for (let round = 0; round < 40; round += 1) {
      const result = await api<{ fetched: number; remaining: number }>("/progress/backfill-authors", {
        method: "POST", body: JSON.stringify({ max: 40 })
      });
      total += result.fetched;
      setBackfill({ done: total, remaining: result.remaining });
      if (result.remaining === 0) break;
    }
  }

  async function parseImport() {
    setError(""); setPreview(null);
    try {
      const result = await api<AssignmentPreview>("/progress/import/parse", {
        method: "POST", body: JSON.stringify({ mode: importMode, content })
      });
      setPreview(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function applyImport() {
    setBusy(true); setError("");
    try {
      const result = await api<{ modules: number; tasks: number; usersCreated: number }>("/progress/import/apply", {
        method: "POST", body: JSON.stringify(preview)
      });
      setMessage(`已导入 ${result.modules} 个模块、${result.tasks} 个任务（新建 ${result.usersCreated} 个成员账号）`);
      const list = await api<IdentitySuggestion[]>("/progress/identity-suggestions");
      setSuggestions(list);
      setStep(3);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveAliases() {
    setBusy(true); setError("");
    try {
      for (const [login, userId] of Object.entries(aliasChoice)) {
        if (!userId) continue;
        await api("/progress/identity", { method: "POST", body: JSON.stringify({ alias: login, userId: Number(userId) }) });
      }
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const unresolved = suggestions.filter((item) => !item.resolvedTo);

  return (
    <section className="panel progress-wizard">
      <div className="panel-header"><div><h2>初始化进度看板</h2><p>三步：同步仓库数据 → 导入分工 → 对齐身份。</p></div></div>
      {error && <div className="alert">{error}</div>}
      {message && <div className="success">{message}</div>}

      {step === 1 && (
        <div className="wizard-step">
          <h3><ListChecks size={16} /> 第 1 步 · 同步仓库数据</h3>
          <p>拉取全部 PR（含变更文件）建立任务与 PR 的关联；没有文件的历史 PR 会被分批回填，PR 多时需要几分钟。</p>
          {backfill && <p className="confirm-copy">已回填 {backfill.done} 个 PR 的文件，剩余 {backfill.remaining}…</p>}
          <button className="primary-button" disabled={busy} onClick={() => void syncPulls()}>
            <RefreshCw size={16} />{busy ? "同步中…" : "开始同步"}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-step">
          <h3><ClipboardList size={16} /> 第 2 步 · 导入分工</h3>
          <div className="view-switcher" role="tablist">
            <button className={importMode === "csv" ? "active" : ""} onClick={() => setImportMode("csv")}>CSV / TSV</button>
            <button className={importMode === "text" ? "active" : ""} onClick={() => setImportMode("text")}>粘贴文本（AI 解析）</button>
          </div>
          {importMode === "csv" ? (
            <>
              <p>支持飞书多维表格导出的 CSV：表头需包含「模块」「任务」列，可选「负责人」「编号」「上游」「下游」「说明」。</p>
              <input type="file" accept=".csv,.tsv,.txt" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) file.text().then(setContent);
              }} />
            </>
          ) : (
            <p>把分工表、会议纪要或计划文档直接粘到下面，AI 会整理成结构化分工。</p>
          )}
          <textarea
            className="yaml-editor"
            rows={8}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={importMode === "text" ? "例如：\n实验模块由饶铮和颜茳渭负责，其中颜茳渭做被测对象管理；评分与复核由刘燕燕负责……" : ""}
          />
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => void parseImport()} disabled={!content.trim()}>解析预览</button>
          </div>
          {preview && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>模块</th><th>任务</th><th>负责人</th></tr></thead>
                <tbody>
                  {preview.modules.map((module) => module.tasks.map((task, index) => (
                    <tr key={`${module.name}-${task.name}-${index}`}>
                      <td>{module.name}</td><td>{task.name}</td><td>{task.owner ?? "未分配"}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
          <div className="modal-actions">
            <button className="primary-button" disabled={!preview || busy} onClick={() => void applyImport()}>
              <Download size={16} />{busy ? "导入中…" : "确认导入"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-step">
          <h3><Users size={16} /> 第 3 步 · 对齐身份</h3>
          <p>把 Gitee 账号对应到真实成员（多人共用账号时靠提交署名区分）。没有列出的账号说明已自动识别。</p>
          {unresolved.length === 0 ? (
            <p className="confirm-copy">所有 PR 账号都已识别，无需手动对齐。</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Gitee 账号</th><th>PR 数</th><th>提交署名</th><th>对应成员</th></tr></thead>
                <tbody>
                  {unresolved.map((item) => (
                    <tr key={item.login}>
                      <td><code>{item.login}</code></td><td>{item.prs}</td>
                      <td>{item.sampleNames.join("、") || "—"}</td>
                      <td>
                        <select value={aliasChoice[item.login] ?? ""} onChange={(event) => setAliasChoice({ ...aliasChoice, [item.login]: event.target.value })}>
                          <option value="">待认领</option>
                          <IdentityOptions />
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="primary-button" disabled={busy} onClick={() => void saveAliases()}>完成初始化</button>
        </div>
      )}
    </section>
  );
}

function IdentityOptions() {
  const [users, setUsers] = useState<Array<{ id: number; displayName: string }>>([]);
  useEffect(() => { api<Array<{ id: number; displayName: string }>>("/users").then(setUsers).catch(() => setUsers([])); }, []);
  return <>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</>;
}

/* ---------- 任务全景 ---------- */

function Board({ data }: { data: BoardData }) {
  const [ownerFilter, setOwnerFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<BoardTask | null>(null);

  const owners = useMemo(() => {
    const map = new Map<number, string>();
    for (const group of data.groups) for (const task of group.tasks) {
      if (task.ownerUserId && task.ownerName) map.set(task.ownerUserId, task.ownerName);
    }
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [data]);

  const matches = (task: BoardTask) => {
    if (ownerFilter && String(task.ownerUserId ?? "") !== ownerFilter) return false;
    if (stateFilter && task.state !== stateFilter) return false;
    if (keyword && !`${task.name} ${task.key} ${task.ownerName ?? ""}`.toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  };

  return (
    <>
      <section className="metric-grid progress-summary">
        <article className="metric"><span>任务总数</span><strong>{data.summary.total}</strong><ClipboardList size={19} /></article>
        {STATE_ORDER.map((state) => (
          <article key={state} className={`metric progress-metric-${state}`}>
            <span>{STATE_LABELS[state]}</span>
            <strong>{data.summary[state]}</strong>
            <i className={`progress-dot progress-dot-${state}`} />
          </article>
        ))}
      </section>

      <section className="filter-bar panel">
        <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} aria-label="按负责人过滤">
          <option value="">全部成员</option>
          {owners.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
        </select>
        <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="按状态过滤">
          <option value="">全部状态</option>
          {STATE_ORDER.map((state) => <option key={state} value={state}>{STATE_LABELS[state]}</option>)}
        </select>
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索任务 / 编号 / 成员" />
      </section>

      <section className="progress-board">
        {data.groups.map((group) => {
          const visible = group.tasks.filter(matches);
          if (ownerFilter || stateFilter || keyword ? visible.length === 0 : false) return null;
          return (
            <article key={group.name} className="panel progress-group">
              <header className="progress-group-header">
                <h3>{group.name}</h3>
                <span>{group.ownerName ? `负责人 ${group.ownerName}` : "未分配负责人"} · {group.tasks.length} 任务</span>
              </header>
              <div className="progress-tasks">
                {visible.map((task) => (
                  <button key={task.moduleId} className={`progress-task progress-${task.state}`} onClick={() => setSelected(task)} title={`${task.name}（${STATE_LABELS[task.state]}）`}>
                    <strong>{task.name}</strong>
                    <small>
                      {task.ownerName ?? "待认领"}
                      {task.codeMerged > 0 && ` · ${task.codeMerged} 合并`}
                      {task.codeOpen > 0 && ` · ${task.codeOpen} 在飞`}
                      {task.state !== "done" && task.docMerged > 0 && " · RFC 已合"}
                    </small>
                  </button>
                ))}
                {visible.length === 0 && <p className="detail-note">无匹配任务</p>}
              </div>
            </article>
          );
        })}
      </section>

      {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function TaskDrawer({ task, onClose }: { task: BoardTask; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const merged = task.pulls.filter((pull) => pull.state === "merged");
  const flying = task.pulls.filter((pull) => pull.state !== "merged");
  return (
    <aside className="progress-drawer" role="dialog" aria-label="任务详情">
      <header>
        <div>
          <h2>{task.name}</h2>
          <p>{task.key} · 负责人 {task.ownerName ?? "待认领"} · <StatusBadge value={task.state === "done" ? "passed" : task.state === "developing" ? "running" : "queued"} /> {STATE_LABELS[task.state]}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>
      </header>
      <div className="progress-drawer-body">
        <div className="detail-row"><span>文档 PR</span><strong>{task.docMerged} 已合 · {task.docOpen} 在飞</strong></div>
        <div className="detail-row"><span>代码 PR</span><strong>{task.codeMerged} 已合 · {task.codeOpen} 在飞</strong></div>
        <div className="detail-row"><span>最近动态</span><strong>{timeAgo(task.lastActivityAt)}</strong></div>
        <div className="detail-row"><span>PR 账号</span><strong>{task.authorLogins.join("、") || "—"}</strong></div>
        {merged.length > 0 && <h3>已合并</h3>}
        {merged.map((pull) => (
          <a key={pull.number} className="progress-pr" href={pull.url ?? "#"} target="_blank" rel="noreferrer">
            <span>!{pull.number} {pull.title}</span>
            <small>{timeAgo(pull.mergedAt)} · {pull.authorLogin ?? "—"} <ExternalLink size={12} /></small>
          </a>
        ))}
        {flying.length > 0 && <h3>进行中</h3>}
        {flying.map((pull) => (
          <a key={pull.number} className="progress-pr" href={pull.url ?? "#"} target="_blank" rel="noreferrer">
            <span>!{pull.number} {pull.title}</span>
            <small>{pull.state} · {pull.authorLogin ?? "—"} <ExternalLink size={12} /></small>
          </a>
        ))}
        {task.pulls.length === 0 && <p className="detail-note">还没有关联到 PR。补充路径模式或让 PR 标题带上任务编号后重新同步。</p>}
      </div>
    </aside>
  );
}

/* ---------- 个人成长轨迹 ---------- */

function Heatmap({ heat }: { heat: number[][] }) {
  const max = Math.max(1, ...heat.flat());
  const level = (value: number) => value === 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  return (
    <div className="heatmap-wrap">
      <div className="heatmap-hours">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour % 3 === 0 ? hour : ""}</span>)}</div>
      {heat.map((row, day) => (
        <div key={day} className="heatmap-row">
          <span className="heatmap-day">{days[day]}</span>
          {row.map((value, hour) => (
            <i key={hour} className={`heatmap-cell level-${level(value)}`} title={`${days[day]} ${hour} 点 · ${value} 次提交`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function People({ people }: { people: PersonMetrics[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = people.find((person) => person.userId === selectedId) ?? people[0];
  if (!selected) return <EmptyState icon={<Users size={25} />} title="还没有成员数据" text="同步仓库并导入分工后，这里会展示每位成员的成长轨迹。" />;
  return (
    <section className="progress-people">
      <aside className="panel progress-people-list">
        <div className="panel-header"><div><h2>成员</h2><p>{people.length} 人</p></div></div>
        {people.map((person) => (
          <button key={person.userId} className={selected.userId === person.userId ? "run-item active" : "run-item"} onClick={() => setSelectedId(person.userId)}>
            <div><strong>{person.name}</strong><small>{person.tasksDone}/{person.tasksOwned} 任务 · {person.mergedPrs} PR</small></div>
            <UserRound size={16} />
          </button>
        ))}
      </aside>
      <article className="panel progress-person">
        <div className="panel-header">
          <div><h2>{selected.name}</h2><p>提交邮箱：{selected.emails.join("、") || "未对齐"}</p></div>
          <span className={`badge ${selected.tasksDone === selected.tasksOwned && selected.tasksOwned > 0 ? "status-passed" : "status-clarification"}`}>
            {selected.tasksDone}/{selected.tasksOwned} 任务完成
          </span>
        </div>
        <section className="metric-grid">
          <article className="metric"><span>合并 PR</span><strong>{selected.mergedPrs}</strong><RefreshCw size={19} /></article>
          <article className="metric"><span>在飞 PR</span><strong>{selected.openPrs}</strong><RefreshCw size={19} /></article>
          <article className="metric"><span>文档 / 代码 PR</span><strong>{selected.docPrs} / {selected.codePrs}</strong><ClipboardList size={19} /></article>
          <article className="metric"><span>代码量</span><strong>+{selected.additions}/-{selected.deletions}</strong><ClipboardList size={19} /></article>
          <article className="metric"><span>平均合并时长</span><strong>{selected.avgMergeHours === null ? "—" : `${selected.avgMergeHours} 小时`}</strong><RefreshCw size={19} /></article>
          <article className="metric"><span>被 ! 引用</span><strong>{selected.referencedBy}</strong><Users size={19} /></article>
        </section>
        <h3>提交节奏（东八区）</h3>
        <Heatmap heat={selected.heat} />
        <p className="detail-note">共 {selected.commitCount} 次提交；引用他人 PR {selected.referencesOut} 次。评审常见错误分类需要先回填评审评论（见模块文档待办）。</p>
      </article>
    </section>
  );
}

/* ---------- 页面 ---------- */

export default function ProgressPage() {
  const [tab, setTab] = useState<"board" | "people">("board");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [people, setPeople] = useState<PersonMetrics[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const [boardData, peopleData] = await Promise.all([
        api<BoardData>("/progress/board"),
        api<PersonMetrics[]>("/progress/people")
      ]);
      setBoard(boardData);
      setPeople(peopleData);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(); }, []);

  if (!board || !people) {
    return (
      <>
        <PageHeader title="进度" description="任务完成度与个人成长轨迹。" />
        {error ? <div className="alert">{error}</div> : <Loading />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="进度"
        description="merged 才算完成；在飞 PR 是进行中的弱信号。数据来自 Gitee PR 与分工表，点击任务查看证据链。"
        actions={<button className="secondary-button" onClick={() => void load()} disabled={busy}><RefreshCw size={16} />{busy ? "刷新中…" : "刷新"}</button>}
      />
      {error && <div className="alert">{error}</div>}

      {!board.initialized ? (
        <Wizard onDone={() => void load()} />
      ) : (
        <>
          <div className="view-switcher progress-tabs" role="tablist">
            <button className={tab === "board" ? "active" : ""} onClick={() => setTab("board")}>任务全景</button>
            <button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>个人成长轨迹</button>
          </div>
          {tab === "board" ? <Board data={board} /> : <People people={people} />}
        </>
      )}
    </>
  );
}
