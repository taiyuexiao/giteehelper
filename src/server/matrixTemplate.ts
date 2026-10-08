/**
 * 责任矩阵全景模板：按「大模块 → 交付项」粒度的手工策展基线。
 *
 * 数据来源：2026-10-08 对 agent-evaluation-platform 的 main、Gitee PR 列表与飞书分工表的实际核查；
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
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T1 评分器身份与版本", owner: "师沛琳",
    prNumbers: "!146, !324, !433", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "三表迁移、CRUD、归档/恢复/删除、版本不可变均已在 main"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T2 判法引擎与样题验证", owner: "师沛琳",
    prNumbers: "!343, !440", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "精确匹配/关键词/过程断言五型 + 大模型只做参数校验"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T2′ 大模型创建门禁（0042）", owner: "师沛琳",
    prNumbers: "!486, !464", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "真实调用未接通前按 0042 拒绝创建 llm_score"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T3 可选项与生命周期查询", owner: "师沛琳",
    prNumbers: "!343, !437, !522", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "selectable 收敛点、references 只读；!522 完成 meta 对账"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T4 证据语义与槽位契约夹具", owner: "师沛琳",
    prNumbers: "!432", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "拒绝 TRACE/$ref/对象槽位的路径已在 main"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T5 版本 digest 与指纹夹具", owner: "师沛琳",
    prNumbers: "!343, !522", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "versionDigest 在 EvaluatorService/GroupService"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "T6 错误合同与真库交付", owner: "师沛琳",
    prNumbers: "!343, !433", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "ErrorCode 登记、幂等键、Testcontainers IT 随各 PR 分批交付"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "Q21 证据要求列取值表", owner: "师沛琳",
    prNumbers: "!594", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "可以，刚解锁：迁移 A 加列→回填→对账→响应合同 required+IT，归你",
    statusNote: "取值表已冻结（!594 三轮评审通过，10-08 合入）；meta 翻 closed 待对账"
  },
  {
    groupName: "评分规则库（RFC-20260911）", itemName: "Q22 大模型模板规格回填", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "Q22：WS-2454 四项大模型模板规格（ID/提示词/变量）未回填进仓", blockerOwner: "朱奕洁（需求 owner）＋WS-2454 规格所有者（未指派）",
    blockerProgress: "无 RFC、无 PR、规格文件不存在", engageNote: "有限：只能提候选稿，关闭权在规格方",
    statusNote: "未动"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T1 断言类型必填矩阵", owner: "师沛琳",
    prNumbers: "!490", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "矩阵收进注册表声明，保存校验与清单渲染同源"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T2 断言引擎五型与三值合成", owner: "师沛琳",
    prNumbers: "!506", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "必须出现/不得出现/出现次数/两步先后/耗时上限"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T3 前半 findings 形状段", owner: "师沛琳",
    prNumbers: "!540", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "JudgmentResult.findings 第五字段已合入（10-06）"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T3 后半 findings 落存储", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "评分执行处理器按实现标识取判法的调用链（ScoringShardWorker）在 main 不存在", blockerOwner: "袁毅堂（RFC 名义）／顾乡（scoring 域事实收口）＋李苑（队列篇承接）",
    blockerProgress: "RFC accepted；三表迁移与 scoring 骨架在 main；worker 无 PR、无人认领", engageNote: "部分：序列化合同已在 !540 交付；落点等 worker 接缝，先找顾乡定归属",
    statusNote: "未动；评审已把 T3 整体翻回 pending（完整任务口径）"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T4 前半 TRACE/对象槽位拒绝路径", owner: "师沛琳",
    prNumbers: "!432", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "随 T4 契约夹具已在 main"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T4 后半 TRACE 槽位登记", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "Q9 内置 schema 登记 ＋ Q11 NormalizedTrace 字段/真实来源/完整度联合冻结", blockerOwner: "顾乡（trace 规范化/执行域）＋颜茳渭（被测对象 owner）＋聂嘉琛（单题证据篇）＋李苑（运行侧）",
    blockerProgress: "规范化篇/图契约 RFC accepted；执行域 !478 已合（10-06）；单题证据篇仍 draft", engageNote: "否：登记动作不能抢跑，拒绝路径已备好",
    statusNote: "未动"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "Q4 过程判法取值", owner: "师沛琳",
    prNumbers: "!594", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "随 Q21 一并关闭：trace 必需、其余按映射、providerCall 归 EVID-01"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "Q10 对象型槽位", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "Q10：首版是否开放对象槽位未裁定，关闭前只支持标量数组槽位", blockerOwner: "朱奕洁（需求 owner）＋饶铮（实验映射）＋师沛琳",
    blockerProgress: "无 RFC、无 PR", engageNote: "可提候选方案，关闭权在朱奕洁",
    statusNote: "未动"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T5 过程模板可用状态门槛", owner: "师沛琳",
    prNumbers: "!592", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "五条过程模板以 BLOCKED 落判法清单+卡点 note（10-07 合入）；meta 翻 implemented 待对账"
  },
  {
    groupName: "过程断言（RFC-20261003）", itemName: "T6 真实脱敏轨迹联测验收", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "真实脱敏轨迹＋HiAgent 接入（协议/环境/凭据三缺）", blockerOwner: "行方/HiAgent 侧＋颜茳渭（样本与接入顾问）＋顾乡（运行侧）",
    blockerProgress: "外部接入规范口径 BLOCKED；执行域已合但真实 E2E 证据无", engageNote: "否",
    statusNote: "未动"
  },
  {
    groupName: "评估器组（RFC-20260923）", itemName: "组后端：两表/CRUD/审计/selectable", owner: "师沛琳",
    prNumbers: "!335, !385, !422", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "评估器组（RFC-20260923）", itemName: "组管理页前端", owner: "师沛琳",
    prNumbers: "!499, !582", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "!499 评审通过后因非线性被 Gitee 拒合，!582 线性重放已于 10-07 合入"
  },
  {
    groupName: "评分规则前端", itemName: "契约类型层（evaluator 域 7 接口）", owner: "师沛琳",
    prNumbers: "!417", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "评分规则前端", itemName: "规则模板与版本（列表/新建/详情/版本历史）", owner: "师沛琳",
    prNumbers: "!450", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "评分规则前端", itemName: "内容类判法配置（精确匹配/关键词）", owner: "师沛琳",
    prNumbers: "!450", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "评分规则前端", itemName: "过程类判法结构化表单外壳", owner: "师沛琳",
    prNumbers: "!523", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "规则驱动编辑器已合入（不含登记后槽位）"
  },
  {
    groupName: "评分规则前端", itemName: "大模型裁判配置面板", owner: "师沛琳",
    prNumbers: "!464, !450", blocked: true,
    blockerModule: "模板本体卡 Q22 规格＋行内大模型网关", blockerOwner: "朱奕洁（Q22 需求 owner）＋行方",
    blockerProgress: "连接字段＋启用前置（!464）已合；网关无协议/环境/授权", engageNote: "前半已做完，后半不可单方面推",
    statusNote: "半交付：连接字段与新建门禁在 main，模板本体未做"
  },
  {
    groupName: "评分规则前端", itemName: "样题试跑面板", owner: "师沛琳",
    prNumbers: "!450, !440", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "SampleValidatePanel 已在 main"
  },
  {
    groupName: "评分规则前端", itemName: "EVALUATOR_PATHS 路径收口", owner: "师沛琳",
    prNumbers: "!585", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "11 处字面量改引常量+fetch 层钉测+变异反证，在审"
  },
  {
    groupName: "节点耗时判定（BOSC-0063）", itemName: "MAX_DURATION 断言与「不下发超时」边界", owner: "师沛琳",
    prNumbers: "!506, !463", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "主体交付：MAX_DURATION 随 !506 在 main；「不下发超时」是不变量不是功能"
  },
  {
    groupName: "实验-挂评分规则（BOSC-0076）", itemName: "绑定契约（实验领域总览）", owner: "饶铮（实验域）",
    prNumbers: "!116", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "契约已合入 main"
  },
  {
    groupName: "实验-挂评分规则（BOSC-0076）", itemName: "映射引擎（WS-2360）", owner: "饶铮",
    prNumbers: "!480, !508, !555", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "T2 已合（!480），T3 在审（!508），T5 映射候选在途（!555）"
  },
  {
    groupName: "实验-挂评分规则（BOSC-0076）", itemName: "向导「挂评分规则」页（前端）", owner: "归属待定（师沛琳 vs 饶铮向导叶）",
    prNumbers: "", blocked: true,
    blockerModule: "归属未裁定：与饶铮 WS-2360 向导叶相撞", blockerOwner: "顾乡（裁定人）",
    blockerProgress: "向导 preflight RFC accepted；前端仍是 WizardPlaceholder", engageNote: "否：裁定前不动（越等越被动）",
    statusNote: "未动"
  },
  {
    groupName: "大模型当裁判（BOSC-0070）", itemName: "创建门禁与失败规则", owner: "师沛琳",
    prNumbers: "!486, !464", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "已在 main"
  },
  {
    groupName: "大模型当裁判（BOSC-0070）", itemName: "真实大模型调用", owner: "师沛琳",
    prNumbers: "", blocked: true,
    blockerModule: "行内大模型网关：协议、非生产环境、费用授权三缺", blockerOwner: "行方（甲方/外部系统）",
    blockerProgress: "无 RFC、无 PR、无凭据引用，BLOCKED", engageNote: "否：只能等行方",
    statusNote: "未动"
  },
  {
    groupName: "部署与交付", itemName: "部署离线基线（后端 Dockerfile+五组件 Helm chart）", owner: "师沛琳",
    prNumbers: "!584", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "已合入（10-07）"
  },
  {
    groupName: "部署与交付", itemName: "镜像构建预研（路线 C 自建执行机 docker build）", owner: "师沛琳",
    prNumbers: "!595", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "三轮评审后实验记录已全程 digest 钉版+真实复跑；复审中"
  },
  {
    groupName: "部署与交付", itemName: "OIDC 登录组模板（.env.example）", owner: "师沛琳",
    prNumbers: "!614", blocked: null,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "因「拟移除统一认证、前端直进主界面」的需求变更主动关闭；分支保留可重开"
  },
  {
    groupName: "部署与交付", itemName: "north-auth 健康门禁（compose healthcheck+setup 探针）", owner: "师沛琳",
    prNumbers: "!615", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "",
    statusNote: "已合入（10-08）"
  },
  {
    groupName: "题库", itemName: "BOSC-0028 题库 · 评测集本体", owner: "刘成彦",
    prNumbers: "!112, !185, !226, !229, !232, !297, !305, !372, !434, !457, !344", blocked: true,
    blockerModule: "BOSC-0016 骨架 · 项目与署名；BOSC-0018 骨架 · 越权拦截与存在性不泄露", blockerOwner: "康旭",
    blockerProgress: "BOSC-0016：✅ 已交付（!98）；BOSC-0018：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0029 题库 · 列结构与全量重校验", owner: "宗杰伦",
    prNumbers: "!106, !147, !154, !200, !298, !344, !356, !467, !496, !512, !525, !565, !608, !611, !613", blocked: true,
    blockerModule: "BOSC-0028 题库 · 评测集本体", blockerOwner: "刘成彦",
    blockerProgress: "BOSC-0028：✅ 已交付（!112,!185,!226,!229）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0030 题库 · 列结构的并发保护", owner: "宗杰伦",
    prNumbers: "!106, !147, !200, !356, !608, !611", blocked: true,
    blockerModule: "BOSC-0029 题库 · 列结构与全量重校验", blockerOwner: "宗杰伦",
    blockerProgress: "BOSC-0029：✅ 已交付（!106,!147,!154,!200）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0031 题库 · 题目与题目版本", owner: "刘成彦",
    prNumbers: "!112, !185, !226, !229, !232, !297, !305, !372, !434, !457", blocked: true,
    blockerModule: "BOSC-0029 题库 · 列结构与全量重校验", blockerOwner: "宗杰伦",
    blockerProgress: "BOSC-0029：✅ 已交付（!106,!147,!154,!200）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0032 题库 · 题目的并发编辑与冲突提示", owner: "刘成彦",
    prNumbers: "!112, !185, !226, !229, !232, !297, !305, !372, !434, !457", blocked: true,
    blockerModule: "BOSC-0031 题库 · 题目与题目版本", blockerOwner: "刘成彦",
    blockerProgress: "BOSC-0031：✅ 已交付（!112,!185,!226,!229）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0033 题库 · 删除题目", owner: "刘成彦",
    prNumbers: "!112, !185, !226, !229, !232, !297, !305, !372, !434, !457", blocked: true,
    blockerModule: "BOSC-0031 题库 · 题目与题目版本；BOSC-0038 题库 · 发布评测集版本", blockerOwner: "刘成彦、宗杰伦",
    blockerProgress: "BOSC-0031：✅ 已交付（!112,!185,!226,!229）；BOSC-0038：✅ 已交付（!112,!185,!226,!229）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0034 题库 · 表格导入的解析与预览", owner: "宗杰伦",
    prNumbers: "!106, !152, !611", blocked: true,
    blockerModule: "BOSC-0029 题库 · 列结构与全量重校验；BOSC-0031 题库 · 题目与题目版本", blockerOwner: "宗杰伦、刘成彦",
    blockerProgress: "BOSC-0029：✅ 已交付（!106,!147,!154,!200）；BOSC-0031：✅ 已交付（!112,!185,!226,!229）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0035 题库 · 表格导入的逐行校验与冲突预检", owner: "宗杰伦",
    prNumbers: "!106, !611", blocked: true,
    blockerModule: "BOSC-0034 题库 · 表格导入的解析与预览", blockerOwner: "宗杰伦",
    blockerProgress: "BOSC-0034：🟡 在途/在审（!106,!152,!611）", engageNote: "部分：可先做不依赖上游的部分",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0036 题库 · 附件存储与按内容去重", owner: "宗杰伦",
    prNumbers: "!106, !354, !611", blocked: true,
    blockerModule: "BOSC-0007 底座 · 本地一键起环境", blockerOwner: "顾乡",
    blockerProgress: "BOSC-0007：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0037 题库 · 附件清单导入与安全校验", owner: "宗杰伦",
    prNumbers: "!106, !354, !611", blocked: true,
    blockerModule: "BOSC-0036 题库 · 附件存储与按内容去重；BOSC-0029 题库 · 列结构与全量重校验；BOSC-0031 题库 · 题目与题目版本", blockerOwner: "宗杰伦、刘成彦",
    blockerProgress: "BOSC-0036：🟡 在途/在审（!106,!354,!611）；BOSC-0029：✅ 已交付（!106,!147,!154,!200）；BOSC-0031：✅ 已交付（!112,!185,!226,!229）", engageNote: "部分：可先做不依赖上游的部分",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0038 题库 · 发布评测集版本", owner: "宗杰伦",
    prNumbers: "!112, !185, !226, !229, !232, !297, !305, !319, !372, !434, !457", blocked: true,
    blockerModule: "BOSC-0029 题库 · 列结构与全量重校验；BOSC-0031 题库 · 题目与题目版本", blockerOwner: "宗杰伦、刘成彦",
    blockerProgress: "BOSC-0029：✅ 已交付（!106,!147,!154,!200）；BOSC-0031：✅ 已交付（!112,!185,!226,!229）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0039 题库 · 归档与恢复", owner: "刘成彦",
    prNumbers: "!112, !185, !226, !229, !232, !297, !305, !372, !434, !457", blocked: true,
    blockerModule: "BOSC-0038 题库 · 发布评测集版本", blockerOwner: "宗杰伦",
    blockerProgress: "BOSC-0038：✅ 已交付（!112,!185,!226,!229）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0040 题库 · 删除评测集", owner: "刘成彦",
    prNumbers: "!59, !106, !112, !139, !147, !185, !226, !229, !232, !251, !305, !319, !344, !602, !608, !611", blocked: true,
    blockerModule: "BOSC-0039 题库 · 归档与恢复；BOSC-0038 题库 · 发布评测集版本", blockerOwner: "刘成彦、宗杰伦",
    blockerProgress: "BOSC-0039：✅ 已交付（!112,!185,!226,!229）；BOSC-0038：✅ 已交付（!112,!185,!226,!229）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0041 题库 · 导出评测集与题目", owner: "刘成彦",
    prNumbers: "!344, !467, !496, !512, !525, !565, !613", blocked: true,
    blockerModule: "BOSC-0031 题库 · 题目与题目版本；BOSC-0038 题库 · 发布评测集版本；BOSC-0006 底座 · 表格导出的公共实现", blockerOwner: "刘成彦、宗杰伦、顾乡",
    blockerProgress: "BOSC-0031：✅ 已交付（!112,!185,!226,!229）；BOSC-0038：✅ 已交付（!112,!185,!226,!229）；BOSC-0006：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0042 题库 · 跨项目导出再导入", owner: "刘成彦",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0041 题库 · 导出评测集与题目", blockerOwner: "刘成彦",
    blockerProgress: "BOSC-0041：✅ 已交付（!344,!467,!496,!512）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0043 题库 · 导出成测试管理平台要的格式", owner: "刘成彦、宗杰伦",
    prNumbers: "!344, !467, !496, !512, !525, !565, !613", blocked: true,
    blockerModule: "BOSC-0041 题库 · 导出评测集与题目", blockerOwner: "刘成彦",
    blockerProgress: "BOSC-0041：✅ 已交付（!344,!467,!496,!512）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0044 题库 · 评测集列表页与新建表单", owner: "刘成彦",
    prNumbers: "!344, !467, !496, !512, !525, !565, !613", blocked: true,
    blockerModule: "BOSC-0028 题库 · 评测集本体；BOSC-0039 题库 · 归档与恢复；BOSC-0040 题库 · 删除评测集；BOSC-0041 题库 · 导出评测集与题目；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "刘成彦、康旭",
    blockerProgress: "BOSC-0028：✅ 已交付（!112,!185,!226,!229）；BOSC-0039：✅ 已交付（!112,!185,!226,!229）；BOSC-0040：🔶 疑似相关（待核）（!59,!106,!112,!139）；BOSC-0041：✅ 已交付（!344,!467,!496,!512）；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0045 题库 · 跨项目导入与外部格式导出入口", owner: "未指派",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0042 题库 · 跨项目导出再导入；BOSC-0043 题库 · 导出成测试管理平台要的格式；BOSC-0044 题库 · 评测集列表页与新建表单", blockerOwner: "刘成彦、刘成彦、宗杰伦",
    blockerProgress: "BOSC-0042：❌ 未关联到交付证据；BOSC-0043：✅ 已交付（!344,!467,!496,!512）；BOSC-0044：✅ 已交付（!344,!467,!496,!512）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0046 题库 · 题目列表与编辑抽屉", owner: "刘成彦",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0031 题库 · 题目与题目版本；BOSC-0032 题库 · 题目的并发编辑与冲突提示；BOSC-0033 题库 · 删除题目；BOSC-0044 题库 · 评测集列表页与新建表单", blockerOwner: "刘成彦",
    blockerProgress: "BOSC-0031：✅ 已交付（!112,!185,!226,!229）；BOSC-0032：✅ 已交付（!112,!185,!226,!229）；BOSC-0033：✅ 已交付（!112,!185,!226,!229）；BOSC-0044：✅ 已交付（!344,!467,!496,!512）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0047 题库 · 列结构编辑器", owner: "未指派",
    prNumbers: "!106, !147, !200, !356, !608, !611", blocked: true,
    blockerModule: "BOSC-0029 题库 · 列结构与全量重校验；BOSC-0030 题库 · 列结构的并发保护；BOSC-0044 题库 · 评测集列表页与新建表单", blockerOwner: "宗杰伦、刘成彦",
    blockerProgress: "BOSC-0029：✅ 已交付（!106,!147,!154,!200）；BOSC-0030：✅ 已交付（!106,!147,!200,!356）；BOSC-0044：✅ 已交付（!344,!467,!496,!512）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0048 题库 · 版本发布对话框与版本列表", owner: "宗杰伦",
    prNumbers: "!319", blocked: true,
    blockerModule: "BOSC-0038 题库 · 发布评测集版本；BOSC-0044 题库 · 评测集列表页与新建表单", blockerOwner: "宗杰伦、刘成彦",
    blockerProgress: "BOSC-0038：✅ 已交付（!112,!185,!226,!229）；BOSC-0044：✅ 已交付（!344,!467,!496,!512）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔已合 PR 均为文档类，设计定稿〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0049 题库 · 表格导入向导", owner: "宗杰伦",
    prNumbers: "!106, !611", blocked: true,
    blockerModule: "BOSC-0034 题库 · 表格导入的解析与预览；BOSC-0035 题库 · 表格导入的逐行校验与冲突预检；BOSC-0044 题库 · 评测集列表页与新建表单", blockerOwner: "宗杰伦、刘成彦",
    blockerProgress: "BOSC-0034：🟡 在途/在审（!106,!152,!611）；BOSC-0035：🟡 在途/在审（!106,!611）；BOSC-0044：✅ 已交付（!344,!467,!496,!512）", engageNote: "部分：可先做不依赖上游的部分",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0050 题库 · 附件导入向导", owner: "宗杰伦",
    prNumbers: "!106, !354, !611", blocked: true,
    blockerModule: "BOSC-0037 题库 · 附件清单导入与安全校验；BOSC-0036 题库 · 附件存储与按内容去重；BOSC-0046 题库 · 题目列表与编辑抽屉", blockerOwner: "宗杰伦、刘成彦",
    blockerProgress: "BOSC-0037：🟡 在途/在审（!106,!354,!611）；BOSC-0036：🟡 在途/在审（!106,!354,!611）；BOSC-0046：❌ 未关联到交付证据", engageNote: "部分：可先做不依赖上游的部分",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "题库", itemName: "BOSC-0132 题库 · 评测集设成谁都能读", owner: "未指派",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0042 题库 · 跨项目导出再导入", blockerOwner: "刘成彦",
    blockerProgress: "BOSC-0042：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "被测对象与接入", itemName: "BOSC-0051 被测对象 · 接入方式与密钥保管", owner: "颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0016 骨架 · 项目与署名；BOSC-0018 骨架 · 越权拦截与存在性不泄露", blockerOwner: "康旭",
    blockerProgress: "BOSC-0016：✅ 已交付（!98）；BOSC-0018：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "被测对象与接入", itemName: "BOSC-0052 被测对象 · 被测对象与版本登记", owner: "颜茳渭",
    prNumbers: "!208", blocked: true,
    blockerModule: "BOSC-0051 被测对象 · 接入方式与密钥保管", blockerOwner: "颜茳渭",
    blockerProgress: "BOSC-0051：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "被测对象与接入", itemName: "BOSC-0053 被测对象 · 被测对象的归档与恢复", owner: "颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0052 被测对象 · 被测对象与版本登记", blockerOwner: "颜茳渭",
    blockerProgress: "BOSC-0052：🔶 疑似相关（待核）（!208）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "被测对象与接入", itemName: "BOSC-0054 被测对象 · 能力探测", owner: "颜茳渭",
    prNumbers: "!120, !11", blocked: true,
    blockerModule: "BOSC-0052 被测对象 · 被测对象与版本登记；BOSC-0051 被测对象 · 接入方式与密钥保管", blockerOwner: "颜茳渭",
    blockerProgress: "BOSC-0052：🔶 疑似相关（待核）（!208）；BOSC-0051：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "被测对象与接入", itemName: "BOSC-0055 被测对象 · 历次实验对比的读接口", owner: "颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0071 实验 · 实验与实验版本；BOSC-0121 报告 · 报告签发与冻结", blockerOwner: "饶铮、厉福超",
    blockerProgress: "BOSC-0071：❌ 未关联到交付证据；BOSC-0121：🔶 疑似相关（待核）（!156）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "被测对象与接入", itemName: "BOSC-0056 被测对象 · 接入方式管理页", owner: "颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0051 被测对象 · 接入方式与密钥保管；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "颜茳渭、康旭",
    blockerProgress: "BOSC-0051：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "被测对象与接入", itemName: "BOSC-0057 被测对象 · 列表页与登记表单", owner: "颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0052 被测对象 · 被测对象与版本登记；BOSC-0053 被测对象 · 被测对象的归档与恢复；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "颜茳渭、康旭",
    blockerProgress: "BOSC-0052：🔶 疑似相关（待核）（!208）；BOSC-0053：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "被测对象与接入", itemName: "BOSC-0058 被测对象 · 详情页的版本与探测结果", owner: "颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0054 被测对象 · 能力探测；BOSC-0052 被测对象 · 被测对象与版本登记；BOSC-0057 被测对象 · 列表页与登记表单", blockerOwner: "颜茳渭",
    blockerProgress: "BOSC-0054：✅ 已交付（!120,!11）；BOSC-0052：🔶 疑似相关（待核）（!208）；BOSC-0057：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "被测对象与接入", itemName: "BOSC-0059 被测对象 · 详情页的历次实验", owner: "颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0055 被测对象 · 历次实验对比的读接口；BOSC-0058 被测对象 · 详情页的版本与探测结果", blockerOwner: "颜茳渭",
    blockerProgress: "BOSC-0055：❌ 未关联到交付证据；BOSC-0058：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0080 执行 · 运行时复用本实验已成功的结果", owner: "聂嘉琛、李苑",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0079 实验 · 封版与冻结", blockerOwner: "聂嘉琛、饶铮、李苑、颜茳渭",
    blockerProgress: "BOSC-0079：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0087 执行 · 执行队列与并发", owner: "聂嘉琛、李苑",
    prNumbers: "!325", blocked: true,
    blockerModule: "BOSC-0079 实验 · 封版与冻结；BOSC-0080 执行 · 运行时复用本实验已成功的结果；BOSC-0051 被测对象 · 接入方式与密钥保管", blockerOwner: "聂嘉琛、饶铮、李苑、颜茳渭、聂嘉琛、李苑、颜茳渭",
    blockerProgress: "BOSC-0079：❌ 未关联到交付证据；BOSC-0080：❌ 未关联到交付证据；BOSC-0051：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0088 执行 · 五类状态与进度统计", owner: "聂嘉琛、李苑",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0087 执行 · 执行队列与并发", blockerOwner: "聂嘉琛、李苑",
    blockerProgress: "BOSC-0087：🔶 疑似相关（待核）（!325）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0089 执行 · 停止执行", owner: "聂嘉琛、李苑",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0087 执行 · 执行队列与并发；BOSC-0100 评分 · 自动评分与重新评分", blockerOwner: "聂嘉琛、李苑、袁毅堂",
    blockerProgress: "BOSC-0087：🔶 疑似相关（待核）（!325）；BOSC-0100：✅ 已交付（!94,!173,!175,!309）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0090 执行 · 重新推理", owner: "聂嘉琛、李苑",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0087 执行 · 执行队列与并发；BOSC-0091 执行 · 尝试记录；BOSC-0131 执行 · 作废一次结果；BOSC-0089 执行 · 停止执行；BOSC-0100 评分 · 自动评分与重新评分", blockerOwner: "聂嘉琛、李苑、聂嘉琛、未指派、袁毅堂",
    blockerProgress: "BOSC-0087：🔶 疑似相关（待核）（!325）；BOSC-0091：✅ 已交付（!160,!169,!170,!171）；BOSC-0131：❌ 未关联到交付证据；BOSC-0089：❌ 未关联到交付证据；BOSC-0100：✅ 已交付（!94,!173,!175,!309）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0091 执行 · 尝试记录", owner: "聂嘉琛",
    prNumbers: "!160, !169, !170, !171, !172, !189, !209, !219, !223, !242, !260, !261, !267, !268", blocked: true,
    blockerModule: "BOSC-0087 执行 · 执行队列与并发", blockerOwner: "聂嘉琛、李苑",
    blockerProgress: "BOSC-0087：🔶 疑似相关（待核）（!325）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0092 执行 · 输入、输出与原始返回的留存", owner: "聂嘉琛",
    prNumbers: "!165", blocked: true,
    blockerModule: "BOSC-0091 执行 · 尝试记录；BOSC-0036 题库 · 附件存储与按内容去重", blockerOwner: "聂嘉琛、宗杰伦",
    blockerProgress: "BOSC-0091：✅ 已交付（!160,!169,!170,!171）；BOSC-0036：🟡 在途/在审（!106,!354,!611）", engageNote: "部分：可先做不依赖上游的部分",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0093 执行 · 执行轨迹落库与不可改", owner: "聂嘉琛",
    prNumbers: "!160, !165, !169, !170, !171, !172, !189, !209, !219, !223, !242, !260, !261, !267, !268", blocked: true,
    blockerModule: "BOSC-0091 执行 · 尝试记录；BOSC-0054 被测对象 · 能力探测", blockerOwner: "聂嘉琛、颜茳渭",
    blockerProgress: "BOSC-0091：✅ 已交付（!160,!169,!170,!171）；BOSC-0054：✅ 已交付（!120,!11）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0094 执行 · 运行记录列表的读接口", owner: "聂嘉琛、李苑",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0088 执行 · 五类状态与进度统计；BOSC-0134 执行 · 操作记录、执行归属与按题互斥", blockerOwner: "聂嘉琛、李苑、聂嘉琛",
    blockerProgress: "BOSC-0088：❌ 未关联到交付证据；BOSC-0134：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0095 执行 · 题目与运行页签", owner: "聂嘉琛、李苑",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0088 执行 · 五类状态与进度统计；BOSC-0089 执行 · 停止执行；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "聂嘉琛、李苑、康旭",
    blockerProgress: "BOSC-0088：❌ 未关联到交付证据；BOSC-0089：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0096 执行 · 重跑面板", owner: "聂嘉琛、李苑",
    prNumbers: "!450", blocked: true,
    blockerModule: "BOSC-0090 执行 · 重新推理；BOSC-0095 执行 · 题目与运行页签；BOSC-0131 执行 · 作废一次结果", blockerOwner: "聂嘉琛、李苑、未指派",
    blockerProgress: "BOSC-0090：❌ 未关联到交付证据；BOSC-0095：❌ 未关联到交付证据；BOSC-0131：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0097 执行 · 单题详情的尝试记录与输入输出", owner: "聂嘉琛",
    prNumbers: "!140, !158, !168, !190, !192, !193, !287, !332", blocked: true,
    blockerModule: "BOSC-0091 执行 · 尝试记录；BOSC-0092 执行 · 输入、输出与原始返回的留存；BOSC-0095 执行 · 题目与运行页签", blockerOwner: "聂嘉琛、聂嘉琛、李苑",
    blockerProgress: "BOSC-0091：✅ 已交付（!160,!169,!170,!171）；BOSC-0092：❌ 未关联到交付证据（!165）；BOSC-0095：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0098 执行 · 单题详情的执行过程", owner: "聂嘉琛",
    prNumbers: "!86", blocked: true,
    blockerModule: "BOSC-0093 执行 · 执行轨迹落库与不可改；BOSC-0097 执行 · 单题详情的尝试记录与输入输出", blockerOwner: "聂嘉琛",
    blockerProgress: "BOSC-0093：✅ 已交付（!160,!165,!169,!170）；BOSC-0097：✅ 已交付（!140,!158,!168,!190）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0099 执行 · 运行列表页", owner: "聂嘉琛、李苑",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0094 执行 · 运行记录列表的读接口；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "聂嘉琛、李苑、康旭",
    blockerProgress: "BOSC-0094：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0131 执行 · 作废一次结果", owner: "未指派",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0091 执行 · 尝试记录", blockerOwner: "聂嘉琛",
    blockerProgress: "BOSC-0091：✅ 已交付（!160,!169,!170,!171）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "执行与证据", itemName: "BOSC-0134 执行 · 操作记录、执行归属与按题互斥", owner: "聂嘉琛",
    prNumbers: "", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "—",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0071 实验 · 实验与实验版本", owner: "饶铮",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0016 骨架 · 项目与署名；BOSC-0018 骨架 · 越权拦截与存在性不泄露", blockerOwner: "康旭",
    blockerProgress: "BOSC-0016：✅ 已交付（!98）；BOSC-0018：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0072 实验 · 版本历史的读接口", owner: "饶铮",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0071 实验 · 实验与实验版本；BOSC-0121 报告 · 报告签发与冻结", blockerOwner: "饶铮、厉福超",
    blockerProgress: "BOSC-0071：❌ 未关联到交付证据；BOSC-0121：🔶 疑似相关（待核）（!156）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0073 实验 · 选题", owner: "刘成彦、饶铮、宗杰伦",
    prNumbers: "!112, !185, !226, !229, !232, !297, !305, !372, !434, !457", blocked: true,
    blockerModule: "BOSC-0038 题库 · 发布评测集版本；BOSC-0071 实验 · 实验与实验版本", blockerOwner: "宗杰伦、饶铮",
    blockerProgress: "BOSC-0038：✅ 已交付（!112,!185,!226,!229）；BOSC-0071：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0074 实验 · 选被测对象版本", owner: "饶铮、颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0052 被测对象 · 被测对象与版本登记；BOSC-0054 被测对象 · 能力探测；BOSC-0071 实验 · 实验与实验版本", blockerOwner: "颜茳渭、饶铮",
    blockerProgress: "BOSC-0052：🔶 疑似相关（待核）（!208）；BOSC-0054：✅ 已交付（!120,!11）；BOSC-0071：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0075 实验 · 字段映射", owner: "饶铮",
    prNumbers: "!220, !555", blocked: true,
    blockerModule: "BOSC-0073 实验 · 选题；BOSC-0074 实验 · 选被测对象版本", blockerOwner: "刘成彦、饶铮、宗杰伦、饶铮、颜茳渭",
    blockerProgress: "BOSC-0073：✅ 已交付（!112,!185,!226,!229）；BOSC-0074：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0077 实验 · 执行参数", owner: "饶铮、颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0052 被测对象 · 被测对象与版本登记；BOSC-0074 实验 · 选被测对象版本", blockerOwner: "颜茳渭、饶铮、颜茳渭",
    blockerProgress: "BOSC-0052：🔶 疑似相关（待核）（!208）；BOSC-0074：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0078 实验 · 开跑前检查", owner: "饶铮、颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0073 实验 · 选题；BOSC-0074 实验 · 选被测对象版本；BOSC-0075 实验 · 字段映射；BOSC-0076 实验 · 挂评分规则；BOSC-0077 实验 · 执行参数", blockerOwner: "刘成彦、饶铮、宗杰伦、饶铮、颜茳渭、饶铮、师沛琳",
    blockerProgress: "BOSC-0073：✅ 已交付（!112,!185,!226,!229）；BOSC-0074：❌ 未关联到交付证据；BOSC-0075：🔶 疑似相关（待核）（!220,!555）；BOSC-0076：✅ 已交付（!82,!83,!94,!309）；BOSC-0077：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0079 实验 · 封版与冻结", owner: "聂嘉琛、饶铮、李苑、颜茳渭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0078 实验 · 开跑前检查", blockerOwner: "饶铮、颜茳渭",
    blockerProgress: "BOSC-0078：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0081 实验 · 实验列表页与新建表单", owner: "饶铮",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0071 实验 · 实验与实验版本；BOSC-0023 骨架 · 登录、外壳与导航；BOSC-0121 报告 · 报告签发与冻结", blockerOwner: "饶铮、康旭、厉福超",
    blockerProgress: "BOSC-0071：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）；BOSC-0121：🔶 疑似相关（待核）（!156）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0082 实验 · 版本历史页与实验版本页", owner: "饶铮",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0072 实验 · 版本历史的读接口；BOSC-0081 实验 · 实验列表页与新建表单；BOSC-0095 执行 · 题目与运行页签；BOSC-0111 评分 · 评分页签；BOSC-0112 报告 · 指标统计页签的整体指标区", blockerOwner: "饶铮、聂嘉琛、李苑、袁毅堂、厉福超",
    blockerProgress: "BOSC-0072：❌ 未关联到交付证据；BOSC-0081：❌ 未关联到交付证据；BOSC-0095：❌ 未关联到交付证据；BOSC-0111：✅ 已交付（!94,!309,!514）；BOSC-0112：✅ 已交付（!129,!144,!462,!476）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0083 实验 · 配置页的选题与选被测对象", owner: "未指派",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0073 实验 · 选题；BOSC-0074 实验 · 选被测对象版本；BOSC-0081 实验 · 实验列表页与新建表单", blockerOwner: "刘成彦、饶铮、宗杰伦、饶铮、颜茳渭、饶铮",
    blockerProgress: "BOSC-0073：✅ 已交付（!112,!185,!226,!229）；BOSC-0074：❌ 未关联到交付证据；BOSC-0081：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0084 实验 · 配置页的字段映射", owner: "饶铮",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0075 实验 · 字段映射；BOSC-0083 实验 · 配置页的选题与选被测对象", blockerOwner: "饶铮、未指派",
    blockerProgress: "BOSC-0075：🔶 疑似相关（待核）（!220,!555）；BOSC-0083：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0085 实验 · 配置页的挂规则与执行参数", owner: "未指派",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0076 实验 · 挂评分规则；BOSC-0077 实验 · 执行参数；BOSC-0084 实验 · 配置页的字段映射", blockerOwner: "师沛琳、饶铮、颜茳渭、饶铮",
    blockerProgress: "BOSC-0076：✅ 已交付（!82,!83,!94,!309）；BOSC-0077：❌ 未关联到交付证据；BOSC-0084：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0086 实验 · 封版页与运行按钮", owner: "未指派",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0078 实验 · 开跑前检查；BOSC-0079 实验 · 封版与冻结；BOSC-0080 执行 · 运行时复用本实验已成功的结果；BOSC-0085 实验 · 配置页的挂规则与执行参数", blockerOwner: "饶铮、颜茳渭、聂嘉琛、饶铮、李苑、颜茳渭、聂嘉琛、李苑、未指派",
    blockerProgress: "BOSC-0078：❌ 未关联到交付证据；BOSC-0079：❌ 未关联到交付证据；BOSC-0080：❌ 未关联到交付证据；BOSC-0085：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "实验与封版", itemName: "BOSC-0133 实验 · 评分器入参映射", owner: "饶铮",
    prNumbers: "!82, !83, !343, !432, !522, !543, !621", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "—",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "评分规则", itemName: "BOSC-0069 评分规则 · 样题试跑面板", owner: "师沛琳",
    prNumbers: "!440, !450", blocked: true,
    blockerModule: "BOSC-0066 评分规则 · 样题试跑；BOSC-0068 评分规则 · 规则库列表与建规则表单", blockerOwner: "师沛琳",
    blockerProgress: "BOSC-0066：🔶 疑似相关（待核）（!440,!450）；BOSC-0068：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0100 评分 · 自动评分与重新评分", owner: "袁毅堂",
    prNumbers: "!94, !173, !175, !309, !328, !336, !606, !620, !621", blocked: true,
    blockerModule: "BOSC-0091 执行 · 尝试记录；BOSC-0076 实验 · 挂评分规则；BOSC-0061 评分规则 · 内容类判法；BOSC-0062 评分规则 · 过程类判法；BOSC-0064 评分规则 · 大模型当裁判", blockerOwner: "聂嘉琛、师沛琳",
    blockerProgress: "BOSC-0091：✅ 已交付（!160,!169,!170,!171）；BOSC-0076：✅ 已交付（!82,!83,!94,!309）；BOSC-0061：🔶 疑似相关（待核）（!540）；BOSC-0062：🔶 疑似相关（待核）（!463,!592）；BOSC-0064：🔶 疑似相关（待核）（!464）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0102 评分 · 与人工判定的一致性", owner: "袁毅堂",
    prNumbers: "!129, !144, !179, !308, !446", blocked: true,
    blockerModule: "BOSC-0100 评分 · 自动评分与重新评分；BOSC-0108 评分 · 人工结论", blockerOwner: "袁毅堂、刘燕燕",
    blockerProgress: "BOSC-0100：✅ 已交付（!94,!173,!175,!309）；BOSC-0108：✅ 已交付（!94,!120,!162,!163）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0103 评分 · 类别的精确率、召回率与 F1", owner: "袁毅堂",
    prNumbers: "!129, !144", blocked: true,
    blockerModule: "BOSC-0101 报告 · 基础指标；BOSC-0061 评分规则 · 内容类判法", blockerOwner: "厉福超、师沛琳",
    blockerProgress: "BOSC-0101：✅ 已交付（!129,!144,!439,!446）；BOSC-0061：🔶 疑似相关（待核）（!540）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0104 评分 · 稳定性", owner: "袁毅堂",
    prNumbers: "!550, !573, !574", blocked: true,
    blockerModule: "BOSC-0100 评分 · 自动评分与重新评分；BOSC-0077 实验 · 执行参数；BOSC-0080 执行 · 运行时复用本实验已成功的结果", blockerOwner: "袁毅堂、饶铮、颜茳渭、聂嘉琛、李苑",
    blockerProgress: "BOSC-0100：✅ 已交付（!94,!173,!175,!309）；BOSC-0077：❌ 未关联到交付证据；BOSC-0080：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0105 评分 · 响应时间与成功率", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0091 执行 · 尝试记录；BOSC-0080 执行 · 运行时复用本实验已成功的结果", blockerOwner: "聂嘉琛、聂嘉琛、李苑",
    blockerProgress: "BOSC-0091：✅ 已交付（!160,!169,!170,!171）；BOSC-0080：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0106 评分 · 单题得分与理由", owner: "袁毅堂",
    prNumbers: "!94, !309, !612", blocked: true,
    blockerModule: "BOSC-0100 评分 · 自动评分与重新评分；BOSC-0091 执行 · 尝试记录；BOSC-0088 执行 · 五类状态与进度统计", blockerOwner: "袁毅堂、聂嘉琛、聂嘉琛、李苑",
    blockerProgress: "BOSC-0100：✅ 已交付（!94,!173,!175,!309）；BOSC-0091：✅ 已交付（!160,!169,!170,!171）；BOSC-0088：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0107 评分 · 标注队列与待复核", owner: "刘燕燕",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0100 评分 · 自动评分与重新评分；BOSC-0106 评分 · 单题得分与理由；BOSC-0088 执行 · 五类状态与进度统计；BOSC-0017 骨架 · 成员、角色与逐对象权限", blockerOwner: "袁毅堂、聂嘉琛、李苑、康旭",
    blockerProgress: "BOSC-0100：✅ 已交付（!94,!173,!175,!309）；BOSC-0106：✅ 已交付（!94,!309,!612）；BOSC-0088：❌ 未关联到交付证据；BOSC-0017：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0108 评分 · 人工结论", owner: "刘燕燕",
    prNumbers: "!94, !120, !162, !163, !176, !181, !187, !204, !280, !309, !342, !485, !487, !488, !577, !610", blocked: true,
    blockerModule: "BOSC-0107 评分 · 标注队列与待复核；BOSC-0106 评分 · 单题得分与理由；BOSC-0076 实验 · 挂评分规则", blockerOwner: "刘燕燕、袁毅堂、师沛琳",
    blockerProgress: "BOSC-0107：❌ 未关联到交付证据；BOSC-0106：✅ 已交付（!94,!309,!612）；BOSC-0076：✅ 已交付（!82,!83,!94,!309）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0109 评分 · 输出标注", owner: "刘燕燕",
    prNumbers: "!129, !144, !197, !203, !362", blocked: true,
    blockerModule: "BOSC-0092 执行 · 输入、输出与原始返回的留存", blockerOwner: "聂嘉琛",
    blockerProgress: "BOSC-0092：❌ 未关联到交付证据（!165）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0110 评分 · 人工评分导出", owner: "刘燕燕",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0108 评分 · 人工结论；BOSC-0109 评分 · 输出标注；BOSC-0020 骨架 · 操作记录外送；BOSC-0006 底座 · 表格导出的公共实现", blockerOwner: "刘燕燕、刘燕燕、朱奕洁、顾乡",
    blockerProgress: "BOSC-0108：✅ 已交付（!94,!120,!162,!163）；BOSC-0109：✅ 已交付（!129,!144,!197,!203）；BOSC-0020：🔶 疑似相关（待核）（!620）；BOSC-0006：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0111 评分 · 评分页签", owner: "袁毅堂",
    prNumbers: "!94, !309, !514", blocked: true,
    blockerModule: "BOSC-0100 评分 · 自动评分与重新评分；BOSC-0023 骨架 · 登录、外壳与导航；BOSC-0089 执行 · 停止执行", blockerOwner: "袁毅堂、康旭、聂嘉琛、李苑",
    blockerProgress: "BOSC-0100：✅ 已交付（!94,!173,!175,!309）；BOSC-0023：✅ 已交付（!94,!118,!129,!144）；BOSC-0089：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0113 评分 · 指标统计页签的响应时间与成功率区", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0105 评分 · 响应时间与成功率；BOSC-0112 报告 · 指标统计页签的整体指标区；BOSC-0080 执行 · 运行时复用本实验已成功的结果", blockerOwner: "厉福超、聂嘉琛、李苑",
    blockerProgress: "BOSC-0105：❌ 未关联到交付证据；BOSC-0112：✅ 已交付（!129,!144,!462,!476）；BOSC-0080：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0114 评分 · 评分页签的逐题得分与理由", owner: "袁毅堂",
    prNumbers: "!129, !144, !461, !612, !309", blocked: true,
    blockerModule: "BOSC-0106 评分 · 单题得分与理由；BOSC-0112 报告 · 指标统计页签的整体指标区；BOSC-0107 评分 · 标注队列与待复核", blockerOwner: "袁毅堂、厉福超、刘燕燕",
    blockerProgress: "BOSC-0106：✅ 已交付（!94,!309,!612）；BOSC-0112：✅ 已交付（!129,!144,!462,!476）；BOSC-0107：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0115 评分 · 复核页的队列与待复核清单", owner: "刘燕燕",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0107 评分 · 标注队列与待复核；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "刘燕燕、康旭",
    blockerProgress: "BOSC-0107：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0116 评分 · 单题详情的改分与批注面板", owner: "刘燕燕",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0108 评分 · 人工结论；BOSC-0109 评分 · 输出标注；BOSC-0115 评分 · 复核页的队列与待复核清单", blockerOwner: "刘燕燕",
    blockerProgress: "BOSC-0108：✅ 已交付（!94,!120,!162,!163）；BOSC-0109：✅ 已交付（!129,!144,!197,!203）；BOSC-0115：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "评分与复核", itemName: "BOSC-0117 评分 · 人工评分导出入口", owner: "刘燕燕",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0110 评分 · 人工评分导出；BOSC-0020 骨架 · 操作记录外送；BOSC-0111 评分 · 评分页签", blockerOwner: "刘燕燕、刘燕燕、朱奕洁、袁毅堂",
    blockerProgress: "BOSC-0110：❌ 未关联到交付证据；BOSC-0020：🔶 疑似相关（待核）（!620）；BOSC-0111：✅ 已交付（!94,!309,!514）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0101 报告 · 基础指标", owner: "厉福超",
    prNumbers: "!129, !144, !439, !446", blocked: true,
    blockerModule: "BOSC-0100 评分 · 自动评分与重新评分；BOSC-0108 评分 · 人工结论", blockerOwner: "袁毅堂、刘燕燕",
    blockerProgress: "BOSC-0100：✅ 已交付（!94,!173,!175,!309）；BOSC-0108：✅ 已交付（!94,!120,!162,!163）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0112 报告 · 指标统计页签的整体指标区", owner: "厉福超",
    prNumbers: "!129, !144, !462, !476, !570, !574", blocked: true,
    blockerModule: "BOSC-0101 报告 · 基础指标；BOSC-0102 评分 · 与人工判定的一致性；BOSC-0103 评分 · 类别的精确率、召回率与 F1；BOSC-0104 评分 · 稳定性；BOSC-0111 评分 · 评分页签；BOSC-0105 评分 · 响应时间与成功率", blockerOwner: "厉福超、袁毅堂",
    blockerProgress: "BOSC-0101：✅ 已交付（!129,!144,!439,!446）；BOSC-0102：✅ 已交付（!129,!144,!179,!308）；BOSC-0103：✅ 已交付（!129,!144）；BOSC-0104：🔶 疑似相关（待核）（!550,!573,!574）；BOSC-0111：✅ 已交付（!94,!309,!514）；BOSC-0105：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0118 报告 · 指标体系与指标体系版本", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0016 骨架 · 项目与署名", blockerOwner: "康旭",
    blockerProgress: "BOSC-0016：✅ 已交付（!98）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0119 报告 · 指标达标判定与验收结论", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0118 报告 · 指标体系与指标体系版本；BOSC-0101 报告 · 基础指标；BOSC-0103 评分 · 类别的精确率、召回率与 F1；BOSC-0105 评分 · 响应时间与成功率；BOSC-0104 评分 · 稳定性；BOSC-0088 执行 · 五类状态与进度统计", blockerOwner: "厉福超、袁毅堂、聂嘉琛、李苑",
    blockerProgress: "BOSC-0118：❌ 未关联到交付证据；BOSC-0101：✅ 已交付（!129,!144,!439,!446）；BOSC-0103：✅ 已交付（!129,!144）；BOSC-0105：❌ 未关联到交付证据；BOSC-0104：🔶 疑似相关（待核）（!550,!573,!574）；BOSC-0088：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0120 报告 · 报告预览", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0119 报告 · 指标达标判定与验收结论；BOSC-0107 评分 · 标注队列与待复核", blockerOwner: "厉福超、刘燕燕",
    blockerProgress: "BOSC-0119：❌ 未关联到交付证据；BOSC-0107：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0121 报告 · 报告签发与冻结", owner: "厉福超",
    prNumbers: "!156", blocked: true,
    blockerModule: "BOSC-0120 报告 · 报告预览；BOSC-0100 评分 · 自动评分与重新评分；BOSC-0101 报告 · 基础指标；BOSC-0102 评分 · 与人工判定的一致性；BOSC-0103 评分 · 类别的精确率、召回率与 F1；BOSC-0104 评分 · 稳定性；BOSC-0105 评分 · 响应时间与成功率；BOSC-0091 执行 · 尝试记录；BOSC-0080 执行 · 运行时复用本实验已成功的结果；BOSC-0009 底座 · 部署包与版本可追溯", blockerOwner: "厉福超、袁毅堂、聂嘉琛、聂嘉琛、李苑、顾乡",
    blockerProgress: "BOSC-0120：❌ 未关联到交付证据；BOSC-0100：✅ 已交付（!94,!173,!175,!309）；BOSC-0101：✅ 已交付（!129,!144,!439,!446）；BOSC-0102：✅ 已交付（!129,!144,!179,!308）；BOSC-0103：✅ 已交付（!129,!144）；BOSC-0104：🔶 疑似相关（待核）（!550,!573,!574）；BOSC-0105：❌ 未关联到交付证据；BOSC-0091：✅ 已交付（!160,!169,!170,!171）；BOSC-0080：❌ 未关联到交付证据；BOSC-0009：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0122 报告 · 报告详情与逐题反查", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0121 报告 · 报告签发与冻结；BOSC-0091 执行 · 尝试记录", blockerOwner: "厉福超、聂嘉琛",
    blockerProgress: "BOSC-0121：🔶 疑似相关（待核）（!156）；BOSC-0091：✅ 已交付（!160,!169,!170,!171）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0123 报告 · 版本对比", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0121 报告 · 报告签发与冻结", blockerOwner: "厉福超",
    blockerProgress: "BOSC-0121：🔶 疑似相关（待核）（!156）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0124 报告 · 更正与撤回", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0121 报告 · 报告签发与冻结", blockerOwner: "厉福超",
    blockerProgress: "BOSC-0121：🔶 疑似相关（待核）（!156）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0125 报告 · 报告导出", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0121 报告 · 报告签发与冻结", blockerOwner: "厉福超",
    blockerProgress: "BOSC-0121：🔶 疑似相关（待核）（!156）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0126 报告 · 指标统计页签的指标体系配置", owner: "厉福超",
    prNumbers: "!462, !570, !574", blocked: true,
    blockerModule: "BOSC-0118 报告 · 指标体系与指标体系版本；BOSC-0119 报告 · 指标达标判定与验收结论；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "厉福超、康旭",
    blockerProgress: "BOSC-0118：❌ 未关联到交付证据；BOSC-0119：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0127 报告 · 报告预览页与签发对话框", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0120 报告 · 报告预览；BOSC-0121 报告 · 报告签发与冻结；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "厉福超、康旭",
    blockerProgress: "BOSC-0120：❌ 未关联到交付证据；BOSC-0121：🔶 疑似相关（待核）（!156）；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0128 报告 · 报告详情页", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0122 报告 · 报告详情与逐题反查；BOSC-0127 报告 · 报告预览页与签发对话框", blockerOwner: "厉福超",
    blockerProgress: "BOSC-0122：❌ 未关联到交付证据；BOSC-0127：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0129 报告 · 版本对比页", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0123 报告 · 版本对比；BOSC-0128 报告 · 报告详情页", blockerOwner: "厉福超",
    blockerProgress: "BOSC-0123：❌ 未关联到交付证据；BOSC-0128：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "报告与指标体系", itemName: "BOSC-0130 报告 · 更正撤回与导出入口", owner: "厉福超",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0124 报告 · 更正与撤回；BOSC-0125 报告 · 报告导出；BOSC-0128 报告 · 报告详情页", blockerOwner: "厉福超",
    blockerProgress: "BOSC-0124：❌ 未关联到交付证据；BOSC-0125：❌ 未关联到交付证据；BOSC-0128：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0016 骨架 · 项目与署名", owner: "康旭",
    prNumbers: "!98", blocked: true,
    blockerModule: "BOSC-0003 底座 · 分层骨架与包结构约定；BOSC-0005 底座 · 写操作与错误响应的横切约定", blockerOwner: "顾乡",
    blockerProgress: "BOSC-0003：❌ 未关联到交付证据；BOSC-0005：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0017 骨架 · 成员、角色与逐对象权限", owner: "康旭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0016 骨架 · 项目与署名", blockerOwner: "康旭",
    blockerProgress: "BOSC-0016：✅ 已交付（!98）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0018 骨架 · 越权拦截与存在性不泄露", owner: "康旭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0017 骨架 · 成员、角色与逐对象权限；BOSC-0005 底座 · 写操作与错误响应的横切约定", blockerOwner: "康旭、顾乡",
    blockerProgress: "BOSC-0017：❌ 未关联到交付证据；BOSC-0005：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0019 骨架 · 开号申请与审批", owner: "康旭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0016 骨架 · 项目与署名", blockerOwner: "康旭",
    blockerProgress: "BOSC-0016：✅ 已交付（!98）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0020 骨架 · 操作记录外送", owner: "刘燕燕、朱奕洁",
    prNumbers: "!620", blocked: true,
    blockerModule: "BOSC-0016 骨架 · 项目与署名", blockerOwner: "康旭",
    blockerProgress: "BOSC-0016：✅ 已交付（!98）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0021 骨架 · 操作记录查询与导出", owner: "刘燕燕、朱奕洁",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0020 骨架 · 操作记录外送；BOSC-0017 骨架 · 成员、角色与逐对象权限；BOSC-0006 底座 · 表格导出的公共实现", blockerOwner: "刘燕燕、朱奕洁、康旭、顾乡",
    blockerProgress: "BOSC-0020：🔶 疑似相关（待核）（!620）；BOSC-0017：❌ 未关联到交付证据；BOSC-0006：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0022 骨架 · 工作台首页的聚合读接口", owner: "康旭",
    prNumbers: "!106", blocked: true,
    blockerModule: "BOSC-0017 骨架 · 成员、角色与逐对象权限；BOSC-0016 骨架 · 项目与署名；BOSC-0071 实验 · 实验与实验版本；BOSC-0107 评分 · 标注队列与待复核", blockerOwner: "康旭、饶铮、刘燕燕",
    blockerProgress: "BOSC-0017：❌ 未关联到交付证据；BOSC-0016：✅ 已交付（!98）；BOSC-0071：❌ 未关联到交付证据；BOSC-0107：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔已合 PR 均为文档类，设计定稿〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0023 骨架 · 登录、外壳与导航", owner: "康旭",
    prNumbers: "!94, !118, !129, !144, !309", blocked: true,
    blockerModule: "BOSC-0016 骨架 · 项目与署名；BOSC-0017 骨架 · 成员、角色与逐对象权限；BOSC-0018 骨架 · 越权拦截与存在性不泄露", blockerOwner: "康旭",
    blockerProgress: "BOSC-0016：✅ 已交付（!98）；BOSC-0017：❌ 未关联到交付证据；BOSC-0018：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0024 骨架 · 账号申请与审批页", owner: "康旭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0019 骨架 · 开号申请与审批；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "康旭",
    blockerProgress: "BOSC-0019：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0025 骨架 · 项目与成员管理页", owner: "康旭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0017 骨架 · 成员、角色与逐对象权限；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "康旭",
    blockerProgress: "BOSC-0017：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0026 骨架 · 操作记录查询页", owner: "刘燕燕、朱奕洁",
    prNumbers: "!620", blocked: true,
    blockerModule: "BOSC-0021 骨架 · 操作记录查询与导出；BOSC-0023 骨架 · 登录、外壳与导航", blockerOwner: "刘燕燕、朱奕洁、康旭",
    blockerProgress: "BOSC-0021：❌ 未关联到交付证据；BOSC-0023：✅ 已交付（!94,!118,!129,!144）", engageNote: "否：等上游开工",
    statusNote: "〔标题高相似·人工待核〕"
  },
  {
    groupName: "平台接缝与骨架", itemName: "BOSC-0027 骨架 · 工作台首页", owner: "康旭",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0022 骨架 · 工作台首页的聚合读接口；BOSC-0023 骨架 · 登录、外壳与导航；BOSC-0071 实验 · 实验与实验版本；BOSC-0107 评分 · 标注队列与待复核", blockerOwner: "康旭、饶铮、刘燕燕",
    blockerProgress: "BOSC-0022：📘 设计定稿（!106）；BOSC-0023：✅ 已交付（!94,!118,!129,!144）；BOSC-0071：❌ 未关联到交付证据；BOSC-0107：❌ 未关联到交付证据", engageNote: "部分：可先做不依赖上游的部分",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0001 底座 · 数据库换成 MySQL 8", owner: "刘成彦",
    prNumbers: "!107, !110, !122, !130, !131", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "—",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0002 底座 · 运行时降到 JDK 17", owner: "刘成彦",
    prNumbers: "!73", blocked: true,
    blockerModule: "BOSC-0001 底座 · 数据库换成 MySQL 8", blockerOwner: "刘成彦",
    blockerProgress: "BOSC-0001：✅ 已交付（!107,!110,!122,!130）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC 证据〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0003 底座 · 分层骨架与包结构约定", owner: "顾乡",
    prNumbers: "", blocked: false,
    blockerModule: "", blockerOwner: "",
    blockerProgress: "", engageNote: "—",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0004 底座 · 列表分页统一成游标", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0003 底座 · 分层骨架与包结构约定", blockerOwner: "顾乡",
    blockerProgress: "BOSC-0003：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0005 底座 · 写操作与错误响应的横切约定", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0003 底座 · 分层骨架与包结构约定", blockerOwner: "顾乡",
    blockerProgress: "BOSC-0003：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0006 底座 · 表格导出的公共实现", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0003 底座 · 分层骨架与包结构约定", blockerOwner: "顾乡",
    blockerProgress: "BOSC-0003：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0007 底座 · 本地一键起环境", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0001 底座 · 数据库换成 MySQL 8；BOSC-0002 底座 · 运行时降到 JDK 17", blockerOwner: "刘成彦",
    blockerProgress: "BOSC-0001：✅ 已交付（!107,!110,!122,!130）；BOSC-0002：✅ 已交付（!73）", engageNote: "可以：上游已交付，可开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0008 底座 · 集群部署基线", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0007 底座 · 本地一键起环境", blockerOwner: "顾乡",
    blockerProgress: "BOSC-0007：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0009 底座 · 部署包与版本可追溯", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0008 底座 · 集群部署基线", blockerOwner: "顾乡",
    blockerProgress: "BOSC-0008：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0010 底座 · 目标环境重复部署与回退演练", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0009 底座 · 部署包与版本可追溯", blockerOwner: "顾乡",
    blockerProgress: "BOSC-0009：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0011 底座 · 兼容性与质量门禁", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0002 底座 · 运行时降到 JDK 17；BOSC-0007 底座 · 本地一键起环境", blockerOwner: "刘成彦、顾乡",
    blockerProgress: "BOSC-0002：✅ 已交付（!73）；BOSC-0007：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0012 底座 · 身份与项目的测试样例", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0016 骨架 · 项目与署名；BOSC-0017 骨架 · 成员、角色与逐对象权限；BOSC-0018 骨架 · 越权拦截与存在性不泄露", blockerOwner: "康旭",
    blockerProgress: "BOSC-0016：✅ 已交付（!98）；BOSC-0017：❌ 未关联到交付证据；BOSC-0018：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0013 底座 · 评测资产与实验版本的测试样例", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0031 题库 · 题目与题目版本；BOSC-0038 题库 · 发布评测集版本；BOSC-0071 实验 · 实验与实验版本；BOSC-0012 底座 · 身份与项目的测试样例", blockerOwner: "刘成彦、宗杰伦、饶铮、顾乡",
    blockerProgress: "BOSC-0031：✅ 已交付（!112,!185,!226,!229）；BOSC-0038：✅ 已交付（!112,!185,!226,!229）；BOSC-0071：❌ 未关联到交付证据；BOSC-0012：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0014 底座 · 运行证据与评分的测试样例", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0091 执行 · 尝试记录；BOSC-0093 执行 · 执行轨迹落库与不可改；BOSC-0100 评分 · 自动评分与重新评分；BOSC-0013 底座 · 评测资产与实验版本的测试样例", blockerOwner: "聂嘉琛、袁毅堂、顾乡",
    blockerProgress: "BOSC-0091：✅ 已交付（!160,!169,!170,!171）；BOSC-0093：✅ 已交付（!160,!165,!169,!170）；BOSC-0100：✅ 已交付（!94,!173,!175,!309）；BOSC-0013：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  },
  {
    groupName: "工程与交付底座", itemName: "BOSC-0015 底座 · 一条工作项能否独立驱动交付的验证", owner: "顾乡",
    prNumbers: "", blocked: true,
    blockerModule: "BOSC-0011 底座 · 兼容性与质量门禁；BOSC-0007 底座 · 本地一键起环境", blockerOwner: "顾乡",
    blockerProgress: "BOSC-0011：❌ 未关联到交付证据；BOSC-0007：❌ 未关联到交付证据", engageNote: "否：等上游开工",
    statusNote: "〔编号/RFC meta/标题相似三层均无命中，可能未开工或 PR 未带标识〕"
  }
]

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
