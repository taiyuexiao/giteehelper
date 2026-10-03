import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, GitCommitHorizontal, Maximize2, MessageSquare, Minus, Plus, Sparkles } from "lucide-react";
import { api } from "../api";

/**
 * 时间线：单轨可拖动时间轴。
 *
 * 设计取向（这条是用户点名要求的部分）：
 * - 不做每人一条泳道（太乱）：一条主轨 + 顶部按人筛选；
 * - 缩小时相近事件叠成小堆（≤4 个点 + 「+N」角标），点堆放大看细节；
 * - 拖动 = 平移（transform 移动容器，不逐帧重排 DOM），滚轮 = 以光标为中心缩放；
 * - 底部密度导航条：全量范围每日一条，视口框可拖，大范围移动不用一直拖主轨；
 * - 悬停出卡片、点击开右侧抽屉，全链路不离开页面。
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

const TYPE_META: Record<EventType, { label: string; color: string; fill: string }> = {
  push: { label: "提交", color: "#5f7fb8", fill: "rgba(95,127,184,0.16)" },
  pr_open: { label: "PR 开启", color: "#39809c", fill: "rgba(57,128,156,0.16)" },
  pr_merged: { label: "PR 合并", color: "#2e9e5b", fill: "rgba(46,158,91,0.18)" },
  pr_closed: { label: "PR 关闭", color: "#98a7ad", fill: "rgba(152,167,173,0.18)" },
  comment: { label: "评论", color: "#db8a2b", fill: "rgba(219,138,43,0.16)" }
};
const ALL_TYPES = Object.keys(TYPE_META) as EventType[];

const DAY = 86_400_000;
const TRACK_H = 260;
const TRACK_Y = 150;

function fmtTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDay(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

type Cluster = { ts: number; x: number; events: TimelineEvent[] };

export default function TimelineTab() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const [types, setTypes] = useState<Set<EventType>>(() => new Set(ALL_TYPES));
  const [pxPerDay, setPxPerDay] = useState(0);
  const [startTs, setStartTs] = useState(() => Date.now() - 14 * DAY);
  const [hovered, setHovered] = useState<{ cluster: Cluster; x: number } | null>(null);
  const [selected, setSelected] = useState<TimelineEvent | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const dragRef = useRef<{ startX: number; startStartTs: number; moved: boolean } | null>(null);
  const panStyleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<TimelineEvent[]>("/progress/timeline").then(setEvents).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useLayoutEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || 900);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 默认视野：近 14 天
  useEffect(() => {
    if (width && pxPerDay === 0) setPxPerDay(width / 14);
  }, [width, pxPerDay]);

  const people = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events ?? []) map.set(event.actor, (map.get(event.actor) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const filtered = useMemo(() => {
    return (events ?? []).filter((event) => {
      if (person && event.actor !== person) return false;
      return types.has(event.type);
    });
  }, [events, person, types]);

  const stats = useMemo(() => {
    const counts: Record<EventType, number> = { push: 0, pr_open: 0, pr_merged: 0, pr_closed: 0, comment: 0 };
    for (const event of filtered) counts[event.type] += 1;
    return counts;
  }, [filtered]);

  const xOf = useCallback((ts: number) => ((ts - startTs) / DAY) * pxPerDay, [startTs, pxPerDay]);

  // 事件分簇：15px 内的事件叠成一列
  const clusters = useMemo(() => {
    const visible = filtered
      .map((event) => ({ event, x: xOf(event.ts) }))
      .filter((item) => item.x > -200 && item.x < width + 200)
      .sort((a, b) => a.x - b.x);
    const out: Cluster[] = [];
    for (const item of visible) {
      const last = out[out.length - 1];
      if (last && item.x - last.x < 15) {
        last.events.push(item.event);
        last.ts = Math.max(last.ts, item.event.ts);
      } else {
        out.push({ ts: item.event.ts, x: item.x, events: [item.event] });
      }
    }
    return out;
  }, [filtered, xOf, width]);

  // 日期刻度：标签间距 ≥ 64px
  const dayTicks = useMemo(() => {
    const step = Math.max(1, Math.ceil(64 / pxPerDay));
    const ticks: Array<{ x: number; label: string; weekend: boolean; today: boolean }> = [];
    const firstDay = Math.floor(startTs / DAY) * DAY;
    const now = Date.now();
    for (let day = firstDay; xOf(day) < width + 80; day += DAY) {
      const x = xOf(day);
      if (x < -80) continue;
      const date = new Date(day + 8 * 3_600_000); // 东八区的“零点”刻度
      const dayIndex = Math.round(day / DAY) % 7;
      const weekend = dayIndex === 4 || dayIndex === 5; // UTC 偏移下近似，仅视觉轻重
      const isToday = Math.abs(day + 8 * 3_600_000 - (Math.floor((now + 8 * 3_600_000) / DAY) * DAY)) < 1000;
      const offset = Math.round((day - firstDay) / DAY);
      if (offset % step === 0) {
        ticks.push({ x, label: fmtDay(day + 8 * 3_600_000), weekend, today: isToday });
      } else if (step === 1 || x % 1 === 0) {
        ticks.push({ x, label: "", weekend, today: isToday });
      }
    }
    return ticks;
  }, [startTs, pxPerDay, xOf, width]);

  // ---- 拖动平移 ----
  const onPointerDown = (event: React.PointerEvent) => {
    dragRef.current = { startX: event.clientX, startStartTs: startTs, moved: false };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (panStyleRef.current) panStyleRef.current.style.transform = `translateX(${dx}px)`;
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (panStyleRef.current) panStyleRef.current.style.transform = "";
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    if (drag.moved) {
      const oldest = events && events.length ? events[events.length - 1].ts : Date.now() - 365 * DAY;
      setStartTs((current) => Math.min(Math.max(current - (dx / pxPerDay) * DAY, oldest - 400 * DAY), Date.now() + 30 * DAY));
    }
  };

  // 滚轮以光标为中心缩放
  const onWheel = (event: React.WheelEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorTs = startTs + (cursorX / pxPerDay) * DAY;
    const factor = event.deltaY > 0 ? 1 / 1.18 : 1.18;
    const next = Math.min(Math.max(pxPerDay * factor, width / 365), width / 1.2);
    setPxPerDay(next);
    setStartTs(cursorTs - (cursorX / next) * DAY);
  };

  const zoomBy = (factor: number) => {
    const centerTs = startTs + (width / 2 / pxPerDay) * DAY;
    const next = Math.min(Math.max(pxPerDay * factor, width / 365), width / 1.2);
    setPxPerDay(next);
    setStartTs(centerTs - (width / 2 / next) * DAY);
  };
  const fitAll = () => {
    if (!events || !events.length) return;
    const min = events[events.length - 1].ts;
    const max = events[0].ts;
    const span = Math.max(max - min, DAY);
    setPxPerDay(width / (span / DAY) * 0.92);
    setStartTs(min - span * 0.04);
  };
  const jumpToday = () => setStartTs(Date.now() - (width / pxPerDay / 2) * DAY);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events ?? []) {
      const day = Math.floor(event.ts / DAY);
      map.set(String(day), (map.get(String(day)) ?? 0) + 1);
    }
    return map;
  }, [events]);

  const fullRange = useMemo(() => {
    if (!events || !events.length) return null;
    return { min: events[events.length - 1].ts, max: events[0].ts };
  }, [events]);

  if (!events && !error) return null;

  return (
    <>
      {error && <div className="alert">{error}</div>}

      <section className="panel timeline-panel">
        <div className="panel-header">
          <div>
            <h2>时间线</h2>
            <p>拖动平移 · 滚轮缩放 · 点事件看详情。当前 {filtered.length} 条（{stats.push} 提交 · {stats.pr_merged} 合并 · {stats.comment} 评论）</p>
          </div>
          <div className="timeline-actions">
            <button className="icon-button" title="缩小" onClick={() => zoomBy(1 / 1.4)}><Minus size={15} /></button>
            <button className="icon-button" title="放大" onClick={() => zoomBy(1.4)}><Plus size={15} /></button>
            <button className="secondary-button" onClick={fitAll}><Maximize2 size={14} />适配全部</button>
            <button className="secondary-button" onClick={jumpToday}><Sparkles size={14} />今天</button>
          </div>
        </div>

        <div className="timeline-filters">
          <div className="timeline-people" role="group" aria-label="按人筛选">
            <button className={person === null ? "chip active" : "chip"} onClick={() => setPerson(null)}>全部</button>
            {people.map(([name, count]) => (
              <button key={name} className={person === name ? "chip active" : "chip"} onClick={() => setPerson(person === name ? null : name)}>
                <span className="chip-avatar">{name.slice(0, 1)}</span>{name}<small>{count}</small>
              </button>
            ))}
          </div>
          <div className="timeline-legend" role="group" aria-label="事件类型">
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
        </div>

        <div
          ref={trackRef}
          className="timeline-track"
          style={{ height: TRACK_H }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <div ref={panStyleRef} className="timeline-pan">
            <div className="timeline-line" style={{ top: TRACK_Y }} />
            {dayTicks.map((tick, index) => (
              <div key={index} className={tick.today ? "timeline-tick today" : tick.weekend ? "timeline-tick weekend" : "timeline-tick"} style={{ left: tick.x, top: TRACK_Y }}>
                {tick.label && <span>{tick.label}</span>}
              </div>
            ))}
            {clusters.map((cluster) => {
              const shown = cluster.events.slice(0, 4);
              const extra = cluster.events.length - shown.length;
              return (
                <div key={`${cluster.ts}-${Math.round(cluster.x)}`} className="timeline-cluster">
                  {shown.map((event, index) => {
                    const meta = TYPE_META[event.type];
                    return (
                      <button
                        key={index}
                        className="timeline-dot"
                        title={`${fmtTime(event.ts)} ${event.actor}`}
                        style={{
                          left: cluster.x,
                          top: TRACK_Y - 9 - index * 17,
                          background: meta.color,
                          boxShadow: `0 0 0 2.5px ${meta.fill}`
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => { if (!dragRef.current?.moved) setSelected(event); }}
                        onMouseEnter={() => setHovered({ cluster, x: cluster.x })}
                        onMouseLeave={() => setHovered(null)}
                      />
                    );
                  })}
                  {extra > 0 && (
                    <button
                      className="timeline-dot more"
                      style={{ left: cluster.x, top: TRACK_Y - 9 - shown.length * 17 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (!dragRef.current?.moved) zoomBy(1.8);
                      }}
                      onMouseEnter={() => setHovered({ cluster, x: cluster.x })}
                      onMouseLeave={() => setHovered(null)}
                    >+{extra}</button>
                  )}
                </div>
              );
            })}
            <div className="timeline-now" style={{ left: xOf(Date.now()), top: TRACK_Y }}><span>现在</span></div>
          </div>

          {hovered && (
            <div
              className="timeline-hover"
              style={{
                left: Math.min(Math.max(hovered.x, 150), width - 150),
                top: Math.max(TRACK_Y - 20 - hovered.cluster.events.length * 17 - 90, 8)
              }}
            >
              {hovered.cluster.events.slice(0, 3).map((event, index) => (
                <div key={index} className="hover-row">
                  <i style={{ background: TYPE_META[event.type].color }} />
                  <span>{TYPE_META[event.type].label} · {event.actor} · {fmtTime(event.ts)}</span>
                </div>
              ))}
              <strong>{hovered.cluster.events[0].title}</strong>
              {hovered.cluster.events.length > 3 && <small>…共 {hovered.cluster.events.length} 条</small>}
            </div>
          )}
        </div>

        {fullRange && (
          <div className="timeline-minimap">
            <div className="minimap-bars">
              {(() => {
                const span = fullRange.max - fullRange.min + DAY;
                const days = Math.min(Math.ceil(span / DAY), 400);
                const maxCount = Math.max(1, ...counts.values());
                return Array.from({ length: days }, (_, index) => {
                  const day = String(Math.floor(fullRange.min / DAY) + index);
                  const count = counts.get(day) ?? 0;
                  return <i key={index} className={count ? "minimap-bar" : "minimap-bar empty"} style={{ height: `${Math.max((count / maxCount) * 22, 2)}px` }} />;
                });
              })()}
            </div>
            <div
              className="minimap-view"
              style={(() => {
                const span = fullRange.max - fullRange.min + DAY;
                const left = ((startTs - fullRange.min) / span) * 100;
                const w = ((width / pxPerDay) * DAY / span) * 100;
                return { left: `${Math.max(0, Math.min(left, 100))}%`, width: `${Math.max(2, Math.min(w, 100))}%` };
              })()}
              onPointerDown={(event) => {
                event.stopPropagation();
                const rect = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                const span = fullRange.max - fullRange.min + DAY;
                const move = (e: PointerEvent) => {
                  const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
                  setStartTs(fullRange.min + ratio * span - ((width / pxPerDay) * DAY) / 2);
                };
                const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
            <span className="minimap-label">{fmtDay(fullRange.min)} ~ {fmtDay(fullRange.max)}</span>
          </div>
        )}
      </section>

      {selected && <TimelineDrawer event={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function TimelineDrawer({ event, onClose }: { event: TimelineEvent; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const meta = TYPE_META[event.type];
  return (
    <aside className="progress-drawer" role="dialog" aria-label="事件详情">
      <header>
        <div>
          <h2>{event.title}</h2>
          <p>
            <span className="legend-chip on" style={{ "--chip-color": meta.color } as React.CSSProperties}><i />{meta.label}</span>
          </p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>
      </header>
      <div className="progress-drawer-body">
        <div className="detail-row"><span>时间</span><strong>{fmtTime(event.ts)}</strong></div>
        <div className="detail-row"><span>成员</span><strong>{event.actor}</strong></div>
        {event.sha && <div className="detail-row"><span>提交</span><strong>{event.sha}</strong></div>}
        {event.number && <div className="detail-row"><span>PR</span><strong>!{event.number}</strong></div>}
        {event.detail && <h3>内容</h3>}
        {event.detail && <p className="detail-summary">{event.detail}</p>}
        {event.url && (
          <a className="primary-button drawer-link" href={event.url} target="_blank" rel="noreferrer">
            在 Gitee 查看{event.type === "push" ? "提交" : event.type === "comment" ? "评论" : "PR"} <ExternalLink size={14} />
          </a>
        )}
        {event.type === "push" && <p className="detail-note"><GitCommitHorizontal size={13} /> 提交事件按署名邮箱归属作者</p>}
        {event.type === "comment" && <p className="detail-note"><MessageSquare size={13} /> 评审评论来自 Gitee 会话/行内评论</p>}
      </div>
    </aside>
  );
}
