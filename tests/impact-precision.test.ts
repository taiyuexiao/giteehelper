import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/server/seed.js";
import { analyzeEvent, tokenize } from "../src/server/impact.js";
import { versionsCompatible } from "../src/server/integration.js";
import { execute } from "../src/server/db.js";

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

/**
 * 区域共用模式的证据问题：一个路径模式被多个工作项共用时，它只能定位到"区域"。
 * 但文件确实落在本模块声明的模式里，这条路径证据必须留下——否则影响会退化成
 * 纯语义猜测（"看不出为什么说影响我"），而且 once 用证据类型判断是否收敛，
 * 收敛会永久失效。这里同时锁住两件事：证据留痕 + 收敛能力。
 */
test("共用模式下仍保留路径证据，且无歧义时收敛成一条区域影响", () => {
  for (const key of ["test-shared-a", "test-shared-b", "test-shared-c"]) {
    execute(
      `INSERT INTO modules (project_id, module_key, name, owner_user_id, status, paths_json, scenarios_json, provides_json, requires_json, test_command, description)
       VALUES (1, ?, ?, NULL, 'active', ?, '[]', '[]', '[]', '', '')`,
      [key, `共享区域工作项${key.slice(-1).toUpperCase()}`, JSON.stringify(["src/shared-area/**"])]
    );
  }

  // 1) 标题点名了其中一个工作项：语义词把它从"区域"里挑出来，影响要带路径证据
  const named = analyze(["src/shared-area/service/Alpha.java"], "共享区域工作项A 的接口调整");
  const hit = named.impacts.filter((impact) => impact.evidence.some((item) => item.label.includes("共享区域工作项A")));
  const targeted = named.impacts.find((impact) => impact.moduleId !== null && impact.evidence.some((item) => item.type === "path"));
  assert.ok(targeted, "被点名的工作项应有带路径证据的影响");
  assert.ok(
    targeted!.evidence.some((item) => item.type === "path" && item.label.includes("src/shared-area/service/Alpha.java")),
    "路径证据必须保留具体文件，即使模式是区域共用的"
  );
  assert.equal(hit.length, 0, "语义词只用于升级证据，不应该是唯一依据");

  // 2) 没有语义词消歧：只出一条区域影响，绝不给区域内每个工作项都发通知
  const ambiguous = analyze(["src/shared-area/service/Beta.java"], "调整实现");
  const perModule = ambiguous.impacts.filter((impact) => impact.moduleId !== null);
  const areaLevel = ambiguous.impacts.filter((impact) => impact.moduleId === null && impact.evidence.some((item) => item.type === "area"));
  assert.equal(perModule.length, 0, "共用模式无法定位到具体工作项时不应逐模块产生通知");
  assert.ok(areaLevel.length >= 1, "应收敛成一条区域级影响");
  assert.ok(
    areaLevel[0].evidence.some((item) => item.type === "path" && item.id === "src/shared-area/service/Beta.java"),
    "收敛成区域影响也要留下实际命中的文件，否则收到通知的人无从复核"
  );
});
