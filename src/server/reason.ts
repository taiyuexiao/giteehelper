/**
 * 影响原因分类。
 *
 * 分类来自对该仓库 315 个 PR、960 条评审评论的通读归纳，不是通用软件工程常识。
 * 实测分布：契约/合同类冲突出现在 172/315 个 PR，口径分歧 114 个，「自相矛盾」43 个；
 * 真正的合并文本冲突几乎只集中在一处——`docs/rfcs/README.md` 这种只追加的索引表（62 个 PR 点名）。
 *
 * 分类轴是**下一步动作**，因为收到通知后要做的事完全不同：
 * - directive  内容型：有人必须改代码/文档，可以直接给跟改清单
 * - ordering   结构/时序型：不用改内容，要协调合入顺序或抢占的共享文件
 * - cognitive  认知型：机器判不了，必须人来拍板口径
 * - compliance 流程/证据型：要补证据、过门禁、按基线重验
 *
 * 全部基于文件路径、提交信息与 PR 上下文做确定性判定，不调用大模型。
 */
import type { Severity } from "../shared/types.js";

export type ReasonNature = "directive" | "ordering" | "cognitive" | "compliance";

export interface ReasonHit {
  code: string;
  nature: ReasonNature;
  /** 影响原因，直接进通知消息 */
  label: string;
  /** 建议动作 */
  action: string;
}

export interface ReasonContext {
  files: string[];
  /** 该影响是否只有语义证据（没有路径命中）——语义命中更容易是「口径」问题 */
  semanticOnly: boolean;
  severity?: Severity;
  title?: string;
  /** 在飞 PR 上下文 */
  pull?: {
    number: number;
    base: string;
    head: string;
    /** 落后主干多少个提交，未知则不给 */
    behindBy?: number | null;
    /** 本次事件是否改变了 head（PR 的 update/synchronize） */
    headChanged?: boolean;
  } | null;
  hasImplementation?: boolean;
  /** 与本次改动共享文件的其他在飞 PR（谁后合谁返工） */
  parallelPulls?: Array<{ number: number; author: string | null; shared: string[] }>;
  /** 本次引用到、但尚未合入主干的 PR —— 它们的说法不能当作已生效的事实 */
  unmergedReferences?: number[];
}

const TEST_RE = /(^|\/)(test|tests|__tests__)\//i;
/** 契约载体：该仓库把契约分散在 openapi / data-model / meta / schema 里 */
const CONTRACT_RE = /(openapi|swagger|asyncapi|data-model|\.proto$|schema|contract|\/ddl\.sql$|db\/migration\/|docs\/rfcs\/meta\/)/i;
const DDL_RE = /(db\/migration\/|\/ddl\.sql$|database_schema\.sql$|\.sql$)/i;
/** 对外接口面：路由、封套、错误码、代理与部署入口 */
const API_SURFACE_RE = /(Controller\.java$|ExceptionHandler|ErrorCode\.java$|application\.ya?ml$|nginx|proxy|\/api\/|Route|Router)/i;
const IMPL_RE = /^(src|frontend|north-auth)\/.*\.(java|kt|ts|tsx|js|jsx)$/i;
const FRONTEND_RE = /^(frontend\/|.*\.tsx?$)/i;
const RFC_BODY_RE = /^docs\/rfcs\/[^/]+\.mdx?$/i;
const RFC_META_RE = /^docs\/rfcs\/meta\//i;
const RFC_SPEC_RE = /^docs\/rfcs\/assets\/.*\/spec\//i;
/** 只追加的索引/共享资产：每加一份 RFC 都改表尾，天然抢同一行 */
const SHARED_ASSET_RE = /(^|\/)(README\.md|INDEX\.md|index\.mdx?)$|名词表|术语表|glossary/i;
/** 门禁与工具链基线 */
const GATE_RE = /^(pom\.xml|\.github\/workflows\/|\.workflow\/|ci\/|\.githooks\/|frontend\/package\.json$|setup\.sh$)/i;
/** PR 触发的构建读的是目标分支的 CI 配置，所以改 CI 的 PR 自己验证不到自己 */
const CI_CONFIG_RE = /^(\.workflow\/|\.github\/workflows\/|ci\/)/i;
const SNAPSHOT_RE = /(snapshot|schema\.sql$|database_schema)/i;

const RENAME_RE = /(改名|重命名|更名|退役|rename|术语统一|码位)/i;
/** 接缝/权限相关：术语指错接缝会直接变成越权，不能当普通改名处理 */
const SEAM_RE = /(术语表|名词表|glossary|helper|接缝|seam)/i;
const AUTHZ_RE = /(权限|越权|授权|authoriz|permission|Guard|ProjectContext|resolver)/i;
const ORDER_RE = /(前置|同批|按顺序|合入顺序|依赖\s*!\d|等\s*!\d|先合|后合|先合入者为准)/i;

function any(files: string[], re: RegExp) {
  return files.some((file) => re.test(file));
}

/** 判断这批文件里有没有实现代码，用于识别"只改契约、实现没跟" */
export function hasImplementationFile(files: string[]) {
  return files.some((file) => IMPL_RE.test(file));
}

export function classifyReasons(context: ReasonContext): ReasonHit[] {
  const all = context.files ?? [];
  const files = all.filter((file) => !TEST_RE.test(file));
  const hits: ReasonHit[] = [];
  const title = context.title ?? "";
  const contractFiles = files.filter((file) => CONTRACT_RE.test(file));

  // —— 1. 契约字段变更（内容型，最高优先）——
  // 但"本模块只有语义证据"时不能套用这条：契约文件不在它的路径里，
  // 说"逐个核对本模块读写两侧"是替别人下结论。生产上踩过：一次评分 PR 的卡片里，
  // 15 条影响全部写着"契约字段/类型变更 → 逐个核对读写两侧"，包括底座、实验这些
  // 只是词面沾边的模块，9 个人一起收到"⚠ 需确认"。
  if (contractFiles.length && !context.semanticOnly) {
    hits.push({
      code: "contract_field",
      nature: "directive",
      label: "契约字段/类型变更",
      action: "逐个核对本模块读写两侧与旧客户端，二选一写进正文并补负样本"
    });
  }

  // —— 2. 语义/口径变更（认知型）——
  if (context.semanticOnly && contractFiles.length) {
    hits.push({
      code: "semantic_caliber",
      nature: "cognitive",
      label: "上游契约变了，本模块只是语义相关",
      action: "先确认本模块是否读写该契约：是则跟改，否则忽略这条"
    });
  } else if (context.semanticOnly) {
    hits.push({
      code: "semantic_caliber",
      nature: "cognitive",
      label: "语义/口径可能不一致",
      action: "人工判定是否复用同名；附一条可复跑的最小实测或坏样本，否则会来回改"
    });
  } else if (any(files, RFC_BODY_RE) && !contractFiles.length) {
    hits.push({
      code: "semantic_caliber",
      nature: "cognitive",
      label: "设计口径变更（结构未变）",
      action: "确认定义句、分母、状态判定、时区、精度是否影响其他模块"
    });
  }

  // —— 3. 改名/退役名/码位（内容型）——
  if (RENAME_RE.test(title) && files.length >= 5) {
    hits.push({
      code: "identifier_rename",
      nature: "directive",
      label: "改名/退役名（影响面较广）",
      action: "全仓 grep 含大小写与不可见字符变体，同步撤销清单与豁免理由"
    });
  }

  // —— 3b. 接缝标识符指错 → 可能变成越权（认知型，高后果）——
  if ((any(files, SEAM_RE) && any(files, AUTHZ_RE)) || (SEAM_RE.test(title) && AUTHZ_RE.test(title))) {
    hits.push({
      code: "security_seam",
      nature: "cognitive",
      label: "术语/接缝可能指错（存在越权风险）",
      action: "要求给出「错误接缝 vs 正确接缝」对照，并补一条越权负样本"
    });
  }

  // —— 4. 对外接口面（内容型）——
  if (any(files, API_SURFACE_RE)) {
    hits.push({
      code: "api_surface",
      nature: "directive",
      label: "路由/封套/错误码/代理变更",
      action: "核对前端调用面、部署层代理与公共码表，给出升级顺序与回滚路径"
    });
    if (any(files, FRONTEND_RE)) {
      hits.push({
        code: "cross_end",
        nature: "directive",
        label: "跨端封套/错误码可能不一致",
        action: "确认后端返回体与前端解析（如 ApiError.data）同步更新"
      });
    }
  }

  // —— 5. 迁移与列类型（时序型：版本号顺序是硬冲突）——
  if (any(files, DDL_RE)) {
    hits.push({
      code: "db_migration",
      nature: "ordering",
      label: "库结构与迁移版本顺序",
      action: "核对在途 PR 的迁移版本号（Flyway 严格递增），同步 schema 快照与断言"
    });
  }

  // —— 6. 共享文件竞争（时序型，实测最集中的真实冲突点）——
  if (any(files, SHARED_ASSET_RE) && files.length > 1) {
    hits.push({
      code: "shared_asset",
      nature: "ordering",
      label: "共享/只追加文件抢同一行",
      action: "立即试合并（git merge-tree），保留双方行，先协调顺序再推 head"
    });
  }

  // —— 7. 合入顺序 / "谁后合谁返工"（时序型）——
  const stacked = Boolean(context.pull && !/^(main|master)$/.test(context.pull.base));
  if (stacked) {
    hits.push({
      code: "merge_order",
      nature: "ordering",
      label: `叠在 ${context.pull?.base} 之上，存在硬前置`,
      action: "不要单独合入；把顺序写进描述，前置合入后 rebase 并重取结论"
    });
  } else if (ORDER_RE.test(title)) {
    hits.push({
      code: "merge_order",
      nature: "ordering",
      label: "涉及合入顺序或前置依赖",
      action: "确认前置 PR 状态，必要时写进放行记录"
    });
  }
  const parallel = context.parallelPulls ?? [];
  if (parallel.length) {
    const who = parallel.slice(0, 3).map((pull) => `!${pull.number}${pull.author ? `(${pull.author})` : ""}`).join("、");
    hits.push({
      code: "parallel_edit",
      nature: "ordering",
      label: `与在飞 PR ${who} 改动同一批文件`,
      action: "影响是相互的——谁后合谁返工。通知双方并先约定合入顺序"
    });
  }

  // —— 8. 门禁/工具链/基线（合规型）——
  if (any(files, GATE_RE)) {
    hits.push({
      code: "gate_toolchain",
      nature: "compliance",
      label: "门禁/工具链/基线变更",
      action: "同步所有靠手写清单传播的入口；新门禁先用已知失败输入自证会红"
    });
  }

  // —— 8b. 门禁自我盲区（合规型）——
  if (any(files, CI_CONFIG_RE)) {
    hits.push({
      code: "gate_self_blind",
      nature: "compliance",
      label: "改的是 CI 配置，本 PR 自己的检查验证不到",
      action: "走手动分支构建取证据；结论写「未取到 + 取法 + 失败路径」，不要写成「不存在」"
    });
  }

  // —— 9. 文档-实现/快照漂移（认知型）——
  const rfcBody = any(files, RFC_BODY_RE);
  if (rfcBody && (!any(files, RFC_META_RE) || !any(files, RFC_SPEC_RE))) {
    hits.push({
      code: "doc_drift",
      nature: "cognitive",
      label: "文档三层未同改（正文 / meta / spec）",
      action: "三层一起改；只改正文会让机器可读部分留下旧口径"
    });
  } else if (any(files, SNAPSHOT_RE) && context.hasImplementation === false) {
    hits.push({
      code: "doc_drift",
      nature: "cognitive",
      label: "快照/契约改了但实现未跟",
      action: "判定归属：本 PR 引入的本 PR 修，存量记 follow-up"
    });
  }

  // —— 10. 基线漂移（时序型：先同步 base 再判断，不要按「不一致」开单）——
  if (typeof context.pull?.behindBy === "number" && context.pull.behindBy > 0) {
    hits.push({
      code: "baseline_drift",
      nature: "ordering",
      label: `基于更早的主干起草，落后 ${context.pull.behindBy} 个提交`,
      action: "先 rebase/同步 base 再复评；不要直接按「与文档不一致」开单"
    });
  }

  // —— 11. 证据失效（合规型：head 一变，旧结论作废）——
  if (context.pull?.headChanged) {
    hits.push({
      code: "evidence_invalidation",
      nature: "compliance",
      label: "head 已变化，旧评审结论作废",
      action: "证据要绑 (PR head, base/merge ref, CI 配置版本) 三项后重出结论；CI 未取到就写「未取得」，不要写「通过」"
    });
  }

  // —— 12. 依据来自未合入的 PR（合规型）——
  const pending = context.unmergedReferences ?? [];
  if (pending.length) {
    hits.push({
      code: "pending_source",
      nature: "compliance",
      label: `依据来自尚未合入主干的 ${pending.slice(0, 3).map((n) => `!${n}`).join("、")}`,
      action: "先确认这些 PR 是否已进 main；未进则不得作为实现依据"
    });
  }

  return hits;
}

export const NATURE_LABELS: Record<ReasonNature, string> = {
  directive: "需要跟改",
  ordering: "需要协调顺序",
  cognitive: "需要人工确认口径",
  compliance: "需要补证据/过门禁"
};

const NATURE_ORDER: ReasonNature[] = ["directive", "ordering", "cognitive", "compliance"];

/** 每条影响只带一条主原因（最该先做的），完整清单见控制台 */
export function primaryReason(hits: ReasonHit[]): ReasonHit | null {
  for (const nature of NATURE_ORDER) {
    const found = hits.find((item) => item.nature === nature);
    if (found) return found;
  }
  return null;
}
