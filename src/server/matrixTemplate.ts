/**
 * 责任矩阵全景模板：按「大模块 → 交付项」粒度的手工策展基线。
 *
 * 数据来源：2026-10-06 对 agent-evaluation-platform 的 main 与 Gitee PR 列表的实际核查
 * （评分规则库 RFC-20260911、过程断言 RFC-20261003、评估器组 RFC-20260923、
 * 评分执行 RFC-20260914 及其余各线的合入/在途 PR）。模板只给基线，落库后仍人工维护；
 * PR 号落库后由 listMatrixRows 按本地 PR 缓存自动解析出状态、交付面与链接。
 *
 * 导入模式：merge = 只补不存在的（组名+小模块名）行；replace = 清空本项目矩阵行后重建。
 */
import { audit, execute, queryAll } from "./db.js";

export interface MatrixTemplateRow {
  groupName: string;
  itemName: string;
  owner: string;
  prNumbers: string;
  blocked: boolean | null;
  blockerModule: string;
  blockerOwner: string;
  blockerProgress: string;
  engageNote: string;
  statusNote: string;
}

export const MATRIX_TEMPLATE: MatrixTemplateRow[] = [
  /* ---------- 评分规则库（RFC-20260911 · BOSC-0060~0067 · 师沛琳） ---------- */
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T1 评分器身份与版本", owner: "师沛琳",
    prNumbers: "!146, !324, !433", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "三表迁移、CRUD、归档/恢复/删除、版本不可变均已在 main"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T2 判法引擎与样题验证", owner: "师沛琳",
    prNumbers: "!343, !440", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "精确匹配/关键词/过程断言五型 + 大模型只做参数校验"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T2′ 大模型创建门禁（0042）", owner: "师沛琳",
    prNumbers: "!486, !464", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "真实调用未接通前按 0042 拒绝创建 llm_score"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T3 可选项与生命周期查询", owner: "师沛琳",
    prNumbers: "!343, !437, !522", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "selectable 收敛点、references 只读；!522 完成 meta 状态对账"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T4 证据语义与槽位契约夹具", owner: "师沛琳",
    prNumbers: "!432", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "拒绝 TRACE/$ref/对象槽位的路径已在 main"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T5 版本 digest 与指纹夹具", owner: "师沛琳",
    prNumbers: "!343, !522", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "versionDigest 在 EvaluatorService/GroupService"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T6 错误合同与真库交付", owner: "师沛琳",
    prNumbers: "!343, !433", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "ErrorCode 登记、幂等键、Testcontainers IT 随各 PR 分批交付"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "Q21 证据要求列取值表", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "Q21：evidence_requirements 取值表与承载迁移未定，关闭前不得建列",
    blockerOwner: "评分负责人（元作业归师沛琳）＋需求 owner",
    blockerProgress: "RFC accepted（!83）；无任何 PR",
    engageNote: "可以：写作者侧候选取值表送审，是少数能主动推的解锁点",
    statusNote: "未动"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "Q22 大模型模板规格回填", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "Q22：WS-2454 四项大模型模板规格（ID/提示词/变量）未回填进仓",
    blockerOwner: "WS-2454 规格所有者＋需求 owner",
    blockerProgress: "无 RFC、无 PR、规格文件不存在",
    engageNote: "有限：推荐方案就是等规格方，只能提候选稿，不能替关",
    statusNote: "未动"
  },

  /* ---------- 过程断言（RFC-20261003 · 师沛琳） ---------- */
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T1 断言类型必填矩阵", owner: "师沛琳",
    prNumbers: "!490", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "矩阵收进注册表声明，保存校验与清单渲染同源"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T2 断言引擎五型与三值合成", owner: "师沛琳",
    prNumbers: "!506", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "必须出现/不得出现/出现次数/两步先后/耗时上限"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T3 前半 findings 形状段", owner: "师沛琳",
    prNumbers: "!540", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "JudgmentResult.findings 第五字段已合入"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T3 后半 findings 落存储", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "评分执行处理器：按实现标识取判法的调用链（ScoringShardWorker）在 main 不存在",
    blockerOwner: "评分执行线（RFC-20260914 写袁毅堂；实际归属待顾乡裁定）",
    blockerProgress: "RFC accepted（!94/!173）；三表迁移与 scoring 包骨架在 main（!300/!383）；worker 无 PR",
    engageNote: "部分：findings 序列化合同/夹具可先交付，落点等 worker 接缝",
    statusNote: "未动"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T4 前半 TRACE/对象槽位拒绝路径", owner: "师沛琳",
    prNumbers: "!432", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "随 T4 契约夹具已在 main"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T4 后半 TRACE 槽位登记", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "Q9 内置 schema 登记 ＋ Q11 NormalizedTrace 字段/真实来源/完整度联合冻结",
    blockerOwner: "trace 规范化线（gux12）＋运行模块＋需求 owner 联审",
    blockerProgress: "规范化篇、图契约 RFC accepted；单题证据篇仍 draft；执行域 !478 在途",
    engageNote: "否：登记动作不能抢跑，拒绝路径已备好",
    statusNote: "未动"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "Q10 对象型槽位", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "Q10：首版是否开放对象槽位未裁定，关闭前只支持标量数组槽位",
    blockerOwner: "需求 owner＋实验映射（饶铮）＋评分规则三方确认",
    blockerProgress: "无 RFC、无 PR",
    engageNote: "可提候选方案，关闭权在需求 owner",
    statusNote: "未动"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T5 过程模板可用状态门槛", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "自身依赖 T4 后半：模板 AVAILABLE 需引擎＋登记＋真实轨迹联测三齐备",
    blockerOwner: "师沛琳（等 T4 解锁）",
    blockerProgress: "—",
    engageNote: "部分：门槛判定逻辑可先写，AVAILABLE 永远等 T4",
    statusNote: "未动"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T6 真实脱敏轨迹联测验收", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "真实脱敏轨迹＋HiAgent 接入（协议/环境/凭据三缺）",
    blockerOwner: "行方（真实样本）＋运行模块（gux12，执行域 !478 在途）",
    blockerProgress: "外部接入规范口径 BLOCKED；执行域 PR 在途但真实 E2E 证据无",
    engageNote: "否",
    statusNote: "未动"
  },

  /* ---------- 评估器组（RFC-20260923 · 师沛琳） ---------- */
  {
    groupName: "评估器组（RFC-20260923）", itemName: "组后端：两表/CRUD/审计/selectable", owner: "师沛琳",
    prNumbers: "!335, !385, !422", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "评估器组（RFC-20260923）", itemName: "组管理页前端", owner: "师沛琳",
    prNumbers: "!499", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "评审已通过，等 owner 点合入"
  },

  /* ---------- 评分规则前端（师沛琳） ---------- */
  {
    groupName: "评分规则前端", itemName: "契约类型层（evaluator 域 7 接口）", owner: "师沛琳",
    prNumbers: "!417", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "评分规则前端", itemName: "规则模板与版本（列表/新建/详情/版本历史）", owner: "师沛琳",
    prNumbers: "!450", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "评分规则前端", itemName: "内容类判法配置（精确匹配/关键词）", owner: "师沛琳",
    prNumbers: "!450", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "评分规则前端", itemName: "过程类判法结构化表单外壳", owner: "师沛琳",
    prNumbers: "!523", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "规则驱动编辑器已合入（不含登记后槽位）"
  },
  {
    groupName: "评分规则前端", itemName: "大模型裁判配置面板", owner: "师沛琳",
    prNumbers: "!464, !450", blocked: true,
    blockerModule: "模板本体卡 Q22 规格＋行内大模型网关",
    blockerOwner: "Q22 规格方＋行方",
    blockerProgress: "连接字段＋启用前置（!464）已合；网关无协议/环境/授权",
    engageNote: "前半已做完，后半不可单方面推",
    statusNote: "半交付：连接字段与新建门禁在 main，模板本体未做"
  },
  {
    groupName: "评分规则前端", itemName: "样题试跑面板", owner: "师沛琳",
    prNumbers: "!450, !440", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "SampleValidatePanel 已在 main"
  },

  /* ---------- BOSC-0063 节点耗时判定（师沛琳） ---------- */
  {
    groupName: "节点耗时判定（BOSC-0063）", itemName: "MAX_DURATION 断言与「不下发超时」边界", owner: "师沛琳",
    prNumbers: "!506, !463", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "主体交付：MAX_DURATION 随 !506 在 main；「不下发超时」是不变量不是功能"
  },

  /* ---------- 实验-挂评分规则（BOSC-0076 · 归属待定） ---------- */
  {
    groupName: "实验-挂评分规则（BOSC-0076）", itemName: "绑定契约（实验领域总览）", owner: "饶铮（实验域）",
    prNumbers: "!116", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "契约已合入 main"
  },
  {
    groupName: "实验-挂评分规则（BOSC-0076）", itemName: "映射引擎（WS-2360）", owner: "饶铮",
    prNumbers: "!480, !508", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "T2 已合，T3 固定向量与合同版本收口在审"
  },
  {
    groupName: "实验-挂评分规则（BOSC-0076）", itemName: "向导「挂评分规则」页（前端）", owner: "归属待定（师沛琳 vs 饶铮向导叶相撞）",
    prNumbers: "", blocked: true,
    blockerModule: "归属未裁定：与饶铮 WS-2360 向导叶相撞",
    blockerOwner: "顾乡裁定",
    blockerProgress: "向导 preflight RFC accepted；前端仍是 WizardPlaceholder",
    engageNote: "否：裁定前不动",
    statusNote: "未动"
  },

  /* ---------- 大模型当裁判（BOSC-0070 · 师沛琳） ---------- */
  {
    groupName: "大模型当裁判（BOSC-0070）", itemName: "创建门禁与失败规则", owner: "师沛琳",
    prNumbers: "!486, !464", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "大模型当裁判（BOSC-0070）", itemName: "真实大模型调用", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "行内大模型网关：协议、非生产环境、费用授权三缺",
    blockerOwner: "行方/外部系统（外部接入规范口径）",
    blockerProgress: "无 RFC、无 PR、无凭据引用，BLOCKED",
    engageNote: "否：只能等行方",
    statusNote: "未动"
  },

  /* ---------- 评分执行与复核（袁毅堂线 / 顾乡收口） ---------- */
  {
    groupName: "评分执行（RFC-20260914 · 袁毅堂线）", itemName: "评分发起/重评/单题得分读取", owner: "袁毅堂线（顾乡收口合入）",
    prNumbers: "!300, !383", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "主体在 main；分片 worker 与判法引擎调用链未见（过程断言出线卡的正是这段）"
  },
  {
    groupName: "评分执行（RFC-20260914 · 袁毅堂线）", itemName: "人工改分持久化与批量读端口（BOSC-0108）", owner: "liuyy7",
    prNumbers: "!485, !517", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "成员评分边界已合（!517），改分核心 T2/T5 在审（!485）"
  },
  {
    groupName: "评分执行（RFC-20260914 · 袁毅堂线）", itemName: "评分指标与结果页", owner: "评分/报告线",
    prNumbers: "!144, !515, !531", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "指标 RFC 已合；结果页骨架已合（!515），E8 先行半批在审（!531）"
  },

  /* ---------- 被测对象与执行证据（guxiang 线） ---------- */
  {
    groupName: "被测对象与执行证据", itemName: "登记域：生命周期/连接/探测（WS-2330）", owner: "顾乡",
    prNumbers: "!521", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "已合入 main"
  },
  {
    groupName: "被测对象与执行证据", itemName: "执行域：可信控制/至多一次/trace 直取", owner: "顾乡",
    prNumbers: "!478", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "T007–T011 在审；是 Q9/Q11 与真实轨迹的关键路径"
  },
  {
    groupName: "被测对象与执行证据", itemName: "trace 规范化与图契约（设计）", owner: "顾乡",
    prNumbers: "", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "规范化篇/图契约 RFC 均 accepted"
  },
  {
    groupName: "被测对象与执行证据", itemName: "单题证据篇（轨迹物理载体）", owner: "执行证据线（!86 niejch 起）",
    prNumbers: "!86", blocked: true,
    blockerModule: "RFC 仍 draft，载体表未落地",
    blockerOwner: "执行证据线/顾乡",
    blockerProgress: "!86 证据 RFC 已合；20260911-attempt-evidence-process 仍 draft",
    engageNote: "否：过程断言 T4 后半等它关闭",
    statusNote: "设计未定稿"
  },

  /* ---------- 数据集与导入（他人） ---------- */
  {
    groupName: "数据集与导入", itemName: "数据集导出（BOSC-0041）", owner: "liuchy",
    prNumbers: "!467, !496", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "T1 格式引擎已合；T2 批量 ZIP 在审（!496）"
  },
  {
    groupName: "数据集与导入", itemName: "题库纯文本导入（WS-31xx）", owner: "顾乡",
    prNumbers: "!507, !511, !518", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "T1/T2 preview-confirm 在审"
  },

  /* ---------- 报告域（他人） ---------- */
  {
    groupName: "报告域", itemName: "报告宿主与交互收尾", owner: "报告线",
    prNumbers: "!514, !524, !532", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "宿主收尾与两批小修已合；走查遗留小修批在审（!532）"
  },

  /* ---------- 平台与 CI（顾乡/康旭） ---------- */
  {
    groupName: "平台与 CI", itemName: "CI 执行机与车道（WS-3059/2755）", owner: "顾乡/康旭",
    prNumbers: "!501, !504, !519, !535, !538, !539, !541, !542", blocked: false,
    blockerModule: "", blockerOwner: "", blockerProgress: "", engageNote: "",
    statusNote: "四台执行机接入、文档车道迁移、冻结清单运行化均已合入"
  }
];

/**
 * 把全景模板导进 matrix_rows。
 * merge：只补「组名+小模块名」还不存在的行；replace：清空本项目矩阵行后按模板重建。
 * 返回 {created, replaced}；replace 会记审计。
 */
export function seedMatrixTemplate(
  mode: "merge" | "replace",
  actor: string,
  projectId = 1
): { created: number; replaced: boolean } {
  if (mode === "replace") {
    const existing = queryAll<{ id: number }>(`SELECT id FROM matrix_rows WHERE project_id = ?`, [projectId]).length;
    execute(`DELETE FROM matrix_rows WHERE project_id = ?`, [projectId]);
    audit(null, actor, "matrix_template_replace", "matrix_rows", projectId, { removed: existing });
  }
  const existingKeys = new Set(
    queryAll<{ groupName: string; itemName: string }>(
      `SELECT group_name AS groupName, item_name AS itemName FROM matrix_rows WHERE project_id = ?`, [projectId]
    ).map((row) => `${row.groupName}${row.itemName}`)
  );
  let created = 0;
  let sort = Number(queryAll<{ m: number | null }>(`SELECT MAX(sort_index) AS m FROM matrix_rows WHERE project_id = ?`, [projectId])[0]?.m ?? 0);
  for (const row of MATRIX_TEMPLATE) {
    if (existingKeys.has(`${row.groupName}${row.itemName}`)) continue;
    sort += 1;
    execute(
      `INSERT INTO matrix_rows (project_id, group_name, item_name, owner, pr_numbers, blocked,
               blocker_module, blocker_owner, blocker_progress, engage_note, status_note, sort_index, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [projectId, row.groupName, row.itemName, row.owner, row.prNumbers,
       row.blocked === null ? null : row.blocked ? 1 : 0,
       row.blockerModule, row.blockerOwner, row.blockerProgress, row.engageNote, row.statusNote,
       sort, actor]
    );
    created += 1;
  }
  if (created > 0) audit(null, actor, "matrix_template_seed", "matrix_rows", projectId, { mode, created });
  return { created, replaced: mode === "replace" };
}
