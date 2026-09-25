import { useState } from "react";
import { GitMerge, LogIn, ShieldCheck } from "lucide-react";
import { api, setToken } from "../api";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ token: string }>("/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      setToken(result.token);
      onLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-mark"><GitMerge size={30} /></div>
        <span>GiteeHelper</span>
        <h1>让上游变化<br />准确抵达下游</h1>
        <p>影响分析、增量联调、冲突修复与协作审计，在 Gitee 和飞书之间建立可信闭环。</p>
        <div className="login-points">
          <div><ShieldCheck size={18} /> 本地自托管与最小权限</div>
          <div><GitMerge size={18} /> 真实集成和契约验证分开记录</div>
        </div>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow">Administrator access</span>
          <h2>登录控制台</h2>
          <p>使用 GiteeHelper 管理员账号进入项目控制台。</p>
          <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
          <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
          {error && <div className="alert">{error}</div>}
          <button className="primary-button" disabled={busy}><LogIn size={17} />{busy ? "登录中…" : "登录"}</button>
        </form>
      </section>
    </main>
  );
}
