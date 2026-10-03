import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Download, ExternalLink, GitCommitHorizontal, ListChecks, RefreshCw, Users } from "lucide-react";
import { api, downloadFile } from "../api";
import { EmptyState, Loading, Modal, PageHeader, StatusBadge } from "../components";
import TimelineTab from "./TimelineTab";
import type { Role } from "../../shared/types";

type TaskState = "not_started" | "designing" | "designed" | "developing" | "done";

const STATE_LABELS: Record<TaskState, string> = {
  not_started: "未开始",
  designing: "设计中",
  designed: "设计定稿",
  developing: "开发中",
  done: "已完成"
};

type BoardTaskPull = { number: number; title: string; state: string; kind: string; url: string | null; mergedAt: string | null; authorLogin: string | null; evidence: string };
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

type PullDetail = {
  number: number; title: string; state: string; kind: string; authorLogin: string | null;
  authorNames: string[]; authorEmails: string[];
  createdAt: string | null; mergedAt: string | null; hoursToMerge: number | null;
  headRef: string | null; additions: number; deletions: number; fileCount: number; tasks: string[];
};

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
            <span>!{pull.number} {pull.title}{pull.evidence === "ai" && <em className="ai-tag">AI 识别</em>}</span>
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

function weeklyMerged(details: PullDetail[], name: string): Array<{ label: string; count: number }> {
  // 近 12 周（周一对齐），统计该成员名下 merged PR 的落周分布
  const now = new Date();
  const mondayOffset = (now.getUTCDay() + 6) % 7;
  const thisMonday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset);
  const weeks: Array<{ start: number; count: number }> = [];
  for (let index = 11; index >= 0; index -= 1) {
    weeks.push({ start: thisMonday - index * 7 * 86_400_000, count: 0 });
  }
  for (const item of details) {
    if (item.state !== "merged" || !item.authorNames.includes(name) || !item.mergedAt) continue;
    const stamp = Date.parse(item.mergedAt.includes("T") ? item.mergedAt : `${item.mergedAt.replace(" ", "T")}Z`);
    if (!Number.isFinite(stamp)) continue;
    for (let index = weeks.length - 1; index >= 0; index -= 1) {
      if (stamp >= weeks[index].start) {
        weeks[index].count += 1;
        break;
      }
    }
  }
  return weeks.map((week) => ({
    label: `${new Date(week.start).getUTCMonth() + 1}/${new Date(week.start).getUTCDate()}`,
    count: week.count
  }));
}

function BarChart({ data }: { data: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...data.map((item) => item.count));
  return (
    <div className="bar-chart">
      {data.map((item) => (
        <div key={item.label} className="bar-col" title={`${item.label} 那周 · ${item.count} 个`}>
          <span className="bar-value">{item.count || ""}</span>
          <i className={item.count ? "bar-fill" : "bar-fill empty"} style={{ height: `${(item.count / max) * 100}%` }} />
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

/** 提交节奏热力图：行=周日~周六，列=0~23 点（东八区），GitHub Contributions 风格 */
function Heatmap({ heat }: { heat: number[][] }) {
  const max = Math.max(1, ...heat.flat());
  const level = (value: number) => value === 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  let total = 0;
  for (const row of heat) for (const value of row) total += value;
  return (
    <div className="heatmap2">
      <div className="heatmap2-grid">
        <span className="heatmap2-corner" />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="heatmap2-hour">{hour % 3 === 0 ? hour : ""}</span>
        ))}
        {heat.map((row, day) => (
          <div key={day} className="heatmap2-row">
            <span className="heatmap2-day">{days[day]}</span>
            {row.map((value, hour) => (
              <i key={hour} className={`heatmap2-cell l${level(value)}`} title={`${days[day]} ${hour}:00 · ${value} 次提交`} />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap2-footer">
        <span>共 {total} 次提交</span>
        <span className="heatmap2-legend">少
          {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heatmap2-cell l${l}`} />)}
        多</span>
      </div>
    </div>
  );
}

/* ---------- 团队全景：全员指标对比（合并 PR / 文档代码 / 任务完成 / 提交） ---------- */

function TeamOverview({ people, selectedId, onSelect }: { people: PersonMetrics[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const maxMerged = Math.max(1, ...people.map((p) => p.mergedPrs));
  const maxCommits = Math.max(1, ...people.map((p) => p.commitCount));
  const sorted = [...people].sort((a, b) => b.mergedPrs - a.mergedPrs || b.commitCount - a.commitCount);
  return (
    <section className="panel team-overview">
      <div className="panel-header">
        <div><h2>团队全景</h2><p>口径：提交署名邮箱（共用登录账号不计数）；条形按列内最大值归一。</p></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>成员</th><th style={{ width: "22%" }}>合并 PR</th><th style={{ width: "18%" }}>文档 / 代码</th><th style={{ width: "22%" }}>任务完成</th><th style={{ width: "18%" }}>提交</th>
          </tr></thead>
          <tbody>
            {sorted.map((person) => (
              <tr key={person.userId} className={selectedId === person.userId ? "active" : ""} onClick={() => onSelect(person.userId)}>
                <td>
                  <span className="member-row static">
                    <span className="member-avatar">{person.name.slice(0, 1)}</span>
                    <span className="member-copy"><strong>{person.name}</strong><small>{person.emails[0] ?? "未对齐"}</small></span>
                  </span>
                </td>
                <td>
                  <div className="metric-bar">
                    <strong>{person.mergedPrs}</strong>
                    <span className="metric-track"><i className="fill-merged" style={{ width: `${(person.mergedPrs / maxMerged) * 100}%` }} /></span>
                  </div>
                </td>
                <td>
                  <div className="metric-bar">
                    <strong>{person.docPrs}<small>/{person.codePrs}</small></strong>
                    <span className="metric-track mix">
                      <i className="fill-doc" style={{ width: `${person.docPrs + person.codePrs ? (person.docPrs / (person.docPrs + person.codePrs)) * 100 : 0}%` }} />
                      <i className="fill-code" style={{ width: `${person.docPrs + person.codePrs ? (person.codePrs / (person.docPrs + person.codePrs)) * 100 : 0}%` }} />
                    </span>
                  </div>
                </td>
                <td>
                  {person.tasksOwned === 0 ? <small className="none-mark">—</small> : (
                    <div className="metric-bar">
                      <strong>{person.tasksDone}<small>/{person.tasksOwned}</small></strong>
                      <span className="metric-track"><i className="fill-task" style={{ width: `${(person.tasksDone / person.tasksOwned) * 100}%` }} /></span>
                    </div>
                  )}
                </td>
                <td>
                  <div className="metric-bar">
                    <strong>{person.commitCount}</strong>
                    <span className="metric-track"><i className="fill-commit" style={{ width: `${(person.commitCount / maxCommits) * 100}%` }} /></span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- 个人成长轨迹 ---------- */

function People({ people, details }: { people: PersonMetrics[]; details: PullDetail[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const selected = people.find((person) => person.userId === selectedId) ?? people[0];
  if (!selected) return <EmptyState icon={<Users size={25} />} title="还没有成员数据" text="同步仓库并导入分工后，这里会展示每位成员的成长轨迹。" />;

  const weekly = weeklyMerged(details, selected.name);
  const mergedMine = details.filter((item) => item.state === "merged" && item.authorNames.includes(selected.name));
  const docCount = mergedMine.filter((item) => item.kind === "doc").length;
  const codeCount = mergedMine.length - docCount;
  const doneRate = selected.tasksOwned ? Math.round((selected.tasksDone / selected.tasksOwned) * 100) : 0;

  return (
    <>
      <TeamOverview people={people} selectedId={selected.userId} onSelect={setSelectedId} />
      <div className="progress-people">
      <aside className="panel progress-members">
        <div className="panel-header"><div><h2>成员</h2><p>{people.length} 人</p></div></div>
        <div className="progress-member-list">
          {people.map((person) => (
            <button key={person.userId} className={selected.userId === person.userId ? "member-row active" : "member-row"} onClick={() => setSelectedId(person.userId)}>
              <span className="member-avatar">{person.name.slice(0, 1)}</span>
              <span className="member-copy">
                <strong>{person.name}</strong>
                <small>{person.tasksDone}/{person.tasksOwned} 任务 · {person.mergedPrs} PR</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="panel progress-person">
        <header className="progress-person-head">
          <div className="progress-person-id">
            <span className="member-avatar large">{selected.name.slice(0, 1)}</span>
            <div>
              <h2>{selected.name}</h2>
              <p>提交邮箱：{selected.emails.join("、") || "未对齐"}</p>
            </div>
          </div>
          <div className="progress-person-actions">
            <span className={`badge ${selected.tasksDone === selected.tasksOwned && selected.tasksOwned > 0 ? "status-passed" : "status-clarification"}`}>
              任务 {selected.tasksDone}/{selected.tasksOwned}
            </span>
            <button className="secondary-button" onClick={() => setRecordsOpen(true)}>
              <ClipboardList size={16} />查看提交记录
            </button>
          </div>
        </header>

        <div className="task-progress">
          <div className="task-progress-track"><i style={{ width: `${doneRate}%` }} /></div>
          <small>任务完成 {selected.tasksDone}/{selected.tasksOwned}{selected.tasksOwned ? `（${doneRate}%）` : ""}</small>
        </div>

        <section className="metric-grid">
          <article className="metric"><span>合并 PR</span><strong>{selected.mergedPrs}</strong><RefreshCw size={19} /></article>
          <article className="metric"><span>在飞 PR</span><strong>{selected.openPrs}</strong><RefreshCw size={19} /></article>
          <article className="metric"><span>提交次数</span><strong>{selected.commitCount}</strong><GitCommitHorizontal size={19} /></article>
          <article className="metric"><span>代码量</span><strong>+{selected.additions}/-{selected.deletions}</strong><ClipboardList size={19} /></article>
          <article className="metric"><span>平均合并时长</span><strong>{selected.avgMergeHours === null ? "—" : `${selected.avgMergeHours} 小时`}</strong><RefreshCw size={19} /></article>
          <article className="metric"><span>被 ! 引用</span><strong>{selected.referencedBy}</strong><Users size={19} /></article>
        </section>

        <div className="progress-charts">
          <div className="chart-block">
            <h3>合并 PR 走势（近 12 周）</h3>
            <BarChart data={weekly} />
          </div>
          <div className="chart-block">
            <h3>合并 PR 构成</h3>
            {mergedMine.length === 0 ? (
              <p className="detail-note">还没有合并的 PR。</p>
            ) : (
              <>
                <div className="mix-bar">
                  <i className="mix-doc" style={{ width: `${(docCount / mergedMine.length) * 100}%` }} />
                  <i className="mix-code" style={{ width: `${(codeCount / mergedMine.length) * 100}%` }} />
                </div>
                <div className="mix-legend">
                  <span><i className="mix-dot mix-dot-doc" />文档 PR {docCount}</span>
                  <span><i className="mix-dot mix-dot-code" />代码 PR {codeCount}</span>
                </div>
              </>
            )}
            <p className="detail-note">文档 = 只改 docs/ 的 RFC 类 PR；在飞的 {selected.openPrs} 个未计入。</p>
          </div>
        </div>

        <div className="chart-block">
          <h3>提交节奏（东八区）</h3>
          <Heatmap heat={selected.heat} />
        </div>
      </section>

      {recordsOpen && <PullRecordModal details={details} onClose={() => setRecordsOpen(false)} />}
      </div>
    </>
  );
}

/* ---------- 提交记录弹窗（原始明细 + xlsx 导出） ---------- */

function PullRecordModal({ details, onClose }: { details: PullDetail[]; onClose: () => void }) {
  const [stateFilter, setStateFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [exporting, setExporting] = useState(false);

  const authors = useMemo(() => {
    const names = new Set<string>();
    for (const item of details) for (const name of item.authorNames) names.add(name);
    return [...names].sort((a, b) => a.localeCompare(b, "zh"));
  }, [details]);

  const filtered = details.filter((item) => {
    if (stateFilter && item.state !== stateFilter) return false;
    if (authorFilter && !item.authorNames.includes(authorFilter)) return false;
    if (keyword && !`${item.number} ${item.title} ${item.authorNames.join(" ")} ${item.headRef ?? ""}`.toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  });

  async function exportXlsx() {
    setExporting(true);
    try {
      await downloadFile("/progress/export.xlsx", `进度数据-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Modal title={`提交记录（${filtered.length}/${details.length} 个 PR）`} wide onClose={onClose}>
      <div className="progress-records">
        <div className="record-toolbar">
          <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="按状态过滤">
            <option value="">全部状态</option>
            <option value="merged">merged</option>
            <option value="open">open</option>
            <option value="closed">closed</option>
          </select>
          <select value={authorFilter} onChange={(event) => setAuthorFilter(event.target.value)} aria-label="按提交作者过滤">
            <option value="">全部作者</option>
            {authors.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索编号 / 标题 / 分支" />
          <button className="secondary-button" onClick={() => void exportXlsx()} disabled={exporting}>
            <Download size={16} />{exporting ? "生成中…" : "导出 xlsx"}
          </button>
        </div>
        <div className="table-wrap record-table">
          <table>
            <thead><tr>
              <th>编号</th><th>标题</th><th>状态</th><th>提交作者</th><th>创建</th><th>合并</th><th>耗时(h)</th><th>+/-</th><th>文件</th><th>关联任务</th>
            </tr></thead>
            <tbody>
              {filtered.slice(0, 500).map((item) => (
                <tr key={item.number}>
                  <td>!{item.number}</td>
                  <td><div className="cell-main" style={{ maxWidth: 360 }}>{item.title}</div><small>{item.authorLogin ?? "—"}</small></td>
                  <td><span className={`badge ${item.state === "merged" ? "status-passed" : item.state === "open" ? "status-running" : "status-blocked"}`}>{item.state}</span></td>
                  <td>{item.authorNames.join("、") || <small>未识别</small>}</td>
                  <td><small>{item.createdAt?.slice(0, 10) ?? "—"}</small></td>
                  <td><small>{item.mergedAt?.slice(0, 10) ?? "—"}</small></td>
                  <td>{item.hoursToMerge ?? "—"}</td>
                  <td><small>+{item.additions}/-{item.deletions}</small></td>
                  <td>{item.fileCount}</td>
                  <td><small>{item.tasks.slice(0, 2).join("、")}{item.tasks.length > 2 ? ` 等${item.tasks.length}项` : ""}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="detail-note">作者按提交署名邮箱解析（Merge 同步提交不计）；一条 PR 多个作者时每人各计一次。完整数据请导出 xlsx。</p>
      </div>
    </Modal>
  );
}

/* ---------- 页面 ---------- */

export default function ProgressPage() {
  const [tab, setTab] = useState<"board" | "people" | "timeline">("board");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [people, setPeople] = useState<PersonMetrics[] | null>(null);
  const [details, setDetails] = useState<PullDetail[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const [boardData, peopleData, detailData] = await Promise.all([
        api<BoardData>("/progress/board"),
        api<PersonMetrics[]>("/progress/people"),
        api<PullDetail[]>("/progress/pulls")
      ]);
      setBoard(boardData);
      setPeople(peopleData);
      setDetails(detailData);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(); }, []);

  if (!board || !people || !details) {
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
            <button className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")}>时间线</button>
          </div>
          {tab === "board" && <Board data={board} />}
          {tab === "people" && <People people={people} details={details} />}
          {tab === "timeline" && <TimelineTab />}
        </>
      )}
    </>
  );
}
