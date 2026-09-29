/**
 * 契约归属：把 `docs/rfcs/meta/*.json` 当成归属的事实源。
 *
 * 为什么需要它：模块的路径模式是**人写的一句话**（"这个工作项对应哪些文件"），实测某仓库
 * 142 个模块的模式全部失效——写的是 `backend/src/main/java/**`、`docs/modules/**`，
 * 而仓库里这两个目录都不存在。把 glob 放宽只会制造假归属，所以换一条路：
 *
 * 仓库里的 RFC meta 已经是机器可读的契约，且直接写明了归属关系：
 * - `tasks[].ref` = `BOSC-0100#T1` → 反查到工作项 `work-bosc-0100` → 负责人；
 * - meta 文件自己的路径 → RFC 的文档三件套（正文 / meta / 附件），这是该仓库最大的变更面；
 * - `authors` → 责任人（可与工作项负责人交叉校验）；
 * - `related` / `requires` → 契约之间的依赖边，是"跨模块语义未对齐"的机器可读来源。
 *
 * 因此这里的模式是**读出来的**，不是猜出来的：每条都能追到某个 RFC 的某个任务。
 * 仍然覆盖不到的改动会被如实报成"没有契约背书"，用于倒逼补契约，而不是继续调 glob。
 */
import { config } from "./config.js";
import { execute, parseJson, queryAll } from "./db.js";
import { giteeRequest } from "./gitee.js";
import { isOperationalModule } from "./impact.js";

export interface RfcContract {
  slug: string;
  title: string;
  status: string;
  level: string;
  authors: string[];
  /** 该 RFC 的任务反查出的工作项编号，例如 BOSC-0100 */
  workRefs: string[];
  /** 该 RFC 涉及的文档路径模式 */
  docPatterns: string[];
  /** 任务 scope 里已经存在于仓库的文件（尚未实现的不会出现） */
  codePatterns: string[];
  /** depends_on / extends / related 等边，值为被引用的 RFC slug */
  related: Array<{ relation: string; ref: string }>;
  taskCount: number;
}

/** `BOSC-0100#T1` → `bosc-0100`；`WS-2804` → `ws-2804` */
export function workRefOf(ref: string): string | null {
  const match = /^([A-Za-z]+-\d+)/.exec(ref.trim());
  return match ? match[1].toLowerCase() : null;
}

/** 该仓库的模块 key 是 `work-bosc-0100`，RFC 里写的是 `BOSC-0100` */
export function moduleKeyOfRef(ref: string): string | null {
  const bare = workRefOf(ref);
  return bare ? `work-${bare}` : null;
}

const CLASS_PATTERN = /\b([A-Z][A-Za-z0-9]{2,}(?:Service|Api|Worker|Mapper|Controller|Repository|Port|Evaluator|Engine|Handler|Test|IT|Dto|VO|Entity|Config|Job|Task|Filter|Aspect))\b/g;
const FILE_PATTERN = /\b([A-Za-z0-9_./-]+\.(?:java|sql|ts|tsx|mdx|json|xml|yml|yaml))\b/g;

/** RFC 正文/meta/附件三件套的路径模式，覆盖该仓库文档侧的主流命名 */
export function docPatternsOfSlug(slug: string): string[] {
  return [
    `docs/rfcs/${slug}.mdx`,
    `docs/rfcs/${slug}.md`,
    `docs/rfcs/meta/${slug}.json`,
    `docs/rfcs/assets/${slug}/**`
  ];
}

/**
 * 从任务 scope 里提取"已经存在的文件"作为代码侧模式。
 * 未落地的类名不会出现在仓库里，把它们当模式只会产生永不命中的死模式，所以先比对真实文件树。
 */
export function codePatternsOfScopes(scopes: string[], tree: string[]): string[] {
  const basenames = new Map<string, number>();
  for (const path of tree) {
    const name = path.split("/").pop() ?? "";
    basenames.set(name, (basenames.get(name) ?? 0) + 1);
  }
  const patterns = new Set<string>();
  for (const scope of scopes) {
    for (const file of scope.match(FILE_PATTERN) ?? []) {
      const hit = tree.find((path) => path === file || path.endsWith(`/${file}`));
      if (hit) patterns.add(hit);
    }
    for (const className of scope.match(CLASS_PATTERN) ?? []) {
      const file = `${className}.java`;
      const count = basenames.get(file) ?? 0;
      // 同名类只有一个才算得上精确；多个同名说明必须靠目录区分，交给人工补
      if (count === 1) patterns.add(`**/${file}`);
    }
  }
  return [...patterns];
}

export function parseRfcMeta(path: string, raw: unknown, tree: string[]): RfcContract | null {
  const json = raw as Record<string, unknown>;
  if (!json || typeof json !== "object") return null;
  const slug = (path.split("/").pop() ?? "").replace(/\.json$/, "");
  if (!slug) return null;
  const tasks = Array.isArray(json.tasks) ? (json.tasks as Array<Record<string, unknown>>) : [];
  const workRefs = new Set<string>();
  const scopes: string[] = [];
  for (const task of tasks) {
    const moduleKey = moduleKeyOfRef(String(task.ref ?? ""));
    if (moduleKey) workRefs.add(moduleKey.replace(/^work-/, "").toUpperCase());
    if (typeof task.scope === "string") scopes.push(task.scope);
  }
  const related = (Array.isArray(json.related) ? (json.related as Array<Record<string, unknown>>) : [])
    .map((item) => ({
      relation: String(item.relation ?? "related"),
      ref: String(item.ref ?? "").replace(/^\.\//, "").replace(/\.(mdx?|json)$/, "")
    }))
    .filter((item) => item.ref);
  return {
    slug,
    title: String(json.title ?? slug),
    status: String(json.status ?? ""),
    level: String(json.level ?? ""),
    authors: (Array.isArray(json.authors) ? (json.authors as unknown[]) : []).map(String),
    workRefs: [...workRefs],
    docPatterns: docPatternsOfSlug(slug),
    codePatterns: codePatternsOfScopes(scopes, tree),
    related,
    taskCount: tasks.length
  };
}

export async function fetchRepoTreeForRfc(): Promise<string[]> {
  if (!config.giteeRepo || !config.giteeToken) throw new Error("GITEE_TOKEN 与 GITEE_REPO 未配置");
  const [owner, name] = config.giteeRepo.split("/");
  const data = await giteeRequest<{ tree?: Array<{ type: string; path: string }> }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(config.giteeDefaultBranch)}?recursive=1`
  );
  return (data?.tree ?? []).filter((item) => item.type === "blob").map((item) => item.path);
}

async function fetchFileText(path: string): Promise<string> {
  const [owner, name] = config.giteeRepo.split("/");
  const data = await giteeRequest<{ content?: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`
  );
  return Buffer.from(data?.content ?? "", "base64").toString("utf8");
}

/** 拉取全部 RFC meta。只读操作，不修改目标仓库。 */
export async function syncRfcContracts(): Promise<{ contracts: number; withWorkRefs: number; docPatterns: number; codePatterns: number; failed: string[] }> {
  const tree = await fetchRepoTreeForRfc();
  const metaPaths = tree.filter((path) => /^docs\/rfcs\/meta\/.*\.json$/.test(path));
  const contracts: RfcContract[] = [];
  const failed: string[] = [];
  for (const path of metaPaths) {
    try {
      contracts.push(parseRfcMeta(path, JSON.parse(await fetchFileText(path)), tree)!);
    } catch (error) {
      failed.push(`${path}: ${String(error).slice(0, 80)}`);
    }
  }
  const now = new Date().toISOString();
  for (const item of contracts.filter(Boolean)) {
    execute(
      `INSERT INTO rfc_contracts (project_id, slug, title, status, level, authors_json, work_refs_json, doc_patterns_json, code_patterns_json, related_json, task_count, synced_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, slug) DO UPDATE SET
         title = excluded.title, status = excluded.status, level = excluded.level,
         authors_json = excluded.authors_json, work_refs_json = excluded.work_refs_json,
         doc_patterns_json = excluded.doc_patterns_json, code_patterns_json = excluded.code_patterns_json,
         related_json = excluded.related_json, task_count = excluded.task_count, synced_at = excluded.synced_at`,
      [
        item.slug, item.title, item.status, item.level,
        JSON.stringify(item.authors), JSON.stringify(item.workRefs),
        JSON.stringify(item.docPatterns), JSON.stringify(item.codePatterns),
        JSON.stringify(item.related), item.taskCount, now
      ]
    );
  }
  return {
    contracts: contracts.length,
    withWorkRefs: contracts.filter((item) => item.workRefs.length > 0).length,
    docPatterns: contracts.reduce((sum, item) => sum + item.docPatterns.length, 0),
    codePatterns: contracts.reduce((sum, item) => sum + item.codePatterns.length, 0),
    failed
  };
}

export function listRfcContracts(): RfcContract[] {
  return queryAll<{ slug: string; title: string; status: string; level: string; authorsJson: string; workRefsJson: string; docPatternsJson: string; codePatternsJson: string; relatedJson: string; taskCount: number }>(
    `SELECT slug, title, status, level, authors_json AS authorsJson, work_refs_json AS workRefsJson,
            doc_patterns_json AS docPatternsJson, code_patterns_json AS codePatternsJson,
            related_json AS relatedJson, task_count AS taskCount
     FROM rfc_contracts WHERE project_id = 1 ORDER BY slug`
  ).map((row) => ({
    slug: row.slug,
    title: row.title,
    status: row.status,
    level: row.level,
    authors: parseJson<string[]>(row.authorsJson, []),
    workRefs: parseJson<string[]>(row.workRefsJson, []),
    docPatterns: parseJson<string[]>(row.docPatternsJson, []),
    codePatterns: parseJson<string[]>(row.codePatternsJson, []),
    related: parseJson<Array<{ relation: string; ref: string }>>(row.relatedJson, []),
    taskCount: row.taskCount
  }));
}

export interface RfcPatternPlan {
  moduleKey: string;
  moduleName: string;
  owner: string | null;
  slug: string;
  added: string[];
  before: string[];
  after: string[];
}

/** 把 RFC 派生模式并进模块路径模式（只增不减，且幂等） */
export function planRfcPatterns(projectId = 1): RfcPatternPlan[] {
  const contracts = listRfcContracts();
  const modules = queryAll<{ moduleKey: string; name: string; owner: string | null; pathsJson: string }>(
    `SELECT m.module_key AS moduleKey, m.name, u.display_name AS owner, m.paths_json AS pathsJson
     FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id WHERE m.project_id = ?`,
    [projectId]
  ).filter((row) => isOperationalModule(row as never));
  const byKey = new Map(modules.map((row) => [row.moduleKey.toLowerCase(), row]));
  const plans: RfcPatternPlan[] = [];
  for (const contract of contracts) {
    const derived = [...contract.docPatterns, ...contract.codePatterns];
    if (!derived.length) continue;
    for (const workRef of contract.workRefs) {
      const moduleKey = `work-${workRef.toLowerCase()}`;
      const module = byKey.get(moduleKey);
      if (!module) continue;
      const before = parseJson<string[]>(module.pathsJson, []);
      const added = derived.filter((pattern) => !before.includes(pattern));
      if (!added.length) continue;
      plans.push({
        moduleKey: module.moduleKey,
        moduleName: module.name,
        owner: module.owner,
        slug: contract.slug,
        added,
        before,
        after: [...before, ...added]
      });
    }
  }
  return plans;
}

export function applyRfcPatterns(projectId = 1): { applied: number; patternsAdded: number; modules: string[] } {
  const plans = planRfcPatterns(projectId);
  let patternsAdded = 0;
  for (const plan of plans) {
    const row = queryAll<{ id: number }>(
      `SELECT id FROM modules WHERE project_id = ? AND module_key = ?`,
      [projectId, plan.moduleKey]
    )[0];
    if (!row) continue;
    execute(`UPDATE modules SET paths_json = ? WHERE id = ?`, [JSON.stringify(plan.after), row.id]);
    patternsAdded += plan.added.length;
  }
  return { applied: plans.length, patternsAdded, modules: plans.map((plan) => plan.moduleKey) };
}

export interface RfcCoverage {
  contracts: number;
  contractsWithTasks: number;
  modulesTotal: number;
  modulesWithRfc: number;
  modulesWithoutRfc: string[];
  /** 交叉校验：RFC authors 里是否出现了该工作项的负责人姓名 */
  ownerAgreement: Array<{ moduleKey: string; owner: string; slug: string; agreed: boolean }>;
}

/** 契约覆盖：多少模块有 RFC 背书、多少没有。没有背书的模块只能靠语义猜词，这张表就是待补清单。 */
export function rfcCoverage(projectId = 1): RfcCoverage {
  const contracts = listRfcContracts();
  const modules = queryAll<{ moduleKey: string; name: string; owner: string | null }>(
    `SELECT m.module_key AS moduleKey, m.name, u.display_name AS owner
     FROM modules m LEFT JOIN users u ON u.id = m.owner_user_id WHERE m.project_id = ?`,
    [projectId]
  ).filter((row) => isOperationalModule(row as never));
  const byKey = new Map(modules.map((row) => [row.moduleKey.toLowerCase(), row]));
  const covered = new Set<string>();
  const agreement: RfcCoverage["ownerAgreement"] = [];
  for (const contract of contracts) {
    for (const workRef of contract.workRefs) {
      const moduleKey = `work-${workRef.toLowerCase()}`;
      const module = byKey.get(moduleKey);
      if (!module) continue;
      covered.add(moduleKey);
      if (module.owner) {
        agreement.push({
          moduleKey: module.moduleKey,
          owner: module.owner,
          slug: contract.slug,
          agreed: contract.authors.some((author) => author.includes(module.owner!))
        });
      }
    }
  }
  return {
    contracts: contracts.length,
    contractsWithTasks: contracts.filter((contract) => contract.workRefs.length > 0).length,
    modulesTotal: modules.length,
    modulesWithRfc: covered.size,
    modulesWithoutRfc: modules.filter((module) => !covered.has(module.moduleKey.toLowerCase())).map((module) => module.moduleKey),
    ownerAgreement: agreement
  };
}
