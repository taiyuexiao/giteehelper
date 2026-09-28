import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/server/seed.js";
import { analyzeEvent, tokenize } from "../src/server/impact.js";
import { versionsCompatible } from "../src/server/integration.js";

seed();

function analyze(files: string[], title = "调整实现", action = "pushed", eventType = "commit") {
  return analyzeEvent({
    source: "gitee",
    sourceId: `precision-${title}-${files.join(",")}-${Date.now()}-${Math.random()}`,
    eventType,
    action,
    title,
    author: "tester",
    branch: "main",
    payload: { files, message: title }
  });
}

test("文档类提交不再命中所有模块", () => {
  const result = analyzeEvent({
    source: "gitee",
    sourceId: `docs-only-${Date.now()}`,
    eventType: "pull_request",
    action: "open",
    title: "docs(WS-2487): 封版篇升为 MDX，按五步向导与过期确认规则修订",
    author: "gux12",
    branch: "main",
    payload: { body: "文档措辞与原型出处修订，补充 review 意见与 api 说明。" }
  });
  assert.equal(result.impacts.length, 0, "通用词 api/review/docs 不应该把模块全部拉进来");
});

test("深层路径按路径模式精确归属到单个模块", () => {
  const cases: Array<[string, number[]]> = [
    ["src/server/http/client.ts", [3]],
    ["src/client/pages/Checkout.tsx", [2]],
    ["api/openapi.yaml", [3]],
    ["tests/cleanup.test.ts", [4]]
  ];
  for (const [path, expected] of cases) {
    const result = analyze([path]);
    assert.deepEqual(result.impacts.map((impact) => impact.moduleId), expected, `${path} 应只命中 ${expected}`);
  }
});

test("仓库根目录的无关文件不会产生影响", () => {
  const result = analyze(["README.md"]);
  assert.equal(result.impacts.length, 0);
});

test("中文分词可以把模块名词从标题里切出来", () => {
  const result = analyze([], "前端模块结算页改造");
  assert.ok(result.impacts.some((impact) => impact.moduleId === 2), "应通过“前端”匹配到前端模块");
});

test("主干文档提交触发阻塞级规则并产生冲突", () => {
  const result = analyze(["docs/specs/payment.md"], "修订退款规范", "pushed");
  assert.equal(result.severity, "blocking");
  assert.ok(result.impacts.length > 0);
});

test("契约版本按语义化范围判断兼容性", () => {
  assert.equal(versionsCompatible("1.1", "^1.0"), true);
  assert.equal(versionsCompatible("1.0", "^1.0"), true);
  assert.equal(versionsCompatible("2.0", "^1.0"), false);
  assert.equal(versionsCompatible("1.2.3", "~1.2.0"), true);
  assert.equal(versionsCompatible("1.3.0", "~1.2.0"), false);
  assert.equal(versionsCompatible("2.0", ">=1.5"), true);
  assert.equal(versionsCompatible("1.4", ">=1.5"), false);
  assert.equal(versionsCompatible("1.0.0", "1.0.0"), true);
  assert.equal(versionsCompatible("1.0.1", "1.0.0"), false);
  assert.equal(versionsCompatible("9.9", "*"), true);
});

test("分词会剔除通用词并保留有区分度的词", () => {
  const terms = tokenize("docs(WS-2487): 修订退款规范与金额单位");
  assert.equal(terms.includes("docs"), false);
  assert.equal(terms.includes("更新"), false);
  assert.ok(terms.includes("退款"), "应保留有区分度的中文词");
});
