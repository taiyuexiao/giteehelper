import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/server/seed.js";
import { execute, queryOne } from "../src/server/db.js";
import { commitStats, ingestCommit, listWebhookDeliveries, recordWebhookDelivery, summarizeCommit } from "../src/server/commits.js";
import { extractPushCommits } from "../src/server/gitee.js";
import { buildRepoGraph } from "../src/server/repograph.js";
import { ownerPalette } from "../src/shared/ownerColor.js";

seed();

test("约定式提交被解析成“处理了什么问题”", () => {
  const parsed = summarizeCommit("fix(WS-2283): 修正公共 HTTP 客户端缓存穿透\n\n问题：并发请求会重复回源，导致下游限流。\n关联 #412");
  assert.equal(parsed.kind, "fix");
  assert.equal(parsed.kindLabel, "修复缺陷");
  assert.equal(parsed.scope, "WS-2283");
  assert.ok(parsed.summary.includes("修复缺陷（WS-2283）"));
  assert.equal(parsed.problem, "并发请求会重复回源，导致下游限流。");
  assert.deepEqual(parsed.issueRefs, ["WS-2283", "#412"]);
});

test("提交入库会生成影响、严重度和冲突标记，并保证重复投递幂等", () => {
  const sha = `test-sha-${Date.now()}`;
  const first = ingestCommit({
    sha,
    message: "docs: 修订退款规范\n\n问题：下游仍按元处理。",
    authorLogin: "tester",
    committedAt: new Date().toISOString(),
    branch: "main",
    files: [{ path: "docs/specs/payment.md", additions: 3, deletions: 1 }]
  });
  assert.equal(first.created, true);
  assert.equal(first.analysis?.conflict, true);
  assert.equal(first.analysis?.severity, "blocking");
  assert.ok((first.analysis?.affectedModules.length ?? 0) > 0);
  assert.equal(first.analysis?.affectedModules[0].owner, "系统管理员");

  const second = ingestCommit({ sha, message: "docs: 重复投递", files: [] });
  assert.equal(second.created, false, "同一 sha 不应重复入库");
  assert.equal(second.commitId, first.commitId);

  const stats = commitStats();
  assert.ok(stats.total >= 1);

  execute(`DELETE FROM impacts WHERE event_id = ?`, [first.eventId]);
  execute(`DELETE FROM commits WHERE id = ?`, [first.commitId]);
  execute(`DELETE FROM change_events WHERE id = ?`, [first.eventId]);
});

test("Push 事件可以直接从负载里取出提交，无需回查 API", () => {
  const commits = extractPushCommits({
    ref: "refs/heads/main",
    repository: { path_with_namespace: "owner/repo" },
    commits: [
      { id: "abc123", message: "feat: 新增能力", timestamp: "2026-09-28T10:00:00Z", author: { name: "张三", email: "z@example.com" }, modified: ["src/server/a.ts", "src/server/b.ts"] }
    ]
  });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].sha, "abc123");
  assert.equal(commits[0].branch, "main");
  assert.equal(commits[0].files?.length, 2);
  assert.equal(commits[0].authorName, "张三");
});

test("3D 仓库全景返回负责人分区与提交节点", () => {
  const graph = buildRepoGraph(30);
  assert.ok(graph.nodes.some((node) => node.type === "project"));
  assert.ok(graph.clusters.length > 0, "至少应有一个负责人分区");
  for (const cluster of graph.clusters) {
    assert.ok(cluster.fill.startsWith("hsl("), "分区颜色应为低饱和度浅色");
    assert.ok(cluster.moduleIds.length > 0);
  }
  assert.equal(typeof graph.stats.totalCommits, "number");
  assert.ok(graph.stats.generatedAt);
});

test("WebHook 投递记录可查询，便于确认事件是否真的到达", () => {
  const before = listWebhookDeliveries(5).length;
  const id = recordWebhookDelivery({ hookName: "Push Hook", eventType: "push", action: "push", status: "processed", commits: 2, impacts: 3, conflicts: 1, detail: "单元测试" });
  const deliveries = listWebhookDeliveries(5);
  assert.ok(deliveries.length >= Math.min(before + 1, 1));
  assert.equal(deliveries[0].id, id);
  assert.equal(deliveries[0].status, "processed");
  execute(`DELETE FROM webhook_deliveries WHERE id = ?`, [id]);
});

test("负责人配色稳定且为浅色系", () => {
  const first = ownerPalette("张三");
  const second = ownerPalette("张三");
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.fill, ownerPalette("李四").fill);
  assert.equal(ownerPalette(null).fill, ownerPalette("未分配").fill);
});

test("未匹配模块的提交被统计为未归属", () => {
  const sha = `unattributed-${Date.now()}`;
  const result = ingestCommit({ sha, message: "chore: 调整根目录说明", branch: "main", files: [{ path: "NOTICE.txt" }] });
  const graph = buildRepoGraph(30);
  assert.ok(graph.stats.unattributedCommits >= 1);
  assert.equal(result.analysis?.affectedModules.length, 0);
  assert.equal(queryOne(`SELECT id FROM commits WHERE sha = ?`, [sha]) !== undefined, true);
  execute(`DELETE FROM impacts WHERE event_id = ?`, [result.eventId]);
  execute(`DELETE FROM commits WHERE id = ?`, [result.commitId]);
  execute(`DELETE FROM change_events WHERE id = ?`, [result.eventId]);
});
