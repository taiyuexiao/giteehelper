import test from "node:test";
import assert from "node:assert/strict";
import { execute, queryAll, queryOne } from "../src/server/db.js";
import { upsertPullCommentFromWebhook } from "../src/server/pulls.js";

/**
 * 生产踩过的坑（2026-10-03 从线上库 change_events.payload_json 取到真实载荷）：
 * Gitee 的 Note Hook 里 `note` 是**字符串**（评论正文），评论对象在 `comment`；
 * 旧实现读 `payload.note.id`，永远拿到 0 → 直接 return null，
 * 于是评论实时通道从未生效，评论只能靠手动回填，一旦忘了跑回填就整段缺失。
 * 下面的载荷形状逐字段取自线上真实投递（PR !455 评论 51435220），不是编出来的。
 */
const realNotePayload = {
  hook_name: "note_hooks",
  action: "comment",
  note: "## 就绪报告（head `752d4d658395`）\n\n这是评论正文的字符串形态",
  noteable_id: 18634835,
  noteable_type: "PullRequest",
  pull_request: { id: 18634835, number: 455, title: "docs: 真实载荷样例", head: { sha: "752d4d658395d64a" } },
  comment: {
    id: 51435220,
    body: "## 就绪报告（head `752d4d658395`）\n\n这是评论正文",
    created_at: "2026-10-03T14:11:54+08:00",
    html_url: "https://gitee.com/shanghai-bank_1/agent-evaluation-platform/pulls/455#note_51435220",
    user: { login: "liu-chengyy", name: "LiuChengyan" }
  },
  sender: { login: "liu-chengyy" }
};

function resetFixtures() {
  execute("DELETE FROM pull_comments");
  execute("DELETE FROM pull_requests");
  execute("INSERT OR IGNORE INTO projects (id, name) VALUES (1, '评测平台')");
}

test("真实 Note Hook 载荷：评论必须落库（旧实现读 payload.note.id 恒为 0，直接丢弃）", () => {
  resetFixtures();
  const record = upsertPullCommentFromWebhook(1, realNotePayload as unknown as Record<string, unknown>);
  assert.ok(record, "评论对象在 payload.comment，读不到就说明字段读错了");
  assert.equal(record?.remoteId, 51435220);
  assert.equal(record?.pullNumber, 455);
  const rows = queryAll<{ body: string; author_login: string; source: string }>(
    "SELECT body, author_login, source FROM pull_comments WHERE project_id = 1 AND pull_number = 455"
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].body, /就绪报告/);
  assert.equal(rows[0].author_login, "liu-chengyy");
});

test("评论正文是评审长文时不许截断在 2000 字（线上 684 条被截断过）", () => {
  resetFixtures();
  const longBody = `评审结论：评审需要修改\nreviewed_head_sha: abcdef123456\n${"逐条阻塞项与证据。".repeat(700)}`;
  assert.ok(longBody.length > 2000);
  const payload = { ...realNotePayload, comment: { ...realNotePayload.comment, id: 51435221, body: longBody } };
  upsertPullCommentFromWebhook(1, payload as unknown as Record<string, unknown>);
  const row = queryOne<{ len: number }>(
    "SELECT length(body) AS len FROM pull_comments WHERE project_id = 1 AND remote_id = 51435221"
  );
  assert.equal(row?.len, longBody.length, "长评审正文应完整落库");
});

test("与回填行按 remote_id 跨 source 去重：同一条评论不产生第二行", () => {
  resetFixtures();
  const payload = { ...realNotePayload, comment: { ...realNotePayload.comment, id: 51435222 } };
  // 回填通道先写入（source='pull'，与线上既有数据同形）
  execute(
    `INSERT INTO pull_comments (project_id, pull_number, remote_id, source, body, author_login, created_at)
     VALUES (1, 455, 51435222, 'pull', '旧正文（回填）', 'liu-chengyy', '2026-10-03T14:11:54+08:00')`
  );
  upsertPullCommentFromWebhook(1, payload as unknown as Record<string, unknown>);
  const rows = queryAll<{ body: string }>("SELECT body FROM pull_comments WHERE project_id = 1 AND remote_id = 51435222");
  assert.equal(rows.length, 1, "同一条评论（同一 remote_id）只能有一行，不能被 webhook 再插一份");
  assert.match(rows[0].body, /就绪报告/, "webhook 的最新正文应覆盖回填的旧行");
});

test("载荷没有 pull_request.number 时，用 noteable_id 反查 PR 编号", () => {
  resetFixtures();
  execute(
    `INSERT INTO pull_requests (project_id, number, remote_id, title, state) VALUES (1, 455, 18634835, '反查样例', 'open')`
  );
  const payload = {
    ...realNotePayload,
    pull_request: undefined,
    comment: { ...realNotePayload.comment, id: 51435223 }
  };
  const record = upsertPullCommentFromWebhook(1, payload as unknown as Record<string, unknown>);
  assert.equal(record?.pullNumber, 455, "noteable_id=18634835 应对应 PR 455");
});

test("缺评论 id 的载荷如实丢弃，不写脏行", () => {
  resetFixtures();
  assert.equal(upsertPullCommentFromWebhook(1, { hook_name: "note_hooks", action: "comment" }), null);
  const noComment = { ...realNotePayload, comment: undefined };
  assert.equal(upsertPullCommentFromWebhook(1, noComment as unknown as Record<string, unknown>), null);
});

test("既没有 pull_request.number 又反查不到 PR 时如实丢弃", () => {
  resetFixtures();
  const payload = { ...realNotePayload, pull_request: undefined, noteable_id: 99999999 };
  assert.equal(upsertPullCommentFromWebhook(1, payload as unknown as Record<string, unknown>), null);
});
