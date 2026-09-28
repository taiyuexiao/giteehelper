import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import ForceGraph3D, { type ConfigOptions, type ForceGraph3DInstance } from "3d-force-graph";
import * as THREE from "three";
import { AlertTriangle, Boxes, FolderGit2, GitCommitHorizontal, RefreshCw, RotateCcw, Search, Sparkles, Users } from "lucide-react";
import { api } from "../api";
import { EmptyState, Loading, PageHeader, SeverityBadge } from "../components";
import { ownerPalette } from "../../shared/ownerColor";
import type { GraphNode, RepoCommitMeta, RepoGraphData, RepoOwnerCluster, Severity } from "../../shared/types";

type RepoNode = GraphNode & { x?: number; y?: number; z?: number };
type RepoLink = { id: string; source: string | RepoNode; target: string | RepoNode; label: string; confidence: string };
type ViewMode = "all" | "new" | "conflict" | "unattributed";

const BACKGROUND = "#f2f6f7";
const NEW_WINDOW_HOURS = 24;

const SEVERITY_COLORS: Record<string, number> = {
  blocking: 0xd14b4b,
  contract: 0xdb8a2b,
  implementation: 0x39809c,
  clarification: 0x7f7bb0,
  informational: 0x8fa3ad
};

const TYPE_LABELS: Record<string, string> = {
  project: "仓库",
  module: "模块",
  contract: "契约",
  scenario: "场景",
  author: "提交人",
  commit: "提交",
  pull: "PR"
};

let glowTextureCache: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTextureCache) return glowTextureCache;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.38)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  glowTextureCache = new THREE.CanvasTexture(canvas);
  return glowTextureCache;
}

function textSprite(text: string, options: { color?: string; scale?: number; weight?: number } = {}) {
  const fontSize = 44;
  const font = `${options.weight ?? 700} ${fontSize}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + 36;
  const height = fontSize + 26;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.font = font;
  context.fillStyle = options.color ?? "#25404b";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, width / 2, height / 2);

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false
  }));
  const unit = options.scale ?? 0.085;
  sprite.scale.set(width * unit, height * unit, 1);
  return sprite;
}

function commitMeta(node: RepoNode): RepoCommitMeta | undefined {
  return node.type === "commit" ? (node.meta as unknown as RepoCommitMeta) : undefined;
}

function commitColor(meta: RepoCommitMeta) {
  if (meta.conflict) return SEVERITY_COLORS[meta.severity ?? "blocking"] ?? SEVERITY_COLORS.blocking;
  return SEVERITY_COLORS[meta.severity ?? "informational"] ?? SEVERITY_COLORS.informational;
}

export default function RepoGraphPage({ user }: { user: { role: string } }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const nodesRef = useRef<RepoNode[]>([]);
  const linksRef = useRef<RepoLink[]>([]);
  const clusterRef = useRef<{ cluster: RepoOwnerCluster; mesh: THREE.Mesh; ring: THREE.Mesh; label: THREE.Sprite }[]>([]);
  const haloRef = useRef<{ node: RepoNode; halo: THREE.Sprite }[]>([]);
  const frameRef = useRef<number>(0);
  const resizeRef = useRef<(() => void) | null>(null);

  const [data, setData] = useState<RepoGraphData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ViewMode>("all");
  const [query, setQuery] = useState("");
  const [owners, setOwners] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(80);
  const [hovered, setHovered] = useState<{ node: RepoNode; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<RepoNode | null>(null);

  const load = useCallback(async (nextLimit = limit) => {
    setBusy(true);
    try {
      const payload = await api<RepoGraphData>(`/repo/graph?limit=${nextLimit}`);
      setData(payload);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [limit]);

  useEffect(() => { void load(limit); }, [limit, load]);

  const clusters = useMemo(() => {
    const map = new Map<string, RepoOwnerCluster>();
    for (const cluster of data?.clusters ?? []) map.set(cluster.owner, cluster);
    return [...map.values()];
  }, [data]);

  // ---- 过滤后的可见子集：只算 id，真正的对象复用 nodesRef 里的同一批实例，避免布局重置 ----
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    const keyword = query.trim().toLowerCase();
    for (const node of data?.nodes ?? []) {
      const meta = commitMeta(node as RepoNode);
      if (mode === "new" && (!meta || (!meta.isNew && !meta.justArrived))) continue;
      if (mode === "conflict" && !(node.type === "module" || node.type === "project" || (meta?.conflict ?? false))) continue;
      if (mode === "unattributed" && !(node.type === "project" || (meta && meta.affectedModules.length === 0))) continue;
      if (owners.size > 0 && node.type === "module" && !owners.has((node.meta?.owner as string) ?? "")) continue;
      if (keyword) {
        const haystack = `${node.label} ${node.type} ${meta?.summary ?? ""} ${meta?.author ?? ""} ${(node.meta?.owner as string) ?? ""}`.toLowerCase();
        if (!haystack.includes(keyword)) continue;
      }
      ids.add(node.id);
    }
    return ids;
  }, [data, mode, owners, query]);

  const updateClusterPositions = useCallback(() => {
    for (const item of clusterRef.current) {
      const memberIds = new Set([...item.cluster.moduleIds, ...item.cluster.commitIds]);
      const members = nodesRef.current.filter((node) => memberIds.has(node.id) && node.x !== undefined);
      if (!members.length) continue;
      const centroid = members.reduce(
        (accumulator, node) => ({ x: accumulator.x + (node.x ?? 0), y: accumulator.y + (node.y ?? 0), z: accumulator.z + (node.z ?? 0) }),
        { x: 0, y: 0, z: 0 }
      );
      centroid.x /= members.length;
      centroid.y /= members.length;
      centroid.z /= members.length;
      const radius = Math.max(
        26,
        Math.max(...members.map((node) => Math.hypot((node.x ?? 0) - centroid.x, (node.y ?? 0) - centroid.y, (node.z ?? 0) - centroid.z))) * 1.6 + 22
      );
      item.mesh.position.set(centroid.x, centroid.y, centroid.z);
      item.ring.position.copy(item.mesh.position);
      item.mesh.scale.setScalar(radius);
      item.ring.scale.setScalar(radius * 1.03);
      item.label.position.set(centroid.x, centroid.y + radius + 14, centroid.z);
    }
  }, []);

  /**
   * 图实例必须在数据到达后才创建：没有数据时页面只渲染加载态，容器 ref 为空，
   * 若把初始化放在 [] 依赖的 effect 里，容器挂载后不会重跑，页面会永远没有画布。
   */
  useEffect(() => {
    if (!data) return;
    nodesRef.current = data.nodes.map((node) => ({ ...node }));
    linksRef.current = data.edges.map((edge) => ({ ...edge })) as RepoLink[];

    let graph = graphRef.current;
    if (!graph && containerRef.current) {
      try {
        // 类型声明只暴露 new 形式，运行时按官方文档使用工厂调用
        const factory = ForceGraph3D as unknown as (config?: ConfigOptions) => (element: HTMLElement) => ForceGraph3DInstance;
        graph = factory({ controlType: "trackball" })(containerRef.current);
      } catch {
        setError("当前浏览器无法初始化 WebGL，3D 仓库全景不可用。");
        return;
      }
      graphRef.current = graph;
      graph
        .backgroundColor(BACKGROUND)
        .nodeId("id")
        .nodeRelSize(4)
        .nodeLabel(() => "")
        .enableNodeDrag(true)
        .showNavInfo(false)
        .cooldownTicks(140)
        .warmupTicks(30)
        .linkColor((link) => {
          const label = (link as RepoLink).label;
          if (label === "blocking") return "rgba(209,75,75,0.55)";
          if (label === "contract") return "rgba(219,138,43,0.5)";
          if (label === "implementation") return "rgba(57,128,156,0.4)";
          if (label === "unattributed") return "rgba(150,166,176,0.25)";
          if (label === "authored") return "rgba(120,140,150,0.35)";
          return "rgba(150,170,180,0.3)";
        })
        .linkWidth((link) => ((link as RepoLink).label === "blocking" ? 1.6 : 0.6))
        .linkOpacity(0.7)
        .linkDirectionalParticles((link) => ((link as RepoLink).label === "blocking" || (link as RepoLink).label === "contract" ? 3 : 0))
        .linkDirectionalParticleWidth(1.8)
        .linkDirectionalParticleColor((link) => ((link as RepoLink).label === "blocking" ? "#d14b4b" : "#db8a2b"))
        .nodeThreeObject((node) => buildNodeObject(node as RepoNode, haloRef))
        .onNodeHover((node) => {
          if (!node) {
            setHovered(null);
            return;
          }
          const instance = graphRef.current;
          if (!instance) return;
          const position = instance.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
          setHovered({ node: node as RepoNode, x: position.x, y: position.y });
        })
        .onNodeClick((node) => setSelected(node as RepoNode))
        .onBackgroundClick(() => setSelected(null))
        .onEngineTick(updateClusterPositions)
        .onEngineStop(() => graphRef.current?.zoomToFit(700, 45));

      const charge = graph.d3Force("charge");
      if (charge && "strength" in charge) {
        (charge as unknown as { strength: (value: number) => void }).strength(-70);
      }

      const resize = () => {
        const element = containerRef.current;
        if (!element || !graphRef.current) return;
        graphRef.current.width(element.clientWidth).height(element.clientHeight);
      };
      resizeRef.current = resize;
      resize();
      window.addEventListener("resize", resize);
    }
    if (!graph) return;

    // 重建负责人分区气泡
    haloRef.current = [];
    for (const item of clusterRef.current) {
      graph.scene().remove(item.mesh, item.ring, item.label);
      item.mesh.geometry.dispose();
      item.ring.geometry.dispose();
      (item.mesh.material as THREE.Material).dispose();
      (item.ring.material as THREE.Material).dispose();
      (item.label.material as THREE.SpriteMaterial).dispose();
    }
    clusterRef.current = [];
    for (const cluster of data.clusters) {
      const palette = ownerPalette(cluster.owner);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 18),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.fill), transparent: true, opacity: 0.3, depthWrite: false })
      );
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.stroke), transparent: true, opacity: 0.22, wireframe: true, depthWrite: false })
      );
      const label = textSprite(`${cluster.owner} · ${cluster.moduleNames.length} 模块`, { color: palette.text, scale: 0.1 });
      // 分区气泡是装饰层，必须与库的内部约定隔离：
      // 1) 退出射线拾取，否则点击时库会把装饰对象当成节点并读取不存在的坐标；
      // 2) 标记为非 node/link 类型，否则 zoomToFit 会把大气泡算进包围盒，导致取景过远、节点缩得很小。
      for (const object of [mesh, ring, label]) {
        object.raycast = () => {};
        object.userData.__graphObjType = "cluster";
        Object.defineProperty(object, "__graphObjType", { value: "cluster", enumerable: false });
      }
      graph.scene().add(mesh, ring, label);
      clusterRef.current.push({ cluster, mesh, ring, label });
    }

    graph.graphData({ nodes: nodesRef.current, links: linksRef.current });
    updateClusterPositions();
  }, [data, updateClusterPositions]);

  // 卸载时释放 WebGL 资源与监听
  useEffect(() => () => {
    if (resizeRef.current) window.removeEventListener("resize", resizeRef.current);
    cancelAnimationFrame(frameRef.current);
    graphRef.current?._destructor?.();
    graphRef.current = null;
  }, []);

  const resetView = () => {
    graphRef.current?.zoomToFit(700, 45);
  };

  const sync = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/gitee/sync", { method: "POST", body: JSON.stringify({ only: "commits" }) });
      await load(limit);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!data && !error) return <Loading />;
  if (!data) return <><PageHeader title="仓库全景" description="3D 视图加载失败。" /><div className="alert">{error}</div></>;

  const stats = data.stats;
  const visibleCommits = data.nodes.filter((node) => node.type === "commit" && visibleIds.has(node.id)).length;

  return (
    <>
      <PageHeader
        title="仓库全景"
        description="以 3D 结构查看仓库当前状态：模块按负责人着色，新提交带脉冲特效，悬停或点击查看该提交处理了什么问题。"
        actions={
          <>
            <button className="secondary-button" onClick={resetView}><RotateCcw size={16} />重置视角</button>
            {user.role === "admin" && <button className="secondary-button" onClick={() => void sync()} disabled={busy}><RefreshCw size={16} />补齐提交</button>}
            <button className="primary-button" onClick={() => void load(limit)} disabled={busy}><RefreshCw size={16} />{busy ? "加载中…" : "刷新"}</button>
          </>
        }
      />
      {error && <div className="alert">{error}</div>}

      <section className="metric-grid repo-metrics">
        <article className="metric"><span>提交总数</span><strong>{stats.totalCommits}</strong><GitCommitHorizontal size={19} /></article>
        <article className="metric"><span>24 小时新增</span><strong>{stats.last24h}</strong><Sparkles size={19} /></article>
        <article className={`metric ${stats.conflicts > 0 ? "metric-danger" : ""}`}><span>冲突提交</span><strong>{stats.conflicts}</strong><AlertTriangle size={19} /></article>
        <article className="metric"><span>提交人</span><strong>{stats.authors}</strong><Users size={19} /></article>
        <article className="metric"><span>当前显示</span><strong>{visibleCommits}</strong><Boxes size={19} /></article>
      </section>

      {(stats.unattributedCommits > 0 || stats.modulesWithoutPaths > 0) && (
        <div className="repo-hint">
          <AlertTriangle size={16} />
          <span>
            {stats.unattributedCommits > 0 && <>最近 {stats.unattributedCommits} 个提交未归属到模块，</>}
            {stats.modulesWithoutPaths > 0 ? `${stats.modulesWithoutPaths} 个模块还没有路径模式。` : ""}
            请在「模块与契约」中为模块补充路径模式，归属会更准确。
          </span>
        </div>
      )}

      <section className="repo-layout">
        <div className="repo-canvas-wrap">
          <div ref={containerRef} className="repo-canvas" />
          {hovered && <HoverCard node={hovered.node} x={hovered.x} y={hovered.y} />}
          <div className="repo-controls">
            <div className="view-switcher" role="tablist" aria-label="视图过滤">
              {([["all", "全部"], ["new", "仅新提交"], ["conflict", "仅冲突"], ["unattributed", "未归属"]] as Array<[ViewMode, string]>).map(([value, label]) => (
                <button key={value} role="tab" aria-selected={mode === value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{label}</button>
              ))}
            </div>
            <label className="repo-search">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提交、作者、模块" />
            </label>
            <label className="repo-range">
              <span>提交数量 {limit}</span>
              <input type="range" min={20} max={200} step={20} value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
            </label>
          </div>
          {data.nodes.length === 0 && (
            <EmptyState icon={<FolderGit2 size={25} />} title="还没有提交数据" text="配置 Gitee WebHook 后新提交会自动进入；也可以点击「补齐提交」拉取最近记录。" />
          )}
        </div>

        <aside className="repo-sidebar">
          <div className="panel">
            <div className="panel-header"><div><h2>负责人分区</h2><p>用低饱和度浅色区分模块归属。</p></div></div>
            <div className="owner-legend">
              {clusters.map((cluster) => {
                const active = owners.size === 0 || owners.has(cluster.owner);
                return (
                  <button
                    key={cluster.owner}
                    className={`owner-chip ${active ? "active" : ""}`}
                    style={{ background: cluster.fillSoft, borderColor: cluster.stroke, color: cluster.text }}
                    aria-pressed={owners.has(cluster.owner)}
                    onClick={() => setOwners((current) => {
                      const next = new Set(current);
                      if (next.has(cluster.owner)) next.delete(cluster.owner);
                      else next.add(cluster.owner);
                      return next;
                    })}
                  >
                    <i style={{ background: cluster.stroke }} />
                    <span>{cluster.owner}</span>
                    <strong>{cluster.moduleNames.length}</strong>
                  </button>
                );
              })}
              {owners.size > 0 && <button className="owner-clear" onClick={() => setOwners(new Set())}>清除负责人筛选</button>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><div><h2>接入状态</h2><p>WebHook 是实时分析的入口。</p></div></div>
            <div className="runtime-grid">
              <div><span>最近收到事件</span><strong>{stats.lastDeliveryAt ?? "尚未收到"}</strong></div>
              <div><span>处理结果</span><strong>{stats.lastDeliveryStatus ?? "—"}</strong></div>
              <div><span>最新提交时间</span><strong>{stats.latestCommitAt ?? "—"}</strong></div>
              <div><span>图形生成时间</span><strong>{new Date(stats.generatedAt).toLocaleTimeString()}</strong></div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><div><h2>图例</h2><p>颜色与形状含义。</p></div></div>
            <div className="legend">
              {Object.entries(TYPE_LABELS).filter(([type]) => type !== "scenario").map(([type, label]) => (
                <div key={type} className={`legend-item legend-${type}`}><i /><span>{label}</span></div>
              ))}
              <div className="legend-item legend-new"><i /><span>24 小时内新提交（脉冲）</span></div>
              <div className="legend-item legend-conflict"><i /><span>冲突提交（连线有流动粒子）</span></div>
            </div>
          </div>
        </aside>
      </section>

      {selected && <CommitDrawer node={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function buildNodeObject(node: RepoNode, haloRef: MutableRefObject<{ node: RepoNode; halo: THREE.Sprite }[]>) {
  const group = new THREE.Group();
  const meta = commitMeta(node);

  if (node.type === "commit" && meta) {
    const color = commitColor(meta);
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(meta.conflict ? 6.4 : 5, 0),
      new THREE.MeshBasicMaterial({ color })
    );
    group.add(core);
    if (meta.isNew || meta.justArrived) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(),
        color,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      }));
      halo.scale.set(18, 18, 1);
      group.add(halo);
      haloRef.current.push({ node, halo });
    }
    if (meta.conflict || meta.justArrived) {
      const label = textSprite(meta.shortSha, { color: "#8a2f2f", scale: 0.075 });
      label.position.set(0, 7, 0);
      group.add(label);
    }
    return group;
  }

  if (node.type === "module") {
    const owner = (node.meta?.owner as string) ?? null;
    const palette = ownerPalette(owner);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(10, 24, 18),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.stroke) })
    );
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(13.4, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.fill), transparent: true, opacity: 0.32, depthWrite: false })
    );
    group.add(core, shell);
    const label = textSprite(node.label, { color: palette.text, scale: 0.1 });
    label.position.set(0, -17, 0);
    group.add(label);
    return group;
  }

  if (node.type === "author") {
    const core = new THREE.Mesh(new THREE.SphereGeometry(5.6, 18, 14), new THREE.MeshBasicMaterial({ color: 0x6f8b96 }));
    group.add(core);
    const label = textSprite(node.label, { color: "#3d5b66", scale: 0.08 });
    label.position.set(0, -10, 0);
    group.add(label);
    return group;
  }

  if (node.type === "pull") {
    const core = new THREE.Mesh(new THREE.BoxGeometry(11, 11, 11), new THREE.MeshBasicMaterial({ color: 0x7d6bb0 }));
    group.add(core);
    const label = textSprite(`PR ${node.label}`, { color: "#4b3f75", scale: 0.085 });
    label.position.set(0, -12, 0);
    group.add(label);
    return group;
  }

  if (node.type === "project") {
    const core = new THREE.Mesh(new THREE.SphereGeometry(16, 28, 20), new THREE.MeshBasicMaterial({ color: 0x2f6f7a }));
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(22, 22, 16),
      new THREE.MeshBasicMaterial({ color: 0x74b3ab, transparent: true, opacity: 0.22, depthWrite: false })
    );
    group.add(core, shell);
    const label = textSprite(node.label, { color: "#1f4d55", scale: 0.1 });
    label.position.set(0, -28, 0);
    group.add(label);
    return group;
  }

  group.add(new THREE.Mesh(new THREE.SphereGeometry(4, 14, 10), new THREE.MeshBasicMaterial({ color: 0x9fb3bd })));
  return group;
}

function HoverCard({ node, x, y }: { node: RepoNode; x: number; y: number }) {
  const meta = commitMeta(node);
  return (
    <div className="graph-hover-card" style={{ left: x + 16, top: y + 12 }}>
      {meta ? (
        <>
          <strong>{meta.summary}</strong>
          <span>{meta.author} · {meta.shortSha} · +{meta.additions}/-{meta.deletions}</span>
          <span className="hover-meta">
            {meta.conflict ? "存在冲突" : meta.isNew ? "新提交" : "已归档"}
            {meta.affectedModules.length > 0 ? ` · 影响 ${meta.affectedModules.length} 个模块` : " · 未归属模块"}
          </span>
          <small>点击查看该提交处理的问题</small>
        </>
      ) : (
        <>
          <strong>{node.label}</strong>
          <span>{TYPE_LABELS[node.type] ?? node.type}{(node.meta?.owner as string) ? ` · ${node.meta?.owner}` : ""}</span>
          <small>点击查看详情</small>
        </>
      )}
    </div>
  );
}

function CommitDrawer({ node, onClose }: { node: RepoNode; onClose: () => void }) {
  const meta = commitMeta(node);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="repo-drawer" role="dialog" aria-label="提交详情">
      <header>
        <div>
          <h2>{meta ? meta.summary : node.label}</h2>
          <p>{TYPE_LABELS[node.type] ?? node.type}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭" title="关闭">×</button>
      </header>
      <div className="repo-drawer-body">
        {meta ? (
          <>
            <div className="detail-row"><span>提交</span><strong>{meta.shortSha}</strong></div>
            <div className="detail-row"><span>提交人</span><strong>{meta.author}</strong></div>
            <div className="detail-row"><span>提交时间</span><strong>{meta.committedAt ?? "未知"}</strong></div>
            <div className="detail-row"><span>分支</span><strong>{meta.branch ?? "—"}</strong></div>
            <div className="detail-row"><span>变更规模</span><strong>{meta.changedFiles} 文件 · +{meta.additions}/-{meta.deletions}</strong></div>
            {meta.pullNumber && <div className="detail-row"><span>关联 PR</span><strong>!{meta.pullNumber} {meta.pullTitle ?? ""}</strong></div>}
            {meta.issueRefs.length > 0 && <div className="detail-row"><span>需求编号</span><strong>{meta.issueRefs.join("、")}</strong></div>}
            {meta.areas.length > 0 && <div className="detail-row"><span>影响目录</span><strong>{meta.areas.join("、")}</strong></div>}

            <h3>这个提交处理了什么</h3>
            <p className="detail-summary">{meta.summary}</p>
            {meta.kindLabel && <p className="detail-note">类型：{meta.kindLabel}{meta.scope ? `（${meta.scope}）` : ""}{meta.conflict ? " · 触发冲突提醒" : ""}</p>}

            <h3>影响与下一步</h3>
            {meta.affectedModules.length === 0 ? (
              <p className="detail-note">未匹配到模块。补充模块路径模式后可以自动归属。</p>
            ) : (
              <ul className="impact-list">
                {meta.affectedModules.map((module, index) => (
                  <li key={`${module.name}-${index}`}>
                    <div className="impact-head">
                      <strong>{module.name}</strong>
                      <SeverityBadge value={module.severity as Severity} />
                    </div>
                    <span>负责人：{module.owner ?? "未分配"}</span>
                    <span>下一步：{module.nextAction}</span>
                  </li>
                ))}
              </ul>
            )}

            <h3>变更文件</h3>
            <ul className="file-list">
              {(node.meta?.files as Array<{ path: string; additions?: number; deletions?: number }> | undefined)?.slice(0, 40).map((file) => (
                <li key={file.path}><code>{file.path}</code><span>+{file.additions ?? 0}/-{file.deletions ?? 0}</span></li>
              )) ?? null}
            </ul>

            {meta.url && <a className="primary-button drawer-link" href={meta.url} target="_blank" rel="noreferrer">在 Gitee 查看提交</a>}
          </>
        ) : (
          <>
            <div className="detail-row"><span>名称</span><strong>{node.label}</strong></div>
            {(node.meta?.owner as string) && <div className="detail-row"><span>负责人</span><strong>{node.meta?.owner as string}</strong></div>}
            {(node.meta?.status as string) && <div className="detail-row"><span>状态</span><strong>{node.meta?.status as string}</strong></div>}
            {(node.meta?.key as string) && <div className="detail-row"><span>模块 Key</span><strong>{node.meta?.key as string}</strong></div>}
            {(node.meta?.description as string) && <p className="detail-note">{node.meta?.description as string}</p>}
            {Array.isArray(node.meta?.paths) && (node.meta?.paths as string[]).length > 0 && (
              <>
                <h3>路径模式</h3>
                <ul className="file-list">{(node.meta?.paths as string[]).map((path) => <li key={path}><code>{path}</code></li>)}</ul>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
