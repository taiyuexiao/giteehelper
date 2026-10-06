import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export const db = new DatabaseSync(config.databasePath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','maintainer','reviewer','developer','observer')),
  email TEXT,
  gitee_login TEXT,
  feishu_user_id TEXT,
  password_hash TEXT,
  password_salt TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gitee_repo TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  feishu_chat_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'not_started',
  paths_json TEXT NOT NULL DEFAULT '[]',
  scenarios_json TEXT NOT NULL DEFAULT '[]',
  provides_json TEXT NOT NULL DEFAULT '[]',
  requires_json TEXT NOT NULL DEFAULT '[]',
  test_command TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, module_key)
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_key TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL,
  schema_json TEXT NOT NULL DEFAULT '{}',
  owner_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, contract_key, version)
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rule_key TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  severity TEXT NOT NULL,
  trigger_json TEXT NOT NULL DEFAULT '{}',
  condition_json TEXT NOT NULL DEFAULT '{}',
  action_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, rule_key)
);

CREATE TABLE IF NOT EXISTS change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  branch TEXT,
  url TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, source, source_id, event_type, action)
);

CREATE TABLE IF NOT EXISTS impacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES change_events(id) ON DELETE CASCADE,
  module_id INTEGER REFERENCES modules(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  next_action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integration_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trigger_event_id INTEGER REFERENCES change_events(id) ON DELETE SET NULL,
  module_key TEXT NOT NULL,
  status TEXT NOT NULL,
  combination_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repair_bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES change_events(id) ON DELETE CASCADE,
  impact_id INTEGER REFERENCES impacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',
  diff TEXT NOT NULL DEFAULT '',
  tests_patch TEXT NOT NULL DEFAULT '',
  test_report_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  short_sha TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  author_login TEXT,
  author_name TEXT,
  author_email TEXT,
  committed_at TEXT,
  branch TEXT,
  url TEXT,
  files_json TEXT NOT NULL DEFAULT '[]',
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  changed_files INTEGER NOT NULL DEFAULT 0,
  pull_number INTEGER,
  pull_title TEXT,
  event_id INTEGER REFERENCES change_events(id) ON DELETE SET NULL,
  severity TEXT,
  conflict INTEGER NOT NULL DEFAULT 0,
  analysis_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, sha)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  hook_name TEXT,
  event_type TEXT,
  action TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  event_id INTEGER,
  commits INTEGER NOT NULL DEFAULT 0,
  impacts INTEGER NOT NULL DEFAULT 0,
  conflicts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  base_ref TEXT,
  head_ref TEXT,
  head_sha TEXT,
  author_login TEXT,
  author_email TEXT,
  mergeable INTEGER,
  merged_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  files_json TEXT NOT NULL DEFAULT '[]',
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, number)
);

-- PR 之间的引用关系：从评审评论与正文里挖「!78」这类引用，构成 PR 级依赖图
CREATE TABLE IF NOT EXISTS pull_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_number INTEGER NOT NULL,
  to_number INTEGER NOT NULL,
  source TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, from_number, to_number)
);

CREATE TABLE IF NOT EXISTS repo_state (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  default_branch TEXT NOT NULL DEFAULT 'main',
  head_sha TEXT,
  head_commit_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pulls_state ON pull_requests(state);
CREATE INDEX IF NOT EXISTS idx_pull_refs_from ON pull_references(from_number);
CREATE INDEX IF NOT EXISTS idx_commits_committed_at ON commits(committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_commits_sha ON commits(sha);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_impacts_event ON impacts(event_id);
`);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// 影响原因：规则判定出来的"为什么这个模块会受影响"，通知里要显示
ensureColumn("impacts", "reason_code", "TEXT");

// 评论类 WebHook 只给 noteable_id（Gitee 数据库 id），要靠它反查 PR 编号
ensureColumn("pull_requests", "remote_id", "INTEGER");

// PR 的真实提交作者（[{name,email}]，来自 PR 内提交的署名）。
// Gitee 账号是共用的/代操作的，author_login 不代表作者；NULL=未回填，[]=回填过但没有可用署名
ensureColumn("pull_requests", "authors_json", "TEXT");


// 进度页：group_name 标记任务所属顶层模块（NULL = 顶层模块本身）；身份别名表对齐
// Gitee 账号 / git 署名 / 匿名用户名（如 用户205243）到真实成员
ensureColumn("modules", "group_name", "TEXT");

db.exec(`
CREATE TABLE IF NOT EXISTS identity_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, alias)
);

-- 进度页：能力域分组名 → 顶层模块（多维表格里两者命名常不一致，如 执行与证据 → 运行）
CREATE TABLE IF NOT EXISTS module_group_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  UNIQUE(project_id, group_name)
);

-- 进度页责任矩阵：交付项粒度的行（人工维护，PR 号自动解析出状态/交付面/链接）
CREATE TABLE IF NOT EXISTS matrix_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  item_name TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  pr_numbers TEXT NOT NULL DEFAULT '',
  blocked INTEGER,
  blocker_module TEXT NOT NULL DEFAULT '',
  blocker_owner TEXT NOT NULL DEFAULT '',
  blocker_progress TEXT NOT NULL DEFAULT '',
  engage_note TEXT NOT NULL DEFAULT '',
  status_note TEXT NOT NULL DEFAULT '',
  sort_index INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 进度页责任矩阵：任务的人工阻塞标注（是否阻塞/阻塞点与阻塞方/介入建议）
CREATE TABLE IF NOT EXISTS task_blockers (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  blocked INTEGER,
  blocker_module TEXT NOT NULL DEFAULT '',
  blocker_owner TEXT NOT NULL DEFAULT '',
  blocker_progress TEXT NOT NULL DEFAULT '',
  engage_note TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, module_id)
);

-- 进度页：AI 补充关联（规则证据 ref/rfc/path 覆盖不到的 PR，由大模型判断归属，
-- 看板里标为「AI 识别」级证据，可审计）。module_id 为 NULL 表示“已判断、无把握”
-- 进度页时间线：PR 评论/评审（回填自 Gitee 两个端点 + WebHook note 增量）
CREATE TABLE IF NOT EXISTS pull_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pull_number INTEGER NOT NULL,
  remote_id INTEGER,
  source TEXT NOT NULL DEFAULT 'issue',
  body TEXT NOT NULL DEFAULT '',
  author_login TEXT,
  author_name TEXT,
  created_at TEXT,
  url TEXT,
  UNIQUE(project_id, pull_number, source, remote_id)
);

CREATE TABLE IF NOT EXISTS pull_task_ai (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pull_number INTEGER NOT NULL,
  module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, pull_number, module_id)
);
`);

// AI/人工补充关联的来源标记（ai | manual），旧库补列（必须在建表之后执行）
ensureColumn("pull_task_ai", "source", "TEXT NOT NULL DEFAULT 'ai'");
// 责任矩阵阻塞字段：旧结构（blocker_note/action_note）迁移到四字段后弃用旧列
ensureColumn("task_blockers", "blocker_module", "TEXT NOT NULL DEFAULT ''");
ensureColumn("task_blockers", "blocker_owner", "TEXT NOT NULL DEFAULT ''");
ensureColumn("task_blockers", "blocker_progress", "TEXT NOT NULL DEFAULT ''");
ensureColumn("task_blockers", "engage_note", "TEXT NOT NULL DEFAULT ''");
// 责任矩阵「完成」列的人工备注（全景模板带基线文字，旧库补列）
ensureColumn("matrix_rows", "status_note", "TEXT NOT NULL DEFAULT ''");

// 契约归属：RFC meta 是仓库里已有的机器可读契约，反查工作项比人写 glob 可靠
db.exec(`
CREATE TABLE IF NOT EXISTS rfc_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  authors_json TEXT NOT NULL DEFAULT '[]',
  work_refs_json TEXT NOT NULL DEFAULT '[]',
  doc_patterns_json TEXT NOT NULL DEFAULT '[]',
  code_patterns_json TEXT NOT NULL DEFAULT '[]',
  related_json TEXT NOT NULL DEFAULT '[]',
  task_count INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, slug)
);
`);

export function queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  return db.prepare(sql).all(...params as never[]) as T[];
}

export function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  return db.prepare(sql).get(...params as never[]) as T | undefined;
}

export function execute(sql: string, params: unknown[] = []) {
  return db.prepare(sql).run(...params as never[]);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function audit(actorUserId: number | null, actor: string, action: string, resourceType: string, resourceId: string | number, detail: Record<string, unknown> = {}) {
  execute(
    `INSERT INTO audit_logs (actor_user_id, actor, action, resource_type, resource_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)`,
    [actorUserId, actor, action, resourceType, String(resourceId), JSON.stringify(detail)]
  );
}
