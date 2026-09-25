import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Clock3, XCircle } from "lucide-react";

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

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} title="关闭">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export function Loading() {
  return <div className="loading">加载中…</div>;
}
