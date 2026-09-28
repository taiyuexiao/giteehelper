import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, CircleHelp, Clock3, XCircle } from "lucide-react";

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function SeverityBadge({ value }: { value: string }) {
  const labels: Record<string, string> = {
    blocking: "阻塞",
    contract: "契约",
    implementation: "实现",
    clarification: "待澄清",
    informational: "提示"
  };
  return <span className={`badge severity-${value}`}>{labels[value] ?? value}</span>;
}

export function StatusBadge({ value }: { value: string }) {
  const labels: Record<string, string> = {
    open: "待处理",
    acknowledged: "已确认",
    resolved: "已解决",
    ignored: "已忽略",
    passed: "通过",
    failed: "失败",
    blocked: "阻塞",
    running: "运行中",
    queued: "排队",
    draft: "草稿",
    tested: "已测试",
    approved: "已批准",
    not_started: "未开始",
    contract_ready: "契约就绪",
    code_submitted: "代码已交",
    contract_verified: "契约已验",
    slice_integrated: "切片联调",
    release_ready: "发布就绪"
  };
  const Icon = value === "passed" || value === "release_ready" ? CheckCircle2 :
    value === "failed" || value === "blocked" ? XCircle :
    value === "running" ? CircleDot : value === "queued" ? Clock3 : AlertTriangle;
  return <span className={`badge status-${value}`}><Icon size={13} />{labels[value] ?? value}</span>;
}

export function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

export function HelpTooltip({ label, children }: { label: string; children: ReactNode }) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ top: -9999, left: -9999, visibility: "hidden" });
  const [arrowX, setArrowX] = useState(18);

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tooltipRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    const gap = 10;
    const margin = 12;
    const width = Math.min(390, window.innerWidth - margin * 2);
    let left = trigger.left + trigger.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    let top = trigger.bottom + gap;
    if (top + tooltip.height > window.innerHeight - margin) {
      top = Math.max(margin, trigger.top - tooltip.height - gap);
    }

    setPosition({ top, left, width, visibility: "visible" });
    setArrowX(Math.max(16, Math.min(trigger.left + trigger.width / 2 - left, width - 16)));
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="help-tooltip"
        aria-label={`${label}说明`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => { clearCloseTimer(); setOpen(true); }}
        onMouseLeave={scheduleClose}
        onFocus={() => { clearCloseTimer(); setOpen(true); }}
        onBlur={scheduleClose}
        onClick={() => { clearCloseTimer(); setOpen(true); }}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
      >
        <CircleHelp size={12} />
      </button>
      {open && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className="help-tooltip-content"
          role="tooltip"
          style={{ ...position, "--arrow-x": `${arrowX}px` } as CSSProperties}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
          {children}
        </div>,
        document.body
      )}
    </>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button ref={closeRef} className="icon-button" onClick={onClose} title="关闭" aria-label="关闭">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export function Loading() {
  return <div className="loading">加载中…</div>;
}
