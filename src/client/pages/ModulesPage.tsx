import { useEffect, useState } from "react";
import { Boxes, CheckCircle2, FileCode2, GitBranch, Play, Plus, Save } from "lucide-react";
import { api } from "../api";
import { EmptyState, Loading, Modal, PageHeader, StatusBadge } from "../components";
import type { User } from "../../shared/types";

type ModuleRow = {
  id: number; moduleKey: string; name: string; ownerUserId: number | null; ownerName?: string;
  status: string; paths: string[]; scenarios: string[]; provides: { key: string; version: string }[];
  requires: { key: string; version: string; mode?: string }[]; testCommand?: string; description?: string;
};
type ContractRow = { id: number; contractKey: string; version: string; kind: string; ownerName?: string };

export default function ModulesPage() {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ moduleKey: "", name: "", ownerUserId: "", status: "not_started", paths: "", scenarios: "", description: "", testCommand: "" });

  const load = async () => {
    const [moduleData, contractData, userData] = await Promise.all([
      api<ModuleRow[]>("/modules"), api<ContractRow[]>("/contracts"), api<User[]>("/users")
    ]);
    setModules(moduleData); setContracts(contractData); setUsers(userData);
  };
  useEffect(() => { void load().catch((reason) => setError(String(reason))); }, []);

  async function save() {
    try {
      await api("/modules", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : null,
          paths: form.paths.split("\n").map((value) => value.trim()).filter(Boolean),
          scenarios: form.scenarios.split(",").map((value) => value.trim()).filter(Boolean),
          provides: [], requires: []
        })
      });
      setOpen(false);
      setMessage("模块已创建");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function integrate(module: ModuleRow) {
    try {
      const run = await api<{ id: number; status: string }>(`/modules/${module.id}/integrate`, { method: "POST", body: JSON.stringify({}) });
      setMessage(`${module.name} 联调完成：${run.status}`);
      window.setTimeout(() => window.location.assign(`/runs?run=${run.id}`), 300);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <PageHeader
        title="模块与契约"
        description="维护模块负责人、路径、场景、上下游契约和联调命令。"
        actions={<button className="primary-button" onClick={() => setOpen(true)}><Plus size={16} />新建模块</button>}
      />
      {error && <div className="alert">{error}</div>}
      {message && <div className="success">{message}</div>}

      <section className="panel">
        <div className="panel-header"><div><h2>模块清单</h2><p>点击联调会按一跳依赖和共享场景生成最小组合。</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>模块</th><th>负责人</th><th>状态</th><th>契约</th><th>场景</th><th>操作</th></tr></thead>
            <tbody>
              {modules.map((module) => (
                <tr key={module.id}>
                  <td><div className="module-name"><Boxes size={18} /><div><strong>{module.name}</strong><small>{module.moduleKey}</small></div></div></td>
                  <td>{module.ownerName ?? "未分配"}</td>
                  <td><StatusBadge value={module.status} /></td>
                  <td>
                    <div className="tag-list">
                      {module.provides.map((item) => <span key={item.key} className="tag provides">提供 {item.key}</span>)}
                      {module.requires.map((item) => <span key={item.key} className="tag requires">需要 {item.key}</span>)}
                    </div>
                  </td>
                  <td>{module.scenarios.join("、") || "—"}</td>
                  <td><button className="small-button" onClick={() => void integrate(module)}><Play size={14} />联调</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>契约清单</h2><p>契约是异步开发时的真实对齐依据。</p></div></div>
        {contracts.length === 0 ? (
          <EmptyState icon={<FileCode2 size={25} />} title="还没有契约" text="通过 API 或数据初始化添加接口、事件和数据契约。" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>契约</th><th>版本</th><th>类型</th><th>负责人</th></tr></thead>
              <tbody>{contracts.map((contract) => <tr key={contract.id}><td><strong>{contract.contractKey}</strong></td><td>{contract.version}</td><td>{contract.kind}</td><td>{contract.ownerName ?? "—"}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <Modal title="新建模块" onClose={() => setOpen(false)}>
          <div className="form-grid">
            <label>模块 Key<input value={form.moduleKey} onChange={(e) => setForm({ ...form, moduleKey: e.target.value })} placeholder="order" /></label>
            <label>名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="订单模块" /></label>
            <label>负责人<select value={form.ownerUserId} onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}><option value="">未分配</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label>
            <label>状态<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="not_started">未开始</option><option value="contract_ready">契约就绪</option><option value="code_submitted">代码已交</option><option value="contract_verified">契约已验</option></select></label>
            <label className="full">路径模式（每行一个）<textarea value={form.paths} onChange={(e) => setForm({ ...form, paths: e.target.value })} placeholder={"src/order/**\ndocs/modules/order.md"} /></label>
            <label className="full">共享场景（逗号分隔）<input value={form.scenarios} onChange={(e) => setForm({ ...form, scenarios: e.target.value })} placeholder="checkout-success, refund" /></label>
            <label>测试命令<input value={form.testCommand} onChange={(e) => setForm({ ...form, testCommand: e.target.value })} placeholder="npm test" /></label>
            <label className="full">说明<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setOpen(false)}>取消</button><button className="primary-button" onClick={() => void save()}><Save size={16} />保存</button></div>
        </Modal>
      )}
    </>
  );
}
