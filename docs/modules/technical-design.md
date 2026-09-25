# 模块：技术设计

> 状态：✅ 方案定稿
> 最近更新：2026-09-25

## 1. 架构总览
```text
Gitee WebHook/Open API        Feishu Bot/API
          │                         │
          └────────────┬────────────┘
                       ▼
              ┌────────────────┐
              │  API / Server  │
              │  Event Router  │
              └───────┬────────┘
                      │
     ┌────────────────┼─────────────────┐
     ▼                ▼                 ▼
 Event Store    Impact Engine     Integration Engine
     │                │                 │
     └────────────────┼─────────────────┘
                      ▼
             SQLite / Audit Store
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   Web Console     CLI/MCP      Notification
```

## 2. 技术栈
- 运行时：Node.js 26 ESM；
- 后端：TypeScript + Express；
- 数据库：SQLite，使用 `node:sqlite`；
- 前端：React + Vite + TypeScript；
- 关系图：React Flow + 自定义分层节点/关系边；
- YAML：`yaml`；
- 加密：Node `crypto.scrypt`；
- 测试：`node:test` + `tsx`；
- 部署：Docker Compose，单机 MVP；
- 外部调用：Gitee Open API、飞书机器人 API。

## 3. 目录结构
```text
src/
  server/
    index.ts
    config.ts
    db.ts
    auth.ts
    gitee.ts
    feishu.ts
    impact.ts
    integration.ts
    repair.ts
    routes.ts
    seed.ts
  shared/
    types.ts
  client/
    main.tsx
    App.tsx
    api.ts
    styles.css
    pages/
    components/
tests/
docs/
```

## 4. 数据模型
### projects
`id, name, gitee_repo, default_branch, feishu_chat_id, created_at`

### users
`id, username, display_name, role, email, gitee_login, feishu_user_id, password_hash, password_salt, active, created_at`

### modules
`id, project_id, module_key, name, owner_user_id, status, paths_json, scenarios_json, provides_json, requires_json, test_command, description, created_at`

### contracts
`id, project_id, contract_key, version, kind, schema_json, owner_user_id, created_at`

### rules
`id, project_id, rule_key, name, enabled, severity, trigger_json, condition_json, action_json, version, updated_at`

### change_events
`id, project_id, source, source_id, event_type, action, title, author, branch, url, payload_json, created_at`

### impacts
`id, event_id, module_id, user_id, severity, category, reason, evidence_json, status, created_at`

### integration_runs
`id, project_id, trigger_event_id, module_id, status, combination_json, result_json, created_at`

### repair_bundles
`id, event_id, impact_id, status, diff, tests_patch, test_report_json, provenance_json, created_at`

### audit_logs
`id, actor_user_id, action, resource_type, resource_id, detail_json, created_at`

## 5. API
### 认证
- `POST /api/login`：用户名/密码，返回 Bearer Token；
- `POST /api/logout`：撤销当前 Token；
- 其他 `/api/*` 需要 Bearer Token，健康检查除外。

### 配置与数据
- `GET /api/dashboard`
- `GET /api/graph`
- `GET/POST/PATCH /api/modules`
- `GET/POST/PATCH /api/rules`
- `GET/POST/PATCH /api/users`
- `GET /api/audit`
- `GET /api/runs/:id`
- `GET /api/integrations`
- `POST /api/integrations/:kind/test`

### Gitee
- `POST /api/webhooks/gitee`
- `POST /api/gitee/sync`
- `GET /api/gitee/status`

### 飞书
- `POST /api/feishu/test`
- `POST /api/notifications/:id/ack`

### 修复
- `GET /api/repairs/:id`
- `POST /api/repairs/:id/test`
- `POST /api/repairs/:id/approve`
- `GET /api/repairs/:id/bundle`

## 6. WebHook 事件模型
统一事件字段：

```ts
type ChangeEvent = {
  source: 'gitee' | 'feishu' | 'manual';
  sourceId: string;
  eventType: 'push' | 'pull_request' | 'note' | 'issue' | 'design' | 'rule';
  action: string;
  title: string;
  author: string;
  branch?: string;
  url?: string;
  payload: unknown;
};
```

Gitee 适配器将：

- `push_hooks` → `push`
- `merge_request_hooks` → `pull_request`
- `note_hooks` → `note`
- `issue_hooks` → `issue`

事件写入后立即生成分析任务，不做低延迟优化，允许分钟级排队。

## 7. 影响分析引擎
### 输入
- 事件正文、标题、Diff、文件路径；
- 主分支基线文档；
- 模块清单；
- 契约清单；
- 规则；
- 当前开放 PR。

### 分析阶段
1. **变化分类**：规范、需求、文档、代码、评论、设计、规则；
2. **对象定位**：从路径、标题、契约 key、模块 key 建立候选；
3. **证据匹配**：关键词、路径、契约字段、场景 ID、代码引用；
4. **关系传播**：一跳直接依赖、共享契约、共享场景；
5. **冲突判定**：五级严重度；
6. **人员路由**：负责人、提交者、审查者、合并者、管理员；
7. **动作生成**：澄清、修改设计、补契约、本地修复、联调、忽略。

### 严重度
`blocking > contract > implementation > clarification > informational`

### 结论格式
```json
{
  "module": "order",
  "severity": "contract",
  "reason": "payment.capture.v2 将 amount 改为分，而模块文档仍使用元",
  "evidence": [
    {"type": "pull_request", "id": "!18", "path": "docs/contracts/payment.yaml"},
    {"type": "contract", "key": "payment.capture.v2"}
  ],
  "nextAction": "更新模块文档和金额换算测试"
}
```

## 8. 增量联调引擎
- 仅展开变更模块的一跳邻接；
- `requires` 对端存在真实代码时运行真实集成；
- 缺席时用契约 Stub，标记 `contract_verified`；
- 共享场景组装最小切片；
- 无关系不联调；
- 运行顺序：静态检查 → 单测 → 契约 → 切片；
- 测试命令来自模块清单，结果写入 `integration_runs`。

## 9. Repair Bundle
```text
repair.diff
tests.patch
test-report.json
commands.md
provenance.json
README.md
```

`provenance.json` 至少包含：

- 源变化事件；
- 影响 ID；
- 使用的契约/规则版本；
- 测试命令与结果；
- 生成时间；
- 生成者；
- 未经批准，不包含可执行写仓库凭据。

## 10. 权限与安全
- Gitee Token 只保存在 `.env`/Secret Store，禁止写入代码、日志和 UI；
- 账号密码不用于产品接入；用户只使用最小权限 Token；
- WebHook 校验 `X-Gitee-Token` 或 HMAC 签名；
- Token、飞书 Secret、密码均脱敏；
- 管理员、Maintainer、Reviewer、Developer、Observer 使用最小权限；
- 修复操作只允许通过 PR；
- 所有外部写操作进入审计；
- Runner 与 API 分离，测试命令在隔离工作目录执行。

## 11. 部署
```yaml
services:
  api:
    build: .
    ports: ["8787:8787"]
    env_file: .env
    volumes:
      - ./data:/app/data
  web:
    build: .
    command: npm run preview
    ports: ["5173:5173"]
```

MVP 也可以使用 `npm run dev` 同时启动 API 和 Vite。生产部署前必须更换默认管理员密码、Gitee Token 和飞书 Secret。

## 12. 测试策略
- 单元测试：影响分类、规则匹配、签名验证、版本解析；
- 集成测试：WebHook → 事件 → 影响 → 通知 dry-run；
- CLI 测试：manifest、integration、repair bundle；
- 前端验收：登录、关系图、规则编辑、用户管理、审计、运行详情；
- 真实验收：一个 Gitee 测试仓库 + 一个飞书测试群。

## 13. 可观测性
- 每次事件生成 `event_id`；
- 每条影响有 `impact_id`；
- 每次联调有 `run_id`；
- 每次修复有 `repair_id`；
- 日志包含关联 ID，不包含 Token/Secret/完整代码。

## 14. 限制
- 第一版影响分析是规则和证据驱动，不做大规模语义模型调用；
- 第一版单项目、单组织；
- 第一版不做自动合并；
- 无真实测试命令的模块只得到 `contract_verified`，不冒充 `slice_integrated`；
- 原型工具变化需后续适配器实现。
