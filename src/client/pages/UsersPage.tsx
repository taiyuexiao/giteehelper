import { useEffect, useState } from "react";
import { KeyRound, Plus, Save, ShieldCheck, UserRound } from "lucide-react";
import { api } from "../api";
import { Loading, Modal, PageHeader } from "../components";
import type { Role, User } from "../../shared/types";

const roles: Role[] = ["admin", "maintainer", "reviewer", "developer", "observer"];
const roleLabels: Record<Role, string> = { admin: "管理员", maintainer: "维护者", reviewer: "审查者", developer: "开发者", observer: "观察者" };

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", displayName: "", role: "developer", email: "", giteeLogin: "", feishuUserId: "", password: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = () => api<User[]>("/users").then(setUsers).catch((reason) => setError(String(reason)));
  useEffect(() => { void load(); }, []);

  async function saveUser() {
    try {
      const payload = { ...form, role: form.role as Role };
      if (creating) await api("/users", { method: "POST", body: JSON.stringify(payload) });
      else if (editing) await api(`/users/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      setCreating(false); setEditing(null); setMessage("用户已保存"); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function openEdit(user: User) {
    setEditing(user); setCreating(false);
    setForm({ username: user.username, displayName: user.displayName, role: user.role, email: user.email ?? "", giteeLogin: user.giteeLogin ?? "", feishuUserId: user.feishuUserId ?? "", password: "" });
  }

  function openCreate() {
    setCreating(true); setEditing(null);
    setForm({ username: "", displayName: "", role: "developer", email: "", giteeLogin: "", feishuUserId: "", password: "" });
  }

  return (
    <>
      <PageHeader title="用户与身份" description="管理产品角色、Gitee 登录名和飞书身份映射。" actions={<button className="primary-button" onClick={openCreate}><Plus size={16} />新建用户</button>} />
      {error && <div className="alert">{error}</div>}
      {message && <div className="success">{message}</div>}
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>用户</th><th>角色</th><th>Gitee</th><th>飞书</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><div className="module-name"><UserRound size={18} /><div><strong>{user.displayName}</strong><small>{user.username} · {user.email ?? "无邮箱"}</small></div></div></td>
                  <td><span className={`role role-${user.role}`}><ShieldCheck size={14} />{roleLabels[user.role]}</span></td>
                  <td>{user.giteeLogin ?? "—"}</td>
                  <td>{user.feishuUserId ?? "—"}</td>
                  <td><span className={`badge ${user.active ? "status-passed" : "status-blocked"}`}>{user.active ? "启用" : "停用"}</span></td>
                  <td><button className="small-button" onClick={() => openEdit(user)}><KeyRound size={14} />编辑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {(creating || editing) && (
        <Modal title={creating ? "新建用户" : `编辑 ${editing?.displayName}`} onClose={() => { setCreating(false); setEditing(null); }}>
          <div className="form-grid">
            <label>用户名<input value={form.username} disabled={!creating} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
            <label>显示名称<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
            <label>角色<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
            <label>邮箱<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>Gitee 登录名<input value={form.giteeLogin} onChange={(e) => setForm({ ...form, giteeLogin: e.target.value })} /></label>
            <label>飞书用户 ID<input value={form.feishuUserId} onChange={(e) => setForm({ ...form, feishuUserId: e.target.value })} /></label>
            <label className="full">{creating ? "初始密码" : "重置密码（留空不修改）"}<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          </div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => { setCreating(false); setEditing(null); }}>取消</button><button className="primary-button" onClick={() => void saveUser()}><Save size={16} />保存</button></div>
        </Modal>
      )}
    </>
  );
}
