import test from "node:test";
import assert from "node:assert/strict";
import {
  associatePull, authorsFromCommits, buildBoard, buildUserIndex, classifyPullKind, extractWorkRefs,
  groupOf, parseAssignmentCsv, rfcSlugsOfFiles, taskStateOf, upsertIdentityAlias,
  type PullCore, type TaskModule
} from "../src/server/progress.js";
import { execute, queryOne } from "../src/server/db.js";
import { seed } from "../src/server/seed.js";

seed();

test("PR 分类：只改 docs/ 是文档 PR，沾代码就是代码 PR，无文件按标题猜", () => {
  assert.equal(classifyPullKind(["docs/rfcs/a.mdx", "docs/rfcs/meta/a.json"], ""), "doc");
  assert.equal(classifyPullKind(["docs/rfcs/a.mdx", "src/main/java/A.java"], ""), "code");
  assert.equal(classifyPullKind([], "docs(BOSC-0102): 修订口径"), "doc");
  assert.equal(classifyPullKind([], "feat(scoring): 建表"), "unknown");
  assert.equal(classifyPullKind([], "修订 RFC 评审意见"), "doc");
});

test("工作项编号与 RFC slug 的提取", () => {
  assert.deepEqual(extractWorkRefs("feat(BOSC-0100): 建评分表\n关联 WS-2283"), ["work-bosc-0100", "work-ws-2283"]);
  assert.deepEqual(
    rfcSlugsOfFiles(["docs/rfcs/20260914-scoring.mdx", "docs/rfcs/meta/20260914-scoring.json", "docs/rfcs/assets/20260914-scoring/spec/x.md"]),
    ["20260914-scoring"]
  );
});

function pull(overrides: Partial<PullCore>): PullCore {
  return {
    number: 1, title: "", body: "", state: "merged", authorLogin: null, url: null, headRef: null,
    createdAt: null, updatedAt: null, mergedAt: null, additions: 0, deletions: 0, files: [],
    ...overrides
  };
}

const tasks: TaskModule[] = [
  { id: 1, key: "work-bosc-0100", name: "评分 · A", ownerUserId: null, paths: ["docs/rfcs/20260914-scoring.mdx", "src/review/**"], group: "评分" },
  { id: 2, key: "work-bosc-0101", name: "评分 · B", ownerUserId: null, paths: ["docs/rfcs/20260914-scoring.mdx"], group: "评分" },
  { id: 3, key: "work-bosc-0102", name: "报告 · C", ownerUserId: null, paths: ["src/report/**"], group: "报告" }
];

test("关联走三级证据：编号 > RFC 路径 > 模式，同一 RFC 的兄弟任务一起命中", () => {
  const rfcIndex = new Map([["20260914-scoring", ["work-bosc-0100", "work-bosc-0101"]]]);

  // ref 路由：标题编号直接命中，且不再扫描路径
  const byRef = associatePull(pull({ title: "feat(BOSC-0100): 建评分表", files: ["src/review/A.java"] }), tasks, rfcIndex);
  assert.deepEqual(byRef, [{ moduleId: 1, evidence: "ref" }]);

  // rfc 路由：meta 文件同时命中共享同一 RFC 的两个任务
  const byRfc = associatePull(pull({ title: "docs: 修订评分 RFC", files: ["docs/rfcs/meta/20260914-scoring.json"] }), tasks, rfcIndex);
  assert.deepEqual(byRfc.map((item) => item.moduleId).sort(), [1, 2]);
  assert.ok(byRfc.every((item) => item.evidence === "rfc"));

  // path 路由：代码文件命中模式
  const byPath = associatePull(pull({ title: "feat: 调整", files: ["src/report/X.java"] }), tasks, rfcIndex);
  assert.deepEqual(byPath, [{ moduleId: 3, evidence: "path" }]);

  // 弱证据被强证据覆盖
  const mixed = associatePull(pull({ title: "fix(BOSC-0102): x", files: ["src/report/X.java"] }), tasks, rfcIndex);
  assert.deepEqual(mixed, [{ moduleId: 3, evidence: "ref" }]);
});

test("分支名里的任务编号与 RFC slug 也参与关联", () => {
  const rfcIndex = new Map([["20260914-scoring", ["work-bosc-0100"]]]);
  // 分支带 BOSC 编号 → ref 路由
  const byBranchRef = associatePull(pull({ title: "feat: 调整", headRef: "feat/yuanyt/BOSC-0100-scoring-jobs" }), tasks, rfcIndex);
  assert.deepEqual(byBranchRef, [{ moduleId: 1, evidence: "ref" }]);
  // 分支带 RFC slug（去掉日期前缀）→ rfc 路由
  const byBranchSlug = associatePull(pull({ title: "chore: 更新", headRef: "feat/x/scoring-jobs-and-scores-t3" }), tasks, rfcIndex);
  assert.deepEqual(byBranchSlug.map((item) => item.moduleId).sort(), [1, 2]);
  // 没有任何证据就不硬关联
  assert.deepEqual(associatePull(pull({ title: "chore: 杂项", headRef: "chore/misc" }), tasks, rfcIndex), []);
});

test("五态状态机：merged 才算完成，RFC merged 是设计定稿", () => {
  assert.equal(taskStateOf([]), "not_started");
  assert.equal(taskStateOf([{ kind: "doc", state: "open" }]), "designing");
  assert.equal(taskStateOf([{ kind: "doc", state: "merged" }]), "designed");
  assert.equal(taskStateOf([{ kind: "doc", state: "merged" }, { kind: "code", state: "open" }]), "developing");
  assert.equal(taskStateOf([{ kind: "doc", state: "merged" }, { kind: "code", state: "merged" }]), "done");
  assert.equal(taskStateOf([{ kind: "code", state: "merged" }]), "done");
  // closed 未合并不点亮任何状态
  assert.equal(taskStateOf([{ kind: "code", state: "closed" }]), "not_started");
});

test("全景分组优先取 group_name，回退 description 的能力域", () => {
  assert.equal(groupOf({ key: "work-x", group: "评分", description: null }), "评分");
  assert.equal(groupOf({ key: "work-x", group: null, description: "飞书工作项 BOSC-1｜能力域：评分与复核｜技术负责人：某人" }), "评分与复核");
  assert.equal(groupOf({ key: "work-x", group: null, description: null }), "未分组");
  assert.equal(groupOf({ key: "module-x", group: null, description: null }), null);
});

test("CSV 导入解析：逗号/制表符、列别名、缺列报错", () => {
  const csv = "模块,任务,负责人,编号\n评分,自动评分,袁毅堂,BOSC-0100\n评分,一致性,袁毅堂,BOSC-0102\n报告,基础指标,厉福超,BOSC-0101";
  const preview = parseAssignmentCsv(csv);
  assert.equal(preview.modules.length, 2);
  assert.equal(preview.modules[0].name, "评分");
  assert.deepEqual(preview.modules[0].owners, ["袁毅堂"]);
  assert.equal(preview.modules[0].tasks[0].key, "BOSC-0100");

  const tsv = parseAssignmentCsv("模块\t任务\t负责人\n题库\t基础CRUD\t刘成彦");
  assert.equal(tsv.modules[0].tasks[0].owner, "刘成彦");

  assert.throws(() => parseAssignmentCsv("a,b\n1,2"), /模块/);
});

test("带库的全景：按导入数据算出五态与分组", () => {
  const projectId = queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)!.id;
  const owner = queryOne<{ id: number }>(`SELECT id FROM users ORDER BY id LIMIT 1`)!.id;
  execute(
    `INSERT INTO modules (project_id, module_key, name, owner_user_id, group_name) VALUES (?, 'prog-top', '进度测试域', ?, NULL)`,
    [projectId, owner]
  );
  execute(
    `INSERT INTO modules (project_id, module_key, name, owner_user_id, group_name) VALUES (?, 'prog-report', '进度报告', ?, NULL)`,
    [projectId, owner]
  );
  const mkTask = (key: string, name: string, paths: string) =>
    execute(
      `INSERT INTO modules (project_id, module_key, name, owner_user_id, group_name, paths_json) VALUES (?, ?, ?, ?, '进度测试域', ?)`,
      [projectId, key, name, owner, paths]
    ).lastInsertRowid;
  const doneTask = Number(mkTask("work-prog-done", "进度 · 已完成", JSON.stringify(["src/prog-done/**"])));
  const devTask = Number(mkTask("work-prog-dev", "进度 · 开发中", JSON.stringify(["src/prog-dev/**"])));
  const designedTask = Number(mkTask("work-prog-designed", "进度报告 · 设计定稿", JSON.stringify(["docs/prog/**"])));
  // 能力域名与顶层模块名不一致时走别名表（生产上 执行与证据 → 运行 就是这种）
  execute(
    `INSERT INTO module_group_aliases (project_id, group_name, module_id) VALUES (?, '进度测试域报告线', (SELECT id FROM modules WHERE module_key = 'prog-report' AND project_id = ?))`,
    [projectId, projectId]
  );
  execute(
    `UPDATE modules SET group_name = '进度测试域报告线' WHERE id = ?`,
    [designedTask]
  );
  try {
    const mkPull = (number: number, state: string, files: string[], title: string) =>
      execute(
        `INSERT INTO pull_requests (project_id, number, title, body, state, author_login, files_json)
         VALUES (?, ?, ?, '', ?, 'tester', ?)`,
        [projectId, number, title, state, JSON.stringify(files)]
      );
    mkPull(9001, "merged", ["docs/prog/rfc.mdx"], "docs: 进度测试 RFC");
    mkPull(9002, "merged", ["src/prog-done/A.java"], "feat: 进度测试完成");
    mkPull(9003, "open", ["src/prog-dev/A.java"], "feat: 进度测试开发中");
    mkPull(9004, "merged", ["src/prog-designed/B.java"], "feat: 不相关的旧提交");

    const board = buildBoard(projectId);
    const group = board.groups.find((item) => item.name === "进度测试域");
    assert.ok(group, "分组应存在");
    const byId = new Map(group.tasks.map((task) => [task.moduleId, task]));
    assert.equal(byId.get(doneTask)?.state, "done");
    assert.equal(byId.get(devTask)?.state, "developing");
    // 别名表把「进度测试域报告线」挂到顶层模块「进度报告」，负责人随顶层模块解析
    const reportGroup = board.groups.find((item) => item.name === "进度测试域报告线");
    assert.ok(reportGroup, "别名分组应存在");
    assert.equal(reportGroup.ownerName, "系统管理员");
    assert.equal(reportGroup.tasks.find((task) => task.moduleId === designedTask)?.state, "designed");
    assert.equal(board.summary.total >= 3, true);
  } finally {
    execute(`DELETE FROM pull_requests WHERE project_id = ? AND number BETWEEN 9001 AND 9004`, [projectId]);
    execute(`DELETE FROM module_group_aliases WHERE project_id = ? AND group_name = '进度测试域报告线'`, [projectId]);
    execute(`DELETE FROM modules WHERE project_id = ? AND (module_key LIKE 'work-prog-%' OR module_key IN ('prog-top', 'prog-report'))`, [projectId]);
  }
});

test("身份解析：login → 提交署名 → 用户，别名表参与解析", () => {
  const projectId = queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)!.id;
  const user = queryOne<{ id: number }>(`SELECT id FROM users WHERE display_name = '系统管理员'`)!.id;
  upsertIdentityAlias("tester-login", user, projectId);
  try {
    const index = buildUserIndex(projectId);
    assert.equal(index.byLogin.get("tester-login"), user);
    // login 对应的提交署名也能归到人
    assert.equal(index.resolveCommit("someone-else", "系统管理员", null), user);
  } finally {
    execute(`DELETE FROM identity_aliases WHERE project_id = ? AND alias = 'tester-login'`, [projectId]);
  }
});

/**
 * 团队约定：登录账号共用（大家用刘成彦的号操作），PR 的真实作者只能看
 * PR 内提交的署名邮箱。Merge 同步提交是评审人的合并动作，不算作者；
 * 整条 PR 全是 Merge 时退回 head 提交的作者。
 */
test("PR 作者解析：剔除 Merge 同步提交，全 Merge 时退回 head 提交作者", () => {
  const authors = authorsFromCommits([
    { sha: "a1", email: "guxiang@dev.bosc", name: "Gu Xiang", message: "Merge branch 'main' into feature/x", date: null },
    { sha: "a2", email: "shipl2@bosc.cn", name: "Shi Peilin", message: "docs: 真实工作", date: null }
  ], null);
  assert.deepEqual(authors, [{ name: "Shi Peilin", email: "shipl2@bosc.cn" }]);

  const headOnly = authorsFromCommits([
    { sha: "b1", email: "guxiang@dev.bosc", name: "Gu Xiang", message: "Merge branch 'main'", date: "2026-09-29T10:00:00+08:00" }
  ], "b1abcdef");
  assert.deepEqual(headOnly, [{ name: "Gu Xiang", email: "guxiang@dev.bosc" }]);
});
