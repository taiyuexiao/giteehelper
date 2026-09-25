import { useEffect, useState } from "react";
import { CheckCircle2, CloudCog, GitBranch, MessageSquare, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { Loading, PageHeader } from "../components";

type Project = { id: number; name: string; giteeRepo: string | null; defaultBranch: string; feishuChatId: string | null };
type IntegrationStatus = {
  gitee: { configured: boolean; apiBase: string; repo: string | null; webhookSecret: boolean };
  feishu: { configured: boolean; mode: string };
};

export default function IntegrationsPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    const [projectData, statusData] = await Promise.all([api<Project>("/project"), api<IntegrationStatus>("/integrations")]);
    setProject(projectData); setStatus(statusData);
  };
  useEffect(() => { void load().catch((reason) => setError(String(reason))); }, []);

  async function saveProject() {
    if (!project) return;
    try {
      await api("/project", { method: "PATCH", body: JSON.stringify(project) });
      setMessage("项目接入配置已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function test(kind: "gitee" | "feishu") {
    setMessage("");
    try {
      const result = await api<{ ok?: boolean; dryRun?: boolean; login?: string; error?: string }>(`/integrations/${kind}/test`, { method: "POST", body: JSON.stringify({}) });
      setMessage(result.dryRun ? "飞书未配置，已完成 dry-run。" : `${kind === "gitee" ? "Gitee" : "飞书"}连接测试成功${result.login ? `：${result.login}` : ""}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (!project || !status) return <Loading />;
  return (
    <>
      <PageHeader title="接入设置" description="配置项目仓库、Gitee WebHook、飞书通知和最小权限连接。" />
      {error && <div className="alert">{error}</div>}
      {message && <div className="success">{message}</div>}

      <section className="integration-grid">
        <article className="panel integration-card">
          <div className="integration-title"><GitBranch size={22} /><div><h2>Gitee</h2><p>{status.gitee.apiBase}</p></div><span className={`badge ${status.gitee.configured ? "status-passed" : "status-blocked"}`}>{status.gitee.configured ? "已配置" : "未配置"}</span></div>
          <div className="check-list">
            <span><CheckCircle2 size={16} />API Token 仅从 `.env` 读取</span>
            <span className={status.gitee.webhookSecret ? "ok" : "warn"}><ShieldCheck size={16} />WebHook 签名密钥 {status.gitee.webhookSecret ? "已配置" : "待配置"}</span>
            <span><CloudCog size={16} />回调：`/api/webhooks/gitee`</span>
          </div>
          <button className="secondary-button" onClick={() => void test("gitee")}><RefreshCw size={16} />测试 Gitee</button>
        </article>

        <article className="panel integration-card">
          <div className="integration-title"><MessageSquare size={22} /><div><h2>飞书</h2><p>{status.feishu.mode === "webhook" ? "群机器人 Webhook" : "Dry-run 模式"}</p></div><span className={`badge ${status.feishu.configured ? "status-passed" : "status-clarification"}`}>{status.feishu.configured ? "已配置" : "待配置"}</span></div>
          <div className="check-list">
            <span><CheckCircle2 size={16} />未配置时只记录 dry-run 审计</span>
            <span><ShieldCheck size={16} />不发送完整私有代码</span>
            <span><MessageSquare size={16} />高影响才升级私聊</span>
          </div>
          <button className="secondary-button" onClick={() => void test("feishu")}><RefreshCw size={16} />发送测试消息</button>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>项目配置</h2><p>设置约定主分支和 Gitee 仓库 `owner/repo`。</p></div><button className="primary-button" onClick={() => void saveProject()}><Save size={16} />保存</button></div>
        <div className="form-grid">
          <label className="full">项目名称<input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} /></label>
          <label>Gitee 仓库<input value={project.giteeRepo ?? ""} onChange={(e) => setProject({ ...project, giteeRepo: e.target.value })} placeholder="owner/repository" /></label>
          <label>约定主分支<input value={project.defaultBranch} onChange={(e) => setProject({ ...project, defaultBranch: e.target.value })} /></label>
          <label>飞书目标会话<input value={project.feishuChatId ?? ""} onChange={(e) => setProject({ ...project, feishuChatId: e.target.value })} /></label>
        </div>
      </section>

      <section className="panel setup-guide">
        <h2>接入检查清单</h2>
        <ol>
          <li>在 `.env` 中配置 `GITEE_TOKEN` 和 `GITEE_WEBHOOK_SECRET`，不要提交到 Git。</li>
          <li>在 Gitee 仓库 WebHook 中配置服务回调和 Secret，勾选 Push、Pull Request、评论和 Issue。</li>
          <li>在飞书群创建 Custom Bot，将 Webhook URL 写入 `FEISHU_WEBHOOK_URL`。</li>
          <li>使用测试按钮验证 Gitee API 与飞书发送；WebHook 可用真实 PR 做一次端到端测试。</li>
        </ol>
      </section>
    </>
  );
}
