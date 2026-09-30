import test from "node:test";
import assert from "node:assert/strict";
import { pickHistoricalHead } from "../src/server/pulls.js";

/**
 * 生产踩过的坑（PR !309）：旧实现取 `/pulls/{n}/commits` 的 at(-1)（最老提交）当"提交者"，
 * 一次 update 被写成"提交者 Yuan Yitang"，而真实新提交（d0cd1b4）的作者是另一个人。
 * backfill-pull-head 重算历史事件时必须按事件当时的 head sha 定位，绝不按列表位置猜。
 */
const commits = [
  { sha: "d0cd1b4e63ef", email: "liuchy@bosc.cn", name: "LiuChengyan", message: "newest", date: "2026-09-29T10:02:00+08:00" },
  { sha: "aaaa00001111", email: "mid@bosc.cn", name: "Mid Author", message: "middle", date: "2026-09-29T09:00:00+08:00" },
  { sha: "4598f039aaaa", email: "yuanyt@bosc.cn", name: "Yuan Yitang", message: "oldest", date: "2026-09-28T09:56:22+08:00" }
];

test("历史事件按事件当时的 head sha 定位提交者，列表顺序无关", () => {
  const newestFirst = pickHistoricalHead(commits, "d0cd1b4e63ef7a21fdcf782e", "2026-09-29 02:05:00");
  assert.equal(newestFirst?.name, "LiuChengyan");
  // 列表顺序颠倒（最老在前）也不能拿到最老提交——这正是踩过的坑
  const oldestFirst = pickHistoricalHead([...commits].reverse(), "d0cd1b4e63ef", "2026-09-29 02:05:00");
  assert.equal(oldestFirst?.name, "LiuChengyan");
});

test("head sha 缺失或已被 force push 抹掉时，取事件时刻之前的最新提交", () => {
  // 事件发生在 09:30（+08:00）：10:02 的提交在事件时还不存在，不能拿
  const bounded = pickHistoricalHead([...commits].reverse(), null, "2026-09-29 01:30:00");
  assert.equal(bounded?.name, "Mid Author");

  // head sha 不在当前列表里（历史被改写）→ 退回时间界，仍取到事件时刻的最新
  const rewritten = pickHistoricalHead(commits, "deadbeef0000", "2026-09-29 02:05:00");
  assert.equal(rewritten?.name, "LiuChengyan");
});

test("事件时刻之前没有任何提交时如实返回 null，不猜", () => {
  assert.equal(pickHistoricalHead(commits, null, "2026-09-01 00:00:00"), null);
  assert.equal(pickHistoricalHead([], "d0cd1b4e", null), null);
  assert.equal(pickHistoricalHead(commits, null, null), null);
});
