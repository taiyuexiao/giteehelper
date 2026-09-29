import test from "node:test";
import assert from "node:assert/strict";
import { buildCommitImpactCard } from "../src/server/feishu.js";
import { analyzeEvent, isOperationalModule, tokenize } from "../src/server/impact.js";
import { execute, queryOne } from "../src/server/db.js";
import { seed } from "../src/server/seed.js";

seed();

test("提交影响卡片按负责人分组，并给出提交者邮箱与链接", () => {
  const card = buildCommitImpactCard(
    [{
      shortSha: "abc12345",
      summary: "修复缺陷（WS-2283）：修正缓存穿透",
      authorName: "Liu Chengyan",
      authorEmail: "liuchy@bosc.cn",
      url: "https://gitee.com/x/y/commit/abc12345",
      branch: "main",
      committedAt: new Date().toISOString(),
      linkCount: 3
    }],
    [
      { moduleName: "题库 · 评测集本体", owner: "刘成彦", severity: "implementation" },
      { moduleName: "题库 · 删除评测集", owner: "刘成彦", severity: "implementation" },
      { moduleName: "底座 · 数据库换成 MySQL 8", owner: "顾乡", severity: "contract" }
    ],
    { baseUrl: "http://host/giteehelper" }
  );
  assert.ok(card.includes("liuchy@bosc.cn"), "必须给出提交者邮箱（共用账号时账号名没有区分度）");
  assert.ok(card.includes("https://gitee.com/x/y/commit/abc12345"), "必须给出可点击的提交链接");
  assert.ok(card.includes("影响 2 人 · 3 个工作项"));
  assert.ok(card.includes("▸ 刘成彦") && card.includes("▸ 顾乡"), "按人分组");
  assert.ok(card.includes("题库 · 评测集本体"), "列出具体工作项");
  assert.ok(card.includes("⚠"), "契约级要标出来");
  assert.ok(card.includes("http://host/giteehelper/repo"), "给出控制台链接");
  assert.ok(card.length < 1400);
});

test("没有命中任何模块时也要明确说明", () => {
  const card = buildCommitImpactCard(
    [{ shortSha: "a", summary: "chore: 调整", authorName: "X", authorEmail: "x@y.z", url: null, branch: "main", committedAt: null, linkCount: 0 }],
    []
  );
  assert.ok(card.includes("没有命中"));
  assert.ok(card.includes("x@y.z"));
});

test("跨虚词的切词碎片不再参与匹配", () => {
  // 「与安全」「项目与」「的测试」这类不是词，是 n-gram 切过连词/助词的产物
  const terms = tokenize("项目与权限的测试与安全校验");
  for (const junk of ["与安全", "项目与", "的测试", "与权限", "与校验"]) {
    assert.equal(terms.includes(junk), false, `${junk} 不该作为候选词`);
  }
  assert.ok(terms.includes("安全校验") || terms.includes("安全"), "真实词要保留");
});

test("通用文档词不会把每个模块都拉进来", () => {
  assert.equal(isOperationalModule({ moduleKey: "demo", name: "[示例] 模块" }), false);
  assert.equal(isOperationalModule({ moduleKey: "legacy", name: "[旧导入] 模块" }), false);

  const projectId = queryOne<{ id: number }>(`SELECT id FROM projects ORDER BY id LIMIT 1`)!.id;
  const inserted = execute(
    `INSERT INTO modules (project_id, module_key, name, status, paths_json, scenarios_json, provides_json, requires_json, description)
     VALUES (?, 'generic-doc-module', '泛化文档模块', 'not_started', '[]', '[]', '[]', '[]', ?)`,
    [projectId, "包含功能、文档、数据和项目内容。"]
  );
  const moduleId = Number(inserted.lastInsertRowid);
  try {
    const result = analyzeEvent({
      source: "gitee",
      sourceId: `generic-${Date.now()}`,
      eventType: "pull_request",
      action: "open",
      title: "功能文档数据项目更新",
      author: "tester",
      branch: "feature/docs",
      payload: { files: [], body: "功能文档数据项目更新" }
    });
    assert.equal(result.impacts.some((impact) => impact.moduleId === moduleId), false);
  } finally {
    execute(`DELETE FROM impacts WHERE module_id = ?`, [moduleId]);
    execute(`DELETE FROM modules WHERE id = ?`, [moduleId]);
  }
});

/**
 * 通知可信度的底线：靠词面猜出来的影响不能写成结论。
 * 收到通知的人要能一眼看出哪条有文件依据、哪条只是线索。
 */
test("有路径证据的写确定，只有语义匹配的标成线索", () => {
  const card = buildCommitImpactCard(
    [{
      shortSha: "abc12345", summary: "docs(BOSC-0102): 修订指标口径", authorName: "袁毅堂",
      authorEmail: "yuanyt@bosc.cn", url: "https://gitee.com/x/y/commit/abc12345",
      branch: "main", committedAt: new Date().toISOString(), linkCount: 1
    }],
    [
      {
        moduleName: "评分 · 自动评分与重新评分", owner: "袁毅堂", severity: "contract",
        reasonLabel: "契约字段已改，实现需跟改", reasonAction: "对照契约更新实现",
        grounded: true, evidenceHint: "docs/rfcs/20260914-scoring-jobs-and-scores.mdx"
      },
      {
        moduleName: "报告 · 指标统计页签", owner: "厉福超", severity: "implementation",
        reasonLabel: "口径可能不一致", reasonAction: "确认口径",
        grounded: false, evidenceHint: null
      }
    ]
  );
  assert.match(card, /1 项有文件路径证据（确定）/, "要给出确定项计数");
  assert.match(card, /1 项仅语义匹配（线索，请人工判断）/, "要给出线索项计数");
  assert.match(card, /报告 · 指标统计页签（线索）/, "线索项必须就地标注，不能只在小结里说");
  assert.match(card, /依据：docs\/rfcs\/20260914-scoring-jobs-and-scores\.mdx/, "有路径依据的要写出具体文件");
  assert.match(card, /yuanyt@bosc\.cn/, "提交者邮箱是共用账号下区分人的唯一依据");
});

/**
 * 踩过的坑（生产真实消息）：PR !309 的一次 update 被写成"提交者 Yuan Yitang"，
 * 而 Gitee 上显示的是 guxiang 推送、新提交的作者是 LiuChengyan，时间也差了一天。
 * 根因有两个：`/pulls/{n}/commits` 是新提交在前且会分页，取 at(-1) 拿到的是最老的提交；
 * 卡片只写"提交者"一个身份，把共用账号和代码作者混在一起。
 */
test("卡片区分代码作者与推送账号，时间取真实提交", () => {
  const card = buildCommitImpactCard(
    [{
      shortSha: "d0cd1b4e", summary: "feat(scoring): 建评分发起、评估任务与机器分三张表",
      authorName: "LiuChengyan", authorEmail: "liuchy@bosc.cn",
      url: "https://gitee.com/shanghai-bank_1/agent-evaluation-platform/pulls/309",
      branch: "feat/yuanyt/BOSC-0100-scoring-jobs-and-scores",
      committedAt: new Date().toISOString(), linkCount: 0,
      actorLogin: "gux12", actorName: "gavinxgu",
      pullAuthorName: "LiuChengyan", pullAuthorLogin: "liu-chengyy"
    }],
    []
  );
  assert.match(card, /提交作者：LiuChengyan <liuchy@bosc\.cn>/, "代码作者要带邮箱（共用账号时靠它区分人）");
  assert.match(card, /推送账号：gavinxgu \/ gux12（Gitee 账号）/, "按下面板的人也要能看到是谁推的");
  assert.match(card, /分支 feat\/yuanyt\/BOSC-0100-scoring-jobs-and-scores/, "要写源分支，不能写目标分支 main");
});

test("PR 作者与提交作者不同时才额外写一行", () => {
  const base = {
    shortSha: "d0cd1b4e", summary: "feat(scoring): 建三张表", authorName: "Gu Xiang", authorEmail: "guxiang@dev.bosc",
    url: null, branch: "feat/x", committedAt: new Date().toISOString(), linkCount: 0,
    actorLogin: "gux12", actorName: "gavinxgu"
  };
  const same = buildCommitImpactCard([{ ...base, pullAuthorName: "Gu Xiang", pullAuthorLogin: "guxiang" }], []);
  assert.doesNotMatch(same, /PR 作者：/, "作者相同就不该多一行噪音");
  const diff = buildCommitImpactCard([{ ...base, pullAuthorName: "LiuChengyan", pullAuthorLogin: "liu-chengyy" }], []);
  assert.match(diff, /PR 作者：LiuChengyan（liu-chengyy）/, "开 PR 的人是对齐时的第一联系人");
});

test("PR 提交列表按 head sha 定位，而不是按位置取最后一个", async () => {
  const { pickHeadCommit } = await import("../src/server/gitee.js");
  // Gitee 返回顺序：新提交在前
  const commits = [
    { sha: "d0cd1b4e63ef", email: "liuchy@bosc.cn", name: "LiuChengyan", message: "newest", date: "2026-09-29T10:00:00+08:00" },
    { sha: "4598f039aaaa", email: "yuanyt@bosc.cn", name: "Yuan Yitang", message: "oldest", date: "2026-09-28T09:56:22+08:00" }
  ];
  assert.equal(pickHeadCommit(commits, "d0cd1b4e63ef7a21fdcf782e8101d43a8f3f5f69")?.name, "LiuChengyan");
  assert.equal(pickHeadCommit(commits, null)?.name, "LiuChengyan", "没有 head sha 时按时间取最新");
  assert.equal(pickHeadCommit([...commits].reverse(), null)?.name, "LiuChengyan", "顺序颠倒也要取到最新的");
});
