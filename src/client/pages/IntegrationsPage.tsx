import { useEffect, useState } from "react";
import {
  CheckCircle2, CloudCog, Eye, EyeOff, GitBranch, KeyRound, LockKeyhole,
  MessageSquare, RefreshCw, Save, ServerCog, ShieldCheck
} from "lucide-react";
import { api } from "../api";
import { HelpTooltip, Loading, PageHeader } from "../components";

type Project = { id: number; name: string; giteeRepo: string | null; defaultBranch: string; feishuChatId: string | null };
type Settings = {
  giteeApiBase: string;
  giteeRepo: string;
  giteeDefaultBranch: string;
  giteeTokenConfigured: boolean;
  giteeWebhookSecretConfigured: boolean;
  feishuWebhookConfigured: boolean;
};
type IntegrationStatus = {
  gitee: { configured: boolean; apiBase: string; repo: string | null; defaultBranch: string; webhookSecret: boolean };
  feishu: { configured: boolean; mode: string };
  settings: Settings;
};

type FormState = {
  giteeApiBase: string;
  giteeToken: string;
  giteeWebhookSecret: string;
  giteeRepo: string;
  giteeDefaultBranch: string;
  feishuWebhookUrl: string;
};

function TextField({ label, value, onChange, placeholder, hint, help }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string; help?: React.ReactNode;
}) {
  return (
    <label className="settings-field">
      <span>{label}{help && <HelpTooltip label={label}>{help}</HelpTooltip>}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function SecretField({ label, value, configured, onChange }: {
  label: string; value: string; configured: boolean; onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="settings-field secret-field">
      <span><LockKeyhole size={13} />{label}</span>
      <div className="secret-input">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={configured ? "已配置，留空保持不变" : "未配置，填写新值"}
          autoComplete="new-password"
        />
        <button type="button" className="icon-button" title={visible ? "隐藏" : "显示"} onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      <small>{configured ? "不会回显原值；留空则保持当前配置" : "保存后才会写入服务器端 Secret Store"}</small>
    </label>
  );
}

function RepoHelp() {
  return (
    <div className="help-tooltip-copy">
      <h3>目标仓库填写格式</h3>
      <p>请填写 Gitee 仓库的完整路径，格式为 <code>命名空间/仓库名</code>。命名空间可以是企业空间、组织或个人账号。</p>
      <div className="help-example">
        <span>企业空间仓库</span>
        <code>https://gitee.com/shanghai-bank_1/agent-evaluation-platform</code>
        <strong>shanghai-bank_1/agent-evaluation-platform</strong>
      </div>
      <div className="help-example">
        <span>个人账号仓库</span>
        <code>https://gitee.com/mortisspl/test</code>
        <strong>mortisspl/test</strong>
      </div>
      <p className="help-warning">请勿仅填写 <code>test</code>。缺少命名空间时，Gitee API 无法唯一定位目标仓库。</p>
    </div>
  );
}

export default function IntegrationsPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [form, setForm] = useState<FormState>({
    giteeApiBase: "", giteeToken: "", giteeWebhookSecret: "", giteeRepo: "", giteeDefaultBranch: "main", feishuWebhookUrl: ""
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [projectData, statusData] = await Promise.all([api<Project>("/project"), api<IntegrationStatus>("/integrations")]);
    setProject(projectData);
    setStatus(statusData);
    setForm({
      giteeApiBase: statusData.settings.giteeApiBase,
      giteeToken: "",
      giteeWebhookSecret: "",
      giteeRepo: statusData.settings.giteeRepo,
      giteeDefaultBranch: statusData.settings.giteeDefaultBranch,
      feishuWebhookUrl: ""
    });
  };

  useEffect(() => { void load().catch((reason) => setError(String(reason))); }, []);

  async function save() {
    if (!project) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          giteeApiBase: form.giteeApiBase,
          giteeToken: form.giteeToken,
          giteeWebhookSecret: form.giteeWebhookSecret,
          giteeRepo: form.giteeRepo,
          giteeDefaultBranch: form.giteeDefaultBranch,
          feishuWebhookUrl: form.feishuWebhookUrl
        })
      });
      await api("/project", {
        method: "PATCH",
        body: JSON.stringify({
          name: project.name,
          giteeRepo: form.giteeRepo,
          defaultBranch: form.giteeDefaultBranch,
          feishuChatId: project.feishuChatId
        })
      });
      await load();
      setMessage("配置已保存。敏感值只在服务器端保存，不会回显。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function test(kind: "gitee" | "feishu") {
    setMessage("");
    setError("");
    try {
      const result = await api<{ ok?: boolean; dryRun?: boolean; login?: string }>(`/integrations/${kind}/test`, { method: "POST", body: JSON.stringify({}) });
      setMessage(result.dryRun ? "飞书未配置，已完成 dry-run。" : `${kind === "gitee" ? "Gitee" : "飞书"}连接测试成功${result.login ? `：${result.login}` : ""}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (!project || !status) return <Loading />;

  return (
    <>
      <PageHeader
        title="接入设置"
        description="所有接入参数都可以在这里配置；敏感值保存在服务器端，浏览器不回显原文。"
        actions={<button className="primary-button" onClick={() => void save()} disabled={saving}><Save size={16} />{saving ? "保存中…" : "保存全部配置"}</button>}
      />
      {error && <div className="alert">{error}</div>}
      {message && <div className="success">{message}</div>}

      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-icon gitee"><GitBranch size={21} /></div>
          <div><h2>Gitee 连接</h2><p>API、仓库和 WebHook 校验参数。</p></div>
          <span className={`badge ${status.settings.giteeTokenConfigured ? "status-passed" : "status-blocked"}`}>
            {status.settings.giteeTokenConfigured ? "Token 已配置" : "Token 未配置"}
          </span>
          <button className="secondary-button" onClick={() => void test("gitee")}><RefreshCw size={15} />测试连接</button>
        </div>
        <div className="settings-grid">
          <TextField label="Gitee API Base" value={form.giteeApiBase} onChange={(value) => setForm({ ...form, giteeApiBase: value })} placeholder="https://gitee.com/api/v5" hint="支持 Gitee.com、企业版或私有化 API 地址。" />
          <TextField label="目标仓库" value={form.giteeRepo} onChange={(value) => setForm({ ...form, giteeRepo: value })} placeholder="owner/repository" hint="用于读取 PR、回写评论和创建修复 PR。" help={<RepoHelp />} />
          <TextField label="约定主分支" value={form.giteeDefaultBranch} onChange={(value) => setForm({ ...form, giteeDefaultBranch: value })} placeholder="main" hint="修复 PR 默认以此分支为目标。" />
          <SecretField label="Gitee Private Access Token" value={form.giteeToken} configured={status.settings.giteeTokenConfigured} onChange={(value) => setForm({ ...form, giteeToken: value })} />
          <SecretField label="WebHook Secret" value={form.giteeWebhookSecret} configured={status.settings.giteeWebhookSecretConfigured} onChange={(value) => setForm({ ...form, giteeWebhookSecret: value })} />
          <div className="settings-note">
            <ShieldCheck size={18} />
            <div><strong>WebHook 回调</strong><span>https://你的公网域名/api/webhooks/gitee</span></div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-icon feishu"><MessageSquare size={21} /></div>
          <div><h2>飞书通知</h2><p>群机器人 Webhook 与通知测试。</p></div>
          <span className={`badge ${status.settings.feishuWebhookConfigured ? "status-passed" : "status-clarification"}`}>
            {status.settings.feishuWebhookConfigured ? "已配置" : "Dry-run"}
          </span>
          <button className="secondary-button" onClick={() => void test("feishu")}><RefreshCw size={15} />发送测试</button>
        </div>
        <div className="settings-grid">
          <SecretField label="飞书机器人 Webhook" value={form.feishuWebhookUrl} configured={status.settings.feishuWebhookConfigured} onChange={(value) => setForm({ ...form, feishuWebhookUrl: value })} />
          <div className="settings-note">
            <MessageSquare size={18} />
            <div><strong>未配置时</strong><span>通知只写入 dry-run 审计，不会发送外部消息。</span></div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-icon project"><CloudCog size={21} /></div>
          <div><h2>项目配置</h2><p>项目名称、仓库和通知目标。</p></div>
        </div>
        <div className="project-config-grid">
          <TextField label="项目名称" value={project.name} onChange={(value) => setProject({ ...project, name: value })} />
          <TextField label="项目仓库" value={form.giteeRepo} onChange={(value) => setForm({ ...form, giteeRepo: value })} placeholder="owner/repository" help={<RepoHelp />} />
          <TextField label="主分支" value={form.giteeDefaultBranch} onChange={(value) => setForm({ ...form, giteeDefaultBranch: value })} />
          <TextField label="飞书目标会话" value={project.feishuChatId ?? ""} onChange={(value) => setProject({ ...project, feishuChatId: value })} placeholder="群 ID 或会话标识" hint="当前 MVP 主要使用群机器人 Webhook。" />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-icon runtime"><ServerCog size={21} /></div>
          <div><h2>运行时状态</h2><p>服务级配置不通过 Web 修改，避免运行中更换端口或数据库路径。</p></div>
        </div>
        <div className="runtime-grid">
          <div><span>API 地址</span><strong>{window.location.origin}</strong></div>
          <div><span>配置模式</span><strong>Server-side Secret Store</strong></div>
          <div><span>Gitee WebHook</span><strong>{status.gitee.webhookSecret ? "Secret 已配置" : "待配置"}</strong></div>
          <div><span>飞书模式</span><strong>{status.feishu.mode === "webhook" ? "真实发送" : "Dry-run"}</strong></div>
        </div>
      </section>
    </>
  );
}
