/**
 * 进度数据 xlsx 导出。四张表与数据分析口径一致：
 *   PR明细 / 按人汇总(提交邮箱) / 按登录账号 / 未识别作者
 * 每次下载现算——数据由 WebHook 实时入库，导出永远是当前状态。
 */
import ExcelJS from "exceljs";
import { buildPullDetails } from "./progress.js";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE8EE" } } as const;

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
}

export async function buildProgressWorkbook(projectId = 1): Promise<Buffer> {
  const details = buildPullDetails(projectId);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GiteeHelper";

  // ---- Sheet1: PR 明细 ----
  const detail = workbook.addWorksheet("PR明细");
  detail.columns = [
    { header: "编号", key: "number", width: 8 },
    { header: "标题", key: "title", width: 50 },
    { header: "状态", key: "state", width: 9 },
    { header: "登录账号", key: "authorLogin", width: 14 },
    { header: "提交作者（邮箱口径）", key: "authorNames", width: 28 },
    { header: "提交邮箱", key: "authorEmails", width: 32 },
    { header: "创建时间", key: "createdAt", width: 18 },
    { header: "合并时间", key: "mergedAt", width: 18 },
    { header: "耗时(小时)", key: "hours", width: 11 },
    { header: "分支", key: "headRef", width: 34 },
    { header: "+行", key: "additions", width: 8 },
    { header: "-行", key: "deletions", width: 8 },
    { header: "文件数", key: "fileCount", width: 8 },
    { header: "关联任务", key: "tasks", width: 44 }
  ];
  styleHeader(detail.getRow(1));
  for (const item of details) {
    detail.addRow({
      ...item,
      authorNames: item.authorNames.join("、") || "(未识别)",
      authorEmails: item.authorEmails.join("、"),
      tasks: item.tasks.join("、"),
      headRef: (item.headRef ?? "").slice(0, 40)
    });
  }
  detail.views = [{ state: "frozen", ySplit: 1 }];

  // ---- Sheet2: 按人汇总（提交邮箱口径） ----
  const pivot = new Map<string, { merged: number; open: number; closed: number; doc: number; code: number; add: number; del: number; hours: number[] }>();
  for (const item of details) {
    const labels = item.authorNames.length ? item.authorNames : ["(未识别)"];
    for (const label of labels) {
      const stat = pivot.get(label) ?? { merged: 0, open: 0, closed: 0, doc: 0, code: 0, add: 0, del: 0, hours: [] as number[] };
      if (item.state === "merged") {
        stat.merged += 1;
        if (item.hoursToMerge !== null) stat.hours.push(item.hoursToMerge);
      } else if (item.state === "open") stat.open += 1;
      else stat.closed += 1;
      if (item.kind === "doc") stat.doc += 1;
      else stat.code += 1;
      stat.add += item.additions;
      stat.del += item.deletions;
      pivot.set(label, stat);
    }
  }
  const summary = workbook.addWorksheet("按人汇总(提交邮箱)");
  summary.columns = [
    { header: "成员（提交邮箱解析）", key: "name", width: 26 },
    { header: "合并PR", key: "merged", width: 9 },
    { header: "在飞PR", key: "open", width: 9 },
    { header: "关闭未合PR", key: "closed", width: 12 },
    { header: "文档PR", key: "doc", width: 9 },
    { header: "代码PR", key: "code", width: 9 },
    { header: "+行", key: "add", width: 9 },
    { header: "-行", key: "del", width: 9 },
    { header: "平均合并(小时)", key: "avg", width: 15 }
  ];
  styleHeader(summary.getRow(1));
  for (const [name, stat] of [...pivot.entries()].sort((a, b) => b[1].merged - a[1].merged)) {
    summary.addRow({
      name,
      merged: stat.merged,
      open: stat.open,
      closed: stat.closed,
      doc: stat.doc,
      code: stat.code,
      add: stat.add,
      del: stat.del,
      avg: stat.hours.length ? Math.round((stat.hours.reduce((sum, h) => sum + h, 0) / stat.hours.length) * 10) / 10 : "—"
    });
  }
  const noteRow = summary.addRow([]);
  noteRow.getCell(1).value =
    "注：一条 PR 有多个提交作者时每人各计一次，合计会大于 PR 总数。Merge 同步提交未计入作者。登录账号为共用账号，不代表作者。";
  noteRow.getCell(1).font = { italic: true };

  // ---- Sheet3: 按登录账号（展示共用账号问题） ----
  const byLogin = new Map<string, { total: number; merged: number; open: number; closed: number; authors: Set<string> }>();
  for (const item of details) {
    const login = item.authorLogin ?? "(空)";
    const stat = byLogin.get(login) ?? { total: 0, merged: 0, open: 0, closed: 0, authors: new Set<string>() };
    stat.total += 1;
    if (item.state === "merged") stat.merged += 1;
    else if (item.state === "open") stat.open += 1;
    else stat.closed += 1;
    for (const name of item.authorNames) stat.authors.add(name);
    byLogin.set(login, stat);
  }
  const accounts = workbook.addWorksheet("按登录账号");
  accounts.columns = [
    { header: "登录账号", key: "login", width: 16 },
    { header: "PR总数", key: "total", width: 9 },
    { header: "merged", key: "merged", width: 9 },
    { header: "open", key: "open", width: 8 },
    { header: "closed", key: "closed", width: 9 },
    { header: "涉及的提交作者（去重）", key: "authors", width: 70 }
  ];
  styleHeader(accounts.getRow(1));
  for (const [login, stat] of [...byLogin.entries()].sort((a, b) => b[1].total - a[1].total)) {
    accounts.addRow({ login, ...stat, authors: [...stat.authors].sort().join("、") || "—" });
  }

  // ---- Sheet4: 未识别作者 ----
  const unknown = workbook.addWorksheet("未识别作者");
  unknown.columns = [
    { header: "编号", key: "number", width: 8 },
    { header: "标题", key: "title", width: 60 },
    { header: "状态", key: "state", width: 9 },
    { header: "登录账号", key: "authorLogin", width: 14 },
    { header: "创建时间", key: "createdAt", width: 18 }
  ];
  styleHeader(unknown.getRow(1));
  for (const item of details.filter((item) => item.authorNames.length === 0)) {
    unknown.addRow(item);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
