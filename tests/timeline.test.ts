import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline } from "../src/server/timeline.js";
import { upsertPullCommentFromWebhook } from "../src/server/pulls.js";
import { execute, queryOne, queryAll } from "../src/server/db.js";
import { seed } from "../src/server/seed.js";

seed();

const projectId = () => queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)!.id;

test("时间线合并提交/PR 开合/评论三类事件，倒序排列", () => {
  const pid = projectId();
  execute(
    `INSERT INTO commits (project_id, sha, short_sha, subject, message, author_name, author_email, committed_at, branch)
     VALUES (?, 'tl-sha-1', 'tl-sha-1', 'feat: 时间线测试提交', 'feat: 时间线测试提交', '测试员', 'tl@example.com', '2026-10-01 10:00:00', 'main')`,
    [pid]
  );
  execute(
    `INSERT INTO pull_requests (project_id, number, title, body, state, head_ref, created_at, merged_at, files_json, authors_json)
     VALUES (?, 8801, 'feat: 时间线测试 PR', '', 'merged', 'feat/tl', '2026-10-01 11:00:00', '2026-10-01 12:00:00', '[]', '[{"name":"测试员","email":"tl@example.com"}]')`,
    [pid]
  );
  execute(
    `INSERT INTO pull_comments (project_id, pull_number, remote_id, source, body, author_name, created_at)
     VALUES (?, 8801, 991, 'issue', '这里口径不对', '测试员', '2026-10-01 11:30:00')`,
    [pid]
  );
  try {
    const events = buildTimeline(pid);
    const types = events.filter((event) => event.number === 8801 || event.sha === "tl-sha-1").map((event) => event.type).sort();
    assert.deepEqual(types, ["comment", "pr_merged", "pr_open", "push"]);
    // 倒序：最新在前
    for (let index = 1; index < events.length; index += 1) {
      assert.ok(events[index - 1].ts >= events[index].ts, "事件必须按时间倒序");
    }
    const push = events.find((event) => event.sha === "tl-sha-1")!;
    assert.equal(push.actor, "测试员", "提交按署名邮箱解析作者");
  } finally {
    execute(`DELETE FROM pull_comments WHERE project_id = ? AND pull_number = 8801`, [pid]);
    execute(`DELETE FROM pull_requests WHERE project_id = ? AND number = 8801`, [pid]);
    execute(`DELETE FROM commits WHERE project_id = ? AND sha = 'tl-sha-1'`, [pid]);
  }
});

test("评论去重：同一评论 webhook 与回填各存一份时，时间线只出现一次", () => {
  const pid = projectId();
  // 回填一份 + webhook 一份（source 不同、remoteId 相同）
  execute(
    `INSERT INTO pull_comments (project_id, pull_number, remote_id, source, body, author_name, created_at)
     VALUES (?, 8802, 992, 'issue', '重复评论', '测试员', '2026-10-01 09:00:00')`,
    [pid]
  );
  execute(
    `INSERT INTO pull_comments (project_id, pull_number, remote_id, source, body, author_name, created_at)
     VALUES (?, 8802, 992, 'webhook', '重复评论', '测试员', '2026-10-01 09:00:00')`,
    [pid]
  );
  try {
    const count = buildTimeline(pid).filter((event) => event.type === "comment" && event.number === 8802).length;
    assert.equal(count, 1, "(number, remoteId) 相同的评论只出现一次");
  } finally {
    execute(`DELETE FROM pull_comments WHERE project_id = ? AND pull_number = 8802`, [pid]);
  }
});

test("WebHook note 落评论：经 noteable_id 反查 PR 编号，幂等", () => {
  const pid = projectId();
  execute(
    `INSERT INTO pull_requests (project_id, number, remote_id, title, body, state, files_json)
     VALUES (?, 8803, 555003, 'PR', '', 'open', '[]')`,
    [pid]
  );
  try {
    const record = upsertPullCommentFromWebhook(pid, {
      noteable_id: 555003,
      note: { id: 777001, body: "webhook 评论", created_at: "2026-10-01 08:00:00", user: { login: "tester", name: "测试员" } }
    });
    assert.equal(record?.pullNumber, 8803, "noteable_id 反查到 PR 编号");
    upsertPullCommentFromWebhook(pid, {
      noteable_id: 555003,
      note: { id: 777001, body: "webhook 评论（编辑后）", created_at: "2026-10-01 08:00:00", user: { login: "tester", name: "测试员" } }
    });
    const rows = queryAll(`SELECT id FROM pull_comments WHERE project_id = ? AND pull_number = 8803`, [pid]);
    assert.equal(rows.length, 1, "重复投递幂等");
  } finally {
    execute(`DELETE FROM pull_comments WHERE project_id = ? AND pull_number = 8803`, [pid]);
    execute(`DELETE FROM pull_requests WHERE project_id = ? AND number = 8803`, [pid]);
  }
});
