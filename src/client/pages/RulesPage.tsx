import { useEffect, useState } from "react";
import { FlaskConical, Play, Plus, Save, SlidersHorizontal } from "lucide-react";
import YAML from "yaml";
import { api } from "../api";
import { Loading, Modal, PageHeader, SeverityBadge } from "../components";

type RuleRow = {
  id: number; ruleKey: string; name: string; enabled: boolean; severity: string;
  trigger: Record<string, unknown>; condition: Record<string, unknown>; action: Record<string, unknown>;
  version: number; updatedAt: string;
};

const blank = {
  ruleKey: "", name: "", enabled: true, severity: "clarification",
  trigger: { eventTypes: ["pull_request"], branches: ["main"] },
  condition: { keywords: ["必须"] },
  action: { route: ["owner"], nextAction: "确认变化影响" }
};

export default function RulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [editing, setEditing] = useState<RuleRow | typeof blank | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = () => api<RuleRow[]>("/rules").then(setRules).catch((reason) => setError(String(reason)));
  useEffect(() => { void load(); }, []);

  function edit(rule: RuleRow | typeof blank) {
    setEditing(rule);
    setYamlText(YAML.stringify({
      ruleKey: rule.ruleKey, name: rule.name, enabled: rule.enabled, severity: rule.severity,
      trigger: rule.trigger, condition: rule.condition, action: rule.action
    }, { indent: 2 }));
  }

  async function save() {
    if (!editing) return;
    try {
      const parsed = YAML.parse(yamlText);
      if ("id" in editing) await api(`/rules/${editing.id}`, { method: "PATCH", body: JSON.stringify(parsed) });
      else await api("/rules", { method: "POST", body: JSON.stringify(parsed) });
      setEditing(null); setMessage("规则已保存并生成新版本"); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function runPreview() {
    try {
      const result = await api<{ impacts: Array<{ reason: string; severity: string }> }>("/rules/preview", {
        method: "POST", body: JSON.stringify({ event: { title: "规范要求接口字段统一", eventType: "pull_request", action: "merged", branch: "main", payload: { files: ["docs/specs/api.md"], body: "接口字段必须统一" } } })
      });
      setPreview(JSON.stringify(result.impacts, null, 2));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (!rules) return <Loading />;
  return (
    <>
      <PageHeader title="规则编辑器" description="规则采用版本化配置；保存会增加版本号并写入审计。" actions={<button className="primary-button" onClick={() => edit(blank)}><Plus size={16} />新建规则</button>} />
      {error && <div className="alert">{error}</div>}
      {message && <div className="success">{message}</div>}
      <section className="panel">
        <div className="panel-header"><div><h2>影响规则</h2><p>条件同时命中时采用最高严重度。</p></div><button className="secondary-button" onClick={() => void runPreview()}><FlaskConical size={16} />运行预览</button></div>
        <div className="rule-list">
          {rules.map((rule) => (
            <article key={rule.id} className={rule.enabled ? "rule-item" : "rule-item disabled"}>
              <div className="rule-icon"><SlidersHorizontal size={18} /></div>
              <div className="rule-copy"><strong>{rule.name}</strong><span>{rule.ruleKey} · v{rule.version}</span></div>
              <SeverityBadge value={rule.severity} />
              <span className={`toggle-label ${rule.enabled ? "on" : ""}`}>{rule.enabled ? "已启用" : "已停用"}</span>
              <button className="small-button" onClick={() => edit(rule)}>编辑</button>
            </article>
          ))}
        </div>
      </section>
      {preview && <section className="panel"><div className="panel-header"><div><h2>Dry-run 结果</h2></div></div><pre className="code-block">{preview}</pre></section>}
      {editing && (
        <Modal title={"id" in editing ? "编辑规则" : "新建规则"} onClose={() => setEditing(null)}>
          <label className="yaml-label">规则 YAML<textarea className="yaml-editor" value={yamlText} onChange={(event) => setYamlText(event.target.value)} spellCheck={false} /></label>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" onClick={() => void save()}><Save size={16} />保存版本</button></div>
        </Modal>
      )}
    </>
  );
}
