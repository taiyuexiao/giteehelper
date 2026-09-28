/**
 * 路径模式体检。
 *
 * 为什么需要它：系统里的模块路径模式是"应该长什么样"的描述，而仓库是"实际长什么样"。
 * 两者一旦不一致，路径匹配就会全部落空，归属只能退回语义猜词——那正是误报的来源。
 * 实测该仓库：146 个工作项里绝大多数模式写着 `backend/src/main/java/**` 与 `docs/modules/**`，
 * 而仓库里这两个目录**都不存在**（实际是 `src/main/java/` 与 `docs/rfcs/`）。
 */
import { config } from "./config.js";
import { execute, parseJson, queryAll } from "./db.js";
import { giteeRequest } from "./gitee.js";
import { isOperationalModule, wildcardMatch } from "./impact.js";


/** 把仓库文件树拉下来（一次调用），用于判断路径模式是否真的能匹配到文件 */
export async function fetchRepoTree(): Promise<string[]> {
  if (!config.giteeRepo || !config.giteeToken) throw new Error("GITEE_TOKEN 与 GITEE_REPO 未配置");
  const [owner, name] = config.giteeRepo.split("/");
  const data = await giteeRequest<{ tree?: Array<{ type: string; path: string }> }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(config.giteeDefaultBranch)}?recursive=1`
  );
  return (data?.tree ?? []).filter((item) => item.type === "blob").map((item) => item.path);
}

export interface PatternHealth {
  moduleKey: string;
  moduleName: string;
  owner: string | null;
  patterns: string[];
  /** 每个模式能匹配到的真实文件数 */
  matches: Array<{ pattern: string; files: number }>;
  verdict: "ok" | "partial" | "dead";
  /** 形似但实际不存在的路径段，例如 backend/ */
  suspectSegments: string[];
}

export interface PatternHealthReport {
  /** 仓库真实文件总数（来自 git tree，不是本地克隆） */
  files: number;
  modules: number;
  /** 全部模式都能命中的模块数 */
  ok: number;
  /** 部分模式命中的模块数 */
  partial: number;
  /** 一个模式都命中不了的模块数——这些模块的改动无法归属到负责人 */
  dead: number;
  /** 集中出现的幽灵路径段，例如 backend、docs/modules */
  ghostPrefixes: string[];
  modules_detail: PatternHealth[];
}

export interface PatternFix {
  moduleKey: string;
  moduleName: string;
  owner: string | null;
  before: string[];
  after: string[];
  filesBefore: number;
  filesAfter: number;
  /** 待确认的文档侧改写建议（默认不自动应用） */
  pendingReview: string[];
}

/**
 * 提出路径模式的修正建议。
 *
 * 实测该仓库：142 个模块的模式**全部失效**（0 能命中真实文件）。原因有两类：
 * - 机械错误：模式写成 `backend/src/main/java/**`，而仓库里没有 backend/ 目录，
 *   真实结构是 `src/main/java/com/bosc/ageval/<层>/<领域>/...`。去掉前缀即可修好，
 *   属于**安全修复**（语义不变）。
 * - 需要人判断：模式写成 `docs/modules/<领域>/**`，而仓库里没有 docs/modules/，
 *   文档实际在 `docs/rfcs/*<领域>*.mdx` 与 `specs/<日期>-<名称>/`。
 *   这种改写会改变语义（可能过宽或过窄），只给建议不自动改。
 */
export function suggestPatternFixes(patterns: string[], includeReview: boolean) {
  const safe: string[] = [];
  const review: string[] = [];
  for (const pattern of patterns) {
    // 机械错误：仓库没有 backend/ 目录，Java 代码直接在 src/main/java 下。语义不变，直接修。
    if (pattern.startsWith("backend/")) {
      safe.push(pattern.replace(/^backend\//, ""));
      continue;
    }
    // 需要人判断：仓库没有 docs/modules/，设计文档实际在 docs/rfcs/，需求在 specs/
    if (pattern.startsWith("docs/modules/")) {
      const area = pattern.replace(/^docs\/modules\//, "").replace(/\/\*\*$/, "").replace(/\/$/, "");
      const suggested = area ? `docs/rfcs/*${area}*` : "docs/rfcs/**";
      review.push(suggested);
      safe.push(includeReview ? suggested : pattern);
      continue;
    }
    safe.push(pattern);
  }
  return { patterns: safe, pendingReview: review };
}

export async function patternFixPreview(projectId = 1, includeReview = false) {
  const files = await fetchRepoTree();
  const report = await patternHealth(projectId);
  const fixes = report.modules_detail.map((item) => {
    const suggestion = suggestPatternFixes(item.patterns, includeReview);
    return {
      moduleKey: item.moduleKey,
      moduleName: item.moduleName,
      owner: item.owner,
      before: item.patterns,
      after: suggestion.patterns,
      filesBefore: item.matches.reduce((sum, one) => sum + one.files, 0),
      filesAfter: suggestion.patterns.reduce(
        (sum, pattern) => sum + files.filter((file) => wildcardMatch(file, pattern)).length, 0
      ),
      pendingReview: suggestion.pendingReview
    } satisfies PatternFix;
  });
  const improved = fixes.filter((item) => item.filesAfter > item.filesBefore);
  return {
    files: files.length,
    deadBefore: report.dead,
    fixable: improved.length,
    pendingReview: fixes.filter((item) => item.pendingReview.length > 0).length,
    filesBeforeTotal: fixes.reduce((sum, item) => sum + item.filesBefore, 0),
    filesAfterTotal: fixes.reduce((sum, item) => sum + item.filesAfter, 0),
    fixes
  };
}

/**
 * 应用修复。默认只做**机械前缀修复**（backend/ → 去掉，语义不变）；
 * 文档侧改写会改变匹配语义，必须显式 includeReview 才动。
 */
export async function applyPatternFixes(options: { includeReview?: boolean } = {}, projectId = 1) {
  const preview = await patternFixPreview(projectId, options.includeReview === true);
  const targets = preview.fixes.filter((item) => item.filesAfter > item.filesBefore);
  for (const fix of targets) {
    const row = queryAll<{ id: number }>(
      `SELECT id FROM modules WHERE project_id = ? AND module_key = ?`,
      [projectId, fix.moduleKey]
    )[0];
    if (!row) continue;
    execute(`UPDATE modules SET paths_json = ? WHERE id = ?`, [JSON.stringify(fix.after), row.id]);
  }
  return {
    applied: targets.length,
    pendingReview: preview.pendingReview,
    filesBeforeTotal: preview.filesBeforeTotal,
    filesAfterTotal: preview.filesAfterTotal,
    samples: targets.slice(0, 10).map((item) => ({ module: item.moduleName, after: item.after, hits: `${item.filesBefore} → ${item.filesAfter}` }))
  };
}

/** 顶层目录是否存在 */
function topLevelExists(files: string[], prefix: string) {
  return files.some((file) => file.startsWith(`${prefix}/`));
}

export async function patternHealth(projectId = 1): Promise<PatternHealthReport> {
  const files = await fetchRepoTree();
  const rows = queryAll<{ moduleKey: string; name: string; owner: string | null; pathsJson: string }>(
    `SELECT m.module_key AS moduleKey, m.name, u.display_name AS owner, m.paths_json AS pathsJson
     FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id WHERE m.project_id = ?`,
    [projectId]
  ).filter((row) => isOperationalModule(row));

  const detail: PatternHealth[] = [];
  const ghost = new Set<string>();

  for (const row of rows) {
    const patterns = parseJson<string[]>(row.pathsJson, []);
    if (!patterns.length) continue;
    const matches = patterns.map((pattern) => ({
      pattern,
      files: files.filter((file) => wildcardMatch(file, pattern)).length
    }));
    const matched = matches.filter((item) => item.files > 0).length;
    const verdict: PatternHealth["verdict"] = matched === 0 ? "dead" : matched === matches.length ? "ok" : "partial";
    const suspectSegments = [...new Set(
      matches
        .filter((item) => item.files === 0)
        .flatMap((item) => item.pattern.replace(/\/\*\*.*$/, "").split("/").slice(0, 2))
        .filter((segment) => segment && !segment.includes("*") && !topLevelExists(files, segment))
    )];
    for (const segment of suspectSegments) ghost.add(segment);
    detail.push({
      moduleKey: row.moduleKey,
      moduleName: row.name,
      owner: row.owner,
      patterns,
      matches,
      verdict,
      suspectSegments
    });
  }

  return {
    files: files.length,
    modules: detail.length,
    ok: detail.filter((item) => item.verdict === "ok").length,
    partial: detail.filter((item) => item.verdict === "partial").length,
    dead: detail.filter((item) => item.verdict === "dead").length,
    ghostPrefixes: [...ghost],
    modules_detail: detail
  };
}
