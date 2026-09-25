import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/server/seed.js";
import { analyzeEvent } from "../src/server/impact.js";

seed();

test("main branch specification merge raises blocking impacts", () => {
  const result = analyzeEvent({
    source: "gitee", sourceId: `impact-${Date.now()}`, eventType: "pull_request", action: "merged",
    title: "新增金额单位与退款流程规范", author: "admin", branch: "main",
    payload: { files: ["docs/specs/payment.md"], body: "接口字段必须统一为分，退款流程需要幂等键。" }
  });
  assert.equal(result.severity, "blocking");
  assert.ok(result.impacts.length > 0);
  assert.ok(result.impacts.some((impact) => impact.nextAction.length > 0));
});

test("review comments with change signals are at least clarification", () => {
  const result = analyzeEvent({
    source: "gitee", sourceId: `note-${Date.now()}`, eventType: "note", action: "comment",
    title: "PR 评论", author: "reviewer", branch: "feature/order",
    payload: { body: "这里需要改为新的接口字段。" }
  });
  assert.ok(["blocking", "contract", "clarification"].includes(result.severity));
  assert.equal(result.category, "review");
});
