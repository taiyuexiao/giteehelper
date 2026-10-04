import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { api } from "../api";

/**
 * 时间线：纵向时间流，精确到秒。
 *
 * - 整体视图：全员事件按时间倒序成一条流，按天分组（日期头吸顶）；
 * - 点击成员 chip = 个人时间线：只有他自己的行为；
 * - 类型徽章 + 左侧轨道圆点标色；事件正文两行截断，点击展开；Gitee 直链；
 * - 滚动分页加载（每次 200 条），日期范围 + 关键词过滤。
 */

type EventType = "push" | "pr_open" | "pr_merged" | "pr_closed" | "comment";

type TimelineEvent = {
  ts: number;
  at: string | null;
  type: EventType;
  actorId: number | null;
  actor: string;
  title: string;
  detail: string | null;
  url: string | null;
  number: number | null;
  sha: string | null;
};

const TYPE_META: Record<EventType, { label: string; color: string; tint: string }> = {
  push: { label: "提交", color: "#5f7fb8", tint: "rgba(95,127,184,0.14)" },
  pr_open: { label: "PR 开启", color: "#39809c", tint: "rgba(57,128,156,0.14)" },
  pr_merged: { label: "PR 合并", color: "#2e9e5b", tint: "rgba(46,158,91,0.16)" },
  pr_closed: { label: "PR 关闭", color: "#98a7ad", tint: "rgba(152,167,173,0.16)" },
  comment: { label: "评论", color: "#db8a2b", tint: "rgba(219,138,43,0.14)" }
};
const ALL_TYPES = Object.keys(TYPE_META) as EventType[];
const PAGE = 200;

const pad = (n: number) => String(n).padStart(2, "0");
function hms(ts: number) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
function dayLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86_400_000);
  const suffix = `（周${WEEKDAYS[date.getDay()]}）`;
  if (key === today) return `今天 · ${m} 月 ${d} 日 ${suffix}`;
  if (key === yesterday) return `昨天 · ${m} 月 ${d} 日 ${suffix}`;
  return `${y} 年 ${m} 月 ${d} 日 ${suffix}`;
}

export default function TimelineTab() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const [types, setTypes] = useState<Set<EventType>>(() => new Set(ALL_TYPES));
  const [keyword, setKeyword] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<TimelineEvent[]>("/progress/timeline").then(setEvents).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const people = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events ?? []) map.set(event.actor, (map.get(event.actor) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const fromTs = fromDay ? Date.parse(`${fromDay}T00:00:00`) : null;
    const toTs = toDay ? Date.parse(`${toDay}T23:59:59`) : null;
    return (events ?? []).filter((event) => {
      if (person && event.actor !== person) return false;
      if (!types.has(event.type)) return false;
      if (fromTs !== null && event.ts < fromTs) return false;
      if (toTs !== null && event.ts > toTs) return false;
      if (kw && !`${event.title} ${event.detail ?? ""} ${event.actor}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [events, person, types, keyword, fromDay, toDay]);

  // 按天分组（流内已经倒序）
  const groups = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const event of filtered.slice(0, limit)) {
      const key = dayKey(event.ts);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered, limit]);

  // 滚动到底自动加载更早的事件
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && limit < filtered.length) {
        setLimit((current) => current + PAGE);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [limit, filtered.length]);

  useEffect(() => { setLimit(PAGE); }, [person, keyword, fromDay, toDay, types]);

  const stats = useMemo(() => {
    const counts: Record<EventType, number> = { push: 0, pr_open: 0, pr_merged: 0, pr_closed: 0, comment: 0 };
    for (const event of filtered) counts[event.type] += 1;
    return counts;
  }, [filtered]);

  if (!events && !error) return null;

  const selected = person ? people.find(([name]) => name === person) : null;

  return (
    <>
      {error && <div className="alert">{error}</div>}

      <section className="panel stream-filters">
        <div className="stream-people" role="group" aria-label="按人筛选">
          <button className={person === null ? "chip active" : "chip"} onClick={() => setPerson(null)}>
            全员<small>{events?.length ?? 0}</small>
          </button>
          {people.map(([name, count]) => (
            <button key={name} className={person === name ? "chip active" : "chip"} onClick={() => setPerson(person === name ? null : name)}>
              <span className="chip-avatar">{name.slice(0, 1)}</span>{name}<small>{count}</small>
            </button>
          ))}
        </div>
        <div className="stream-toolbar">
          <div className="stream-legend" role="group" aria-label="事件类型">
            {ALL_TYPES.map((type) => {
              const meta = TYPE_META[type];
              const on = types.has(type);
              return (
                <button
                  key={type}
                  className={on ? "legend-chip on" : "legend-chip"}
                  style={{ "--chip-color": meta.color } as React.CSSProperties}
                  onClick={() => setTypes((current) => {
                    const next = new Set(current);
                    if (next.has(type)) { next.delete(type); if (next.size === 0) next.add(type); }
                    else next.add(type);
                    return next;
                  })}
                >
                  <i />{meta.label}<small>{stats[type]}</small>
                </button>
              );
            })}
          </div>
          <label className="stream-date"><span>从</span><input type="date" value={fromDay} onChange={(event) => setFromDay(event.target.value)} /></label>
          <label className="stream-date"><span>至</span><input type="date" value={toDay} onChange={(event) => setToDay(event.target.value)} /></label>
          <label className="stream-search"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索内容 / 成员" /></label>
        </div>
        {person && selected && (
          <div className="stream-person-summary">
            <strong>{person}</strong> 的时间线：提交 {stats.push} · PR 开启 {stats.pr_open} · 合并 {stats.pr_merged} · 关闭 {stats.pr_closed} · 评论 {stats.comment}
            <button className="small-button" onClick={() => setPerson(null)}>返回全员</button>
          </div>
        )}
      </section>

      {filtered.length === 0 ? (
        <section className="panel"><div className="empty-state"><h2>没有匹配的事件</h2><p>调整成员、类型或日期范围后重试。</p></div></section>
      ) : (
        <section className="panel stream-panel">
          <div className="stream">
            {groups.map(([key, items]) => (
              <div key={key} className="stream-day">
                <div className="stream-day-head">
                  <span className="stream-day-dot" />
                  <strong>{dayLabel(key)}</strong>
                  <small>{items.length} 条行为</small>
                </div>
                {items.map((event, index) => (
                  <StreamItem key={`${event.type}-${event.ts}-${index}`} event={event} last={index === items.length - 1} />
                ))}
              </div>
            ))}
            <div ref={sentinelRef} className="stream-sentinel">
              {limit < filtered.length ? <span className="loading">加载更早的事件…</span> : <span>已经到最早了 · 共 {filtered.length} 条</span>}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function StreamItem({ event, last }: { event: TimelineEvent; last: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[event.type];
  return (
    <article className={`stream-item${last ? " last" : ""}`}>
      <div className="stream-when">
        <time>{hms(event.ts)}</time>
        <span className="stream-dot" style={{ background: meta.color, boxShadow: `0 0 0 3px ${meta.tint}` }} />
      </div>
      <div className="stream-body">
        <div className="stream-head">
          <span className="type-badge" style={{ background: meta.tint, color: meta.color }}>{meta.label}</span>
          <strong className="stream-actor">{event.actor}</strong>
          <span className="stream-title" onClick={() => setExpanded((current) => !current)}>{event.title}</span>
          {event.url && (
            <a className="stream-link" href={event.url} target="_blank" rel="noreferrer" title="在 Gitee 查看">
              <ExternalLink size={13} />
            </a>
          )}
        </div>
        {event.detail && (
          <p className={`stream-detail${expanded ? " expanded" : ""}`} onClick={() => setExpanded((current) => !current)}>{event.detail}</p>
        )}
      </div>
    </article>
  );
}
