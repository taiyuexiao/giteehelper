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
  assert.equal(event.sourceId, "42");
});
