import { audit, execute, queryOne, queryAll } from "./db.js";
import { ensureAdminUser } from "./auth.js";

export function seed() {
  ensureAdminUser();
  if (!queryOne(`SELECT id FROM projects LIMIT 1`)) {
    execute(`INSERT INTO projects (name, gitee_repo, default_branch) VALUES (?, ?, ?)`, ["GiteeHelper 示例项目", "待接入", "main"]);
  }
  const project = queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)!;
  const admin = queryOne<{ id: number }>(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`)!;

  const users = [
    ["reviewer", "示例审查者", "reviewer", "reviewer@example.com", "reviewer"],
    ["developer-a", "模块开发者 A", "developer", "developer-a@example.com", "developer-a"],
    ["developer-b", "模块开发者 B", "developer", "developer-b@example.com", "developer-b"]
  ];
  for (const [username, displayName, role, email, giteeLogin] of users) {
    if (!queryOne(`SELECT id FROM users WHERE username = ?`, [username])) {
      execute(
        `INSERT INTO users (username, display_name, role, email, gitee_login) VALUES (?, ?, ?, ?, ?)`,
        [username, displayName, role, email, giteeLogin]
      );
    }
  }

  const devA = queryOne<{ id: number }>(`SELECT id FROM users WHERE username = 'developer-a'`)!;
  const devB = queryOne<{ id: number }>(`SELECT id FROM users WHERE username = 'developer-b'`)!;

  const modules = [
    {
      key: "product-docs", name: "产品需求与规范", owner: admin.id, status: "release_ready",
      paths: ["docs/product/**", "docs/specs/**"], scenarios: ["all"], provides: [{ key: "product.requirements.v1", version: "1.0" }],
      requires: [], description: "项目产品需求、验收条件与开发规范。"
    },
    {
      key: "frontend", name: "前端模块", owner: devA.id, status: "code_submitted",
      paths: ["src/client/**", "web/**"], scenarios: ["checkout-success", "review-notification"],
      provides: [{ key: "ui.checkout.v1", version: "1.0" }],
      requires: [{ key: "api.order.v1", version: "^1.0", mode: "required" }, { key: "api.user.v1", version: "^1.0", mode: "optional" }],
      testCommand: "", description: "用户界面、交互流程和前端状态管理。"
    },
    {
      key: "backend-api", name: "后端 API 模块", owner: devB.id, status: "contract_verified",
      paths: ["src/server/**", "api/**"], scenarios: ["checkout-success"],
      provides: [{ key: "api.order.v1", version: "1.1" }],
      requires: [{ key: "data.order.v1", version: "^1.0", mode: "required" }],
      testCommand: "", description: "订单、支付和用户 API。"
    },
    {
      key: "integration-tests", name: "联调与验收", owner: admin.id, status: "contract_ready",
      paths: ["tests/**", "e2e/**"], scenarios: ["checkout-success", "review-notification"],
      provides: [{ key: "scenario.acceptance.v1", version: "1.0" }],
      requires: [{ key: "ui.checkout.v1", version: "^1.0", mode: "required" }, { key: "api.order.v1", version: "^1.0", mode: "required" }],
      testCommand: "npm test", description: "契约测试、场景切片和发布验收。"
    }
  ];

  for (const module of modules) {
    if (!queryOne(`SELECT id FROM modules WHERE project_id = ? AND module_key = ?`, [project.id, module.key])) {
      execute(
        `INSERT INTO modules (project_id, module_key, name, owner_user_id, status, paths_json, scenarios_json, provides_json, requires_json, test_command, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [project.id, module.key, module.name, module.owner, module.status, JSON.stringify(module.paths), JSON.stringify(module.scenarios),
          JSON.stringify(module.provides), JSON.stringify(module.requires), module.testCommand ?? "", module.description ?? ""]
      );
    }
  }

  const contracts = [
    ["product.requirements.v1", "1.0", "document"],
    ["ui.checkout.v1", "1.0", "ui"],
    ["api.order.v1", "1.1", "api"],
    ["api.user.v1", "1.0", "api"],
    ["data.order.v1", "1.0", "data"],
    ["scenario.acceptance.v1", "1.0", "scenario"]
  ];
  for (const [key, version, kind] of contracts) {
    if (!queryOne(`SELECT id FROM contracts WHERE project_id = ? AND contract_key = ? AND version = ?`, [project.id, key, version])) {
      execute(`INSERT INTO contracts (project_id, contract_key, version, kind, schema_json) VALUES (?, ?, ?, ?, ?)`, [
        project.id, key, version, kind, JSON.stringify({ generatedFrom: "seed", status: "draft" })
      ]);
    }
  }

  const rules = [
    {
      key: "main-doc-change", name: "主干文档变化必须评估下游", severity: "blocking",
      trigger: { eventTypes: ["pull_request", "push"], branches: ["main"] },
      condition: { anyPath: ["docs/product/**", "docs/specs/**", "docs/technical/**"] },
      action: { route: ["owner", "submitter", "reviewer", "merger"], nextAction: "更新模块设计并确认验收条件" }
    },
    {
      key: "review-change-signal", name: "Review 变更信号", severity: "clarification",
      trigger: { eventTypes: ["note"] },
      condition: { keywords: ["必须", "需要", "改为", "下线", "接口", "字段", "流程", "验收"] },
      action: { route: ["owner", "submitter", "reviewer"], nextAction: "确认评论是否改变需求或契约" }
    },
    {
      key: "contract-conflict", name: "契约冲突", severity: "contract",
      trigger: { eventTypes: ["pull_request", "push"] },
      condition: { anyPath: ["**/*contract*", "**/*openapi*", "**/*asyncapi*", "api/**"] },
      action: { route: ["owner", "reviewer"], nextAction: "更新契约并执行局部联调" }
    }
  ];
  for (const rule of rules) {
    if (!queryOne(`SELECT id FROM rules WHERE project_id = ? AND rule_key = ?`, [project.id, rule.key])) {
      execute(
        `INSERT INTO rules (project_id, rule_key, name, enabled, severity, trigger_json, condition_json, action_json)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        [project.id, rule.key, rule.name, rule.severity, JSON.stringify(rule.trigger), JSON.stringify(rule.condition), JSON.stringify(rule.action)]
      );
    }
  }

  const existingEvents = queryAll(`SELECT id FROM change_events WHERE project_id = ?`, [project.id]);
  if (existingEvents.length === 0) {
    execute(
      `INSERT INTO change_events (project_id, source, source_id, event_type, action, title, author, branch, url, payload_json)
       VALUES (?, 'manual', 'demo-requirement-1', 'pull_request', 'merged', '新增金额单位与退款流程规范', '管理员', 'main', NULL, ?)`,
      [project.id, JSON.stringify({ demo: true, summary: "金额统一使用分，退款必须提供幂等键。" })]
    );
    const eventId = queryOne<{ id: number }>(`SELECT id FROM change_events WHERE source_id = 'demo-requirement-1'`)!.id;
    execute(
      `INSERT INTO impacts (event_id, module_id, user_id, severity, category, reason, evidence_json, next_action)
       VALUES (?, (SELECT id FROM modules WHERE module_key='frontend'), (SELECT owner_user_id FROM modules WHERE module_key='frontend'), 'blocking', 'requirement',
               '主干规范将金额单位统一为分，前端展示和校验仍使用元。', ?, '更新前端金额换算、输入校验和相关测试')`,
      [eventId, JSON.stringify([{ type: "document", label: "新增金额单位与退款流程规范" }, { type: "contract", id: "api.order.v1", label: "订单金额字段" }])]
    );
    execute(
      `INSERT INTO integration_runs (project_id, trigger_event_id, module_key, status, combination_json, result_json)
       VALUES (?, ?, 'frontend', 'passed', ?, ?)`,
      [project.id, eventId, JSON.stringify([
        { moduleKey: "frontend", version: "1.0", mode: "real", status: "passed" },
        { moduleKey: "backend-api", version: "1.1", mode: "stub", status: "passed" }
      ]), JSON.stringify({ scenarios: ["checkout-success"], contractVerified: true, sliceIntegrated: false })]
    );
    audit(null, "system", "seed_demo", "project", project.id, { note: "示例数据用于首次启动" });
  }
}
