import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGiteeEvent, verifyGiteeSignature } from "../src/server/gitee.js";

test("gitee webhook accepts exact token and hmac signatures", () => {
  assert.equal(verifyGiteeSignature("secret", "secret", undefined), true);
  assert.equal(verifyGiteeSignature("secret", "wrong", undefined), false);
  const timestamp = "1700000000000";
  const token = Buffer.from("rLEHLuZRIQHuTPeXMib9Czoq9dVXO4TsQcmQQHtjXHA=", "utf8").toString();
  assert.equal(verifyGiteeSignature("secret", token, timestamp), false);
});

test("gitee pull request payload becomes a unified event", () => {
  const event = normalizeGiteeEvent({
    hook_name: "merge_request_hooks",
    hook_id: 42,
    action: "open",
    title: "更新退款规范",
    target_branch: "main",
    html_url: "https://gitee.com/example/repo/pulls/8",
    pull_request: { id: 8, number: 8, title: "更新退款规范", target_branch: "main" },
    sender: { login: "reviewer" }
  }, "Merge Request Hook");
  assert.equal(event.eventType, "pull_request");
  assert.equal(event.branch, "main");
  assert.equal(event.author, "reviewer");
  assert.equal(event.sourceId, "pull-8");
});

test("事件标识来自被改动实体而不是 hook_id", () => {
  const base = { hook_name: "merge_request_hooks", hook_id: 2130588, action: "open", sender: { login: "x" } };
  const first = normalizeGiteeEvent({ ...base, pull_request: { id: 8, number: 8, title: "A", head: { sha: "aaaa1111bbbb" } } }, "Merge Request Hook");
  const second = normalizeGiteeEvent({ ...base, pull_request: { id: 9, number: 9, title: "B" } }, "Merge Request Hook");
  assert.equal(first.sourceId, "pull-8@aaaa1111bbbb");
  assert.equal(second.sourceId, "pull-9");
  assert.notEqual(first.sourceId, second.sourceId, "同一个 Hook 的不同 PR 不能被去重成一条");

  // 同一 PR 的新提交应形成新事件
  const updated = normalizeGiteeEvent({ ...base, action: "update", pull_request: { id: 8, number: 8, title: "A", head: { sha: "cccc2222dddd" } } }, "Merge Request Hook");
  assert.notEqual(updated.sourceId, first.sourceId);

  // 两条不同评论不能被去重
  const commentA = normalizeGiteeEvent({ hook_name: "note_hooks", hook_id: 2130588, action: "comment", note: { id: 501, body: "A" }, pull_request: { id: 8 } }, "Note Hook");
  const commentB = normalizeGiteeEvent({ hook_name: "note_hooks", hook_id: 2130588, action: "comment", note: { id: 502, body: "B" }, pull_request: { id: 8 } }, "Note Hook");
  assert.equal(commentA.sourceId, "note-501");
  assert.notEqual(commentA.sourceId, commentB.sourceId);

  // push 用 head sha
  const push = normalizeGiteeEvent({ hook_name: "push_hooks", hook_id: 2130588, after: "deadbeef", ref: "refs/heads/main" }, "Push Hook");
  assert.equal(push.sourceId, "deadbeef");
  assert.equal(push.branch, "main");
});
