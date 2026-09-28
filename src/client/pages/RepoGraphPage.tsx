import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import ForceGraph3D, { type ConfigOptions, type ForceGraph3DInstance } from "3d-force-graph";
import * as THREE from "three";
import { AlertTriangle, Boxes, FolderGit2, GitCommitHorizontal, RefreshCw, RotateCcw, Search, Sparkles, Users } from "lucide-react";
import { api } from "../api";
import { EmptyState, Loading, PageHeader, SeverityBadge } from "../components";
import { ownerFillHex, ownerPalette, ownerStrokeHex, UNASSIGNED_OWNER } from "../../shared/ownerColor";
import type { GraphNode, RepoCommitMeta, RepoGraphData, RepoOwnerCluster, Severity } from "../../shared/types";

type RepoNode = GraphNode & { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number };
type RepoLink = { id: string; source: string | RepoNode; target: string | RepoNode; label: string; confidence: string };
type ViewMode = "all" | "new" | "conflict" | "unattributed";

const BACKGROUND = "#fbfcfc";  // 近白底色，浅色系分区才看得出来
const NEW_WINDOW_HOURS = 24;

const SEVERITY_COLORS: Record<string, number> = {
  blocking: 0xc9413b,
  contract: 0xdb8a2b,
  implementation: 0x2f7fa8,
  clarification: 0x7a6cc4,
  informational: 0x3f9c86
};

const DELIVERY_LABELS: Record<string, string> = {
  processed: "已分析完成",
  processing: "分析中",
  rejected: "签名校验失败",
  error: "处理出错"
};

const TYPE_LABELS: Record<string, string> = {
  project: "仓库",
  module: "模块",
  contract: "契约",
  scenario: "场景",
  author: "提交人",
  commit: "提交",
  pull: "PR",
  owner: "负责人"
};

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
  const haloRef = useRef<{ node: RepoNode; ring: THREE.Mesh }[]>([]);
  const frameRef = useRef<number>(0);
  const resizeRef = useRef<(() => void) | null>(null);
  const frameGraphRef = useRef<((duration?: number) => void) | null>(null);

  const [data, setData] = useState<RepoGraphData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ViewMode>("all");
  const [query, setQuery] = useState("");
  const [owners, setOwners] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(40);
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
      const spread = Math.max(...members.map((node) => Math.hypot((node.x ?? 0) - centroid.x, (node.y ?? 0) - centroid.y, (node.z ?? 0) - centroid.z)));
      // 硬上限：成员一旦分散到全场景，半径会涨到几百，气泡互相覆盖会把画面糊成一片白
      const radius = Math.min(80, Math.max(30, spread * 1.12 + 14));
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
  // 刚到达的提交要持续脉冲：引擎停下后仍然动，否则"新提交"没有任何提示
  useEffect(() => {
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const wave = (Math.sin(performance.now() / 320) + 1) / 2;
      for (const { ring } of haloRef.current) {
        ring.scale.setScalar(0.88 + wave * 0.5);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.3 + wave * 0.55;
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    if (!data) return;
    // 146 个模块各自连到仓库中心会变成毛线球。改写成两级：仓库 -> 负责人枢纽 -> 模块，
    // 中心只剩与负责人数量相当的连线，其余连线都落在分区内部。
    const projectId = data.nodes.find((node) => node.type === "project")?.id;
    const hubs = new Map<string, RepoNode>();
    const displayNodes: RepoNode[] = data.nodes.map((node) => ({ ...node }));
    const displayLinks: RepoLink[] = [];
    for (const edge of data.edges) {
      const target = edge.label === "contains" ? data.nodes.find((node) => node.id === edge.target) : undefined;
      if (target?.type === "module") {
        const owner = (target.meta?.owner as string) || UNASSIGNED_OWNER;
        let hub = hubs.get(owner);
        if (!hub) {
          hub = { id: `owner:${owner}`, label: owner, type: "owner", meta: { owner, modules: 0 } };
          hubs.set(owner, hub);
          displayNodes.push(hub);
          if (projectId) displayLinks.push({ id: `hub-${owner}`, source: projectId, target: hub.id, label: "owns", confidence: "manual" });
        }
        hub.meta!.modules = Number(hub.meta?.modules ?? 0) + 1;
        displayLinks.push({ id: `${edge.id}-hub`, source: hub.id, target: edge.target, label: "contains", confidence: edge.confidence });
        continue;
      }
      displayLinks.push({ ...edge } as RepoLink);
    }
    nodesRef.current = displayNodes;
    linksRef.current = displayLinks;

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
        .cooldownTicks(220)
        .warmupTicks(70)
        .linkColor((link) => {
          const label = (link as RepoLink).label;
          if (label === "blocking") return "rgba(201,65,59,0.7)";
          if (label === "contract") return "rgba(219,138,43,0.62)";
          if (label === "implementation") return "rgba(47,127,168,0.5)";
          if (label === "unattributed") return "rgba(150,166,176,0.22)";
          if (label === "authored") return "rgba(120,140,150,0.28)";
          if (label === "owns") return "rgba(120,145,155,0.3)";
          return "rgba(150,170,180,0.2)";
        })
        .linkWidth((link) => {
        const label = (link as RepoLink).label;
        if (label === "blocking") return 1.6;
        if (label === "owns") return 0.9;
        return 0.45;
      })
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
        .onEngineStop(() => frameGraphRef.current?.(700));

      // 结构化布局：先按锚点摆好初值再让锚点力接管，避免被力导向甩成蛛网
      const anchors = computeAnchors(nodesRef.current);
      for (const node of nodesRef.current) {
        const anchor = anchors.get(node.id);
        if (!anchor) continue;
        node.x = anchor.x;
        node.y = anchor.y;
        node.z = anchor.z;
      }
      graph.d3Force("anchor", makeAnchorForce(nodesRef.current, anchors, 0.9) as never);

      const charge = graph.d3Force("charge");
      if (charge && "strength" in charge) {
        // 只剩把同一分区内的节点推开一点的作用
        (charge as unknown as { strength: (value: number) => void }).strength(-22);
      }

      const linkForce = graph.d3Force("link") as unknown as { distance?: (value: number) => void; strength?: (value: number) => void } | undefined;
      linkForce?.distance?.(26);
      linkForce?.strength?.(0.2);

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
        new THREE.SphereGeometry(1, 20, 14),
        new THREE.MeshBasicMaterial({ color: ownerFillHex(cluster.owner), transparent: true, opacity: 0.17, depthWrite: false })
      );
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 7),
        new THREE.MeshBasicMaterial({ color: ownerStrokeHex(cluster.owner), transparent: true, opacity: 0.14, wireframe: true, depthWrite: false })
      );
      const label = textSprite(`${cluster.owner} · ${cluster.moduleNames.length}`, { color: palette.text, scale: 0.095 });
      // 负责人很多时标签互相压住，超过 12 个分区就只靠右侧图例区分
      if (data.clusters.length > 12) label.visible = false;
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
    // cooldownTicks 会先掐断 tick 循环，d3 的 end 事件不一定触发，所以这里主动取景
    frameGraphRef.current?.(700);
  }, [data, updateClusterPositions]);

  // 卸载时释放 WebGL 资源与监听
  useEffect(() => () => {
    if (resizeRef.current) window.removeEventListener("resize", resizeRef.current);
    cancelAnimationFrame(frameRef.current);
    graphRef.current?._destructor?.();
    graphRef.current = null;
  }, []);

  /** 按节点实际分布算相机距离：库的 zoomToFit 会把装饰对象算进包围盒，结果图只占画布三分之一 */
  const frameGraph = useCallback((duration = 700) => {
    const graph = graphRef.current;
    if (!graph) return;
    const nodes = nodesRef.current.filter((node) => node.x !== undefined);
    if (!nodes.length) return;
    const camera = graph.camera() as THREE.PerspectiveCamera;
    // 加上分区气泡半径，否则球会被画布边缘切掉
    const radius = Math.max(...nodes.map((node) => Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0))) + 80;
    const height = graph.height() || 600;
    const width = graph.width() || 900;

    // 先用包围球粗算距离，再按实际投影尺寸修正一次：节点在球内的分布不均，
    // 只按半径算会让画面只填到一半。
    let distance = (radius * 1.18) / Math.tan(((camera.fov || 50) * Math.PI) / 360);
    const place = (value: number, ms: number) => {
      graph.cameraPosition({ x: value * 0.22, y: value * 0.18, z: value * 0.95 }, { x: 0, y: 0, z: 0 }, ms);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
    };
    // 迭代两次：投影尺寸与距离并非严格线性，一次修正通常还差一截
    for (let pass = 0; pass < 2; pass += 1) {
      place(distance, 0);
      const points = nodes.map((node) => graph.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0));
      const spanY = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
      const spanX = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
      const overflow = Math.max(spanY / (height * 0.82), spanX / (width * 0.84));
      if (!Number.isFinite(overflow) || overflow <= 0.02) break;
      distance *= overflow;
    }
    place(distance, duration);
  }, []);

  frameGraphRef.current = frameGraph;

  const resetView = () => frameGraph(700);

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
            <div className="panel-header"><div><h2>负责人分区</h2><p>点选可按负责人过滤；数字是模块数。</p></div></div>
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
            <div className="panel-header"><div><h2>接入状态</h2><p>WebHook 是实时分析的唯一入口。</p></div></div>
            <div className="repo-stat-list">
              <div><span>最近收到事件</span><strong>{stats.lastDeliveryAt ?? "尚未收到"}</strong></div>
              <div><span>处理结果</span><strong>{DELIVERY_LABELS[stats.lastDeliveryStatus ?? ""] ?? stats.lastDeliveryStatus ?? "—"}</strong></div>
              <div><span>最新提交时间</span><strong>{stats.latestCommitAt ?? "—"}</strong></div>
              <div><span>冲突提交</span><strong className={stats.conflicts > 0 ? "warn" : ""}>{stats.conflicts} / {stats.totalCommits}</strong></div>
              <div><span>未归属提交</span><strong className={stats.unattributedCommits > 0 ? "warn" : ""}>{stats.unattributedCommits}</strong></div>
              <div><span>图形生成时间</span><strong>{new Date(stats.generatedAt).toLocaleTimeString()}</strong></div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><div><h2>图例</h2><p>按类型区分节点。</p></div></div>
            <div className="legend">
              {Object.entries(TYPE_LABELS).filter(([type]) => type !== "scenario").map(([type, label]) => (
                <div key={type} className={`legend-item legend-${type}`}><i /><span>{label}</span></div>
              ))}
              <div className="legend-item legend-new"><i /><span>30 分钟内到达（爆发光圈）</span></div>
              <div className="legend-item legend-conflict"><i /><span>冲突提交（红色描边 + 流动粒子）</span></div>
            </div>
          </div>
        </aside>
      </section>

      {selected && <CommitDrawer node={selected} onClose={() => setSelected(null)} />}
    </>
  );
}


/** 确定性抖动：同一节点每次渲染落在同一位置，避免布局在不同会话间跳变 */
function jitter(seed: string, index: number, spread: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100003;
  const angle = (hash % 360) * (Math.PI / 180) + index * 1.7;
  return { x: Math.cos(angle) * spread, y: Math.sin(angle * 1.3) * spread, z: Math.sin(angle) * spread };
}

/**
 * 纯力导向在上百个节点时会发散成蛛网，体现不出"谁负责哪一块"。
 * 这里给每个节点算一个锚点：负责人分布在球面上，其模块聚在本人的区域内，
 * 提交贴近它影响的模块，未归属的靠近内圈；再由一个自定义力把节点拉向锚点。
 */
function computeAnchors(nodes: RepoNode[]) {
  const anchors = new Map<string, { x: number; y: number; z: number }>();
  const byOwner = new Map<string, RepoNode[]>();
  for (const node of nodes) {
    if (node.type !== "module") continue;
    const owner = (node.meta?.owner as string) || UNASSIGNED_OWNER;
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), node]);
  }

  const owners = [...byOwner.keys()];
  const radius = 165 + Math.min(owners.length, 18) * 9;
  const ownerAnchor = new Map<string, { x: number; y: number; z: number }>();
  owners.forEach((owner, index) => {
    // 黄金角球面分布，任意视角下各分区都不会挤在一起
    const phi = Math.acos(1 - (2 * (index + 0.5)) / owners.length);
    const theta = Math.PI * (1 + Math.sqrt(5)) * (index + 0.5);
    ownerAnchor.set(owner, {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.cos(phi) * 0.86,
      z: radius * Math.sin(phi) * Math.sin(theta)
    });
  });

  for (const [owner, modules] of byOwner) {
    const base = ownerAnchor.get(owner)!;
    const inner = 22 + Math.min(modules.length, 30) * 1.1;
    modules.forEach((module, index) => {
      const offset = jitter(module.id, index, inner);
      anchors.set(module.id, { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z });
    });
  }

  for (const node of nodes) {
    if (anchors.has(node.id)) continue;
    if (node.type === "owner") {
      const base = ownerAnchor.get((node.meta?.owner as string) || UNASSIGNED_OWNER);
      if (base) anchors.set(node.id, base);
      continue;
    }
    if (node.type === "project") {
      anchors.set(node.id, { x: 0, y: 0, z: 0 });
      continue;
    }
    if (node.type === "commit") {
      const affected = commitMeta(node)?.affectedModules ?? [];
      const owner = affected[0]?.owner || UNASSIGNED_OWNER;
      const base = ownerAnchor.get(owner);
      if (base) {
        anchors.set(node.id, { x: base.x * 0.86, y: base.y * 0.86 - 20, z: base.z * 0.86 });
        continue;
      }
    }
    anchors.set(node.id, jitter(node.id, 0, 55));
  }
  return anchors;
}

/** d3-force 自定义力：把节点拉向锚点，强度随 alpha 衰减 */
function makeAnchorForce(nodes: RepoNode[], anchors: Map<string, { x: number; y: number; z: number }>, strength: number) {
  return (alpha: number) => {
    for (const node of nodes) {
      const anchor = anchors.get(node.id);
      if (!anchor) continue;
      const k = strength * alpha;
      node.vx = (node.vx ?? 0) + (anchor.x - (node.x ?? 0)) * k;
      node.vy = (node.vy ?? 0) + (anchor.y - (node.y ?? 0)) * k;
      node.vz = (node.vz ?? 0) + (anchor.z - (node.z ?? 0)) * k;
    }
  };
}

function buildNodeObject(node: RepoNode, haloRef: MutableRefObject<{ node: RepoNode; ring: THREE.Mesh }[]>) {
  const group = new THREE.Group();
  const meta = commitMeta(node);

  if (node.type === "commit" && meta) {
    const color = commitColor(meta);
    const volume = Math.min(meta.additions + meta.deletions, 600);
    const radius = meta.conflict ? 8 : 5.5 + Math.sqrt(volume) * 0.16;
    group.add(new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), new THREE.MeshBasicMaterial({ color })));

    if (meta.justArrived) {
      // 刚到达：同色描边环做脉冲。浅色背景上不能用加色发光，否则会糊成一个白圆
      const ring = new THREE.Mesh(
        new THREE.OctahedronGeometry(radius * 2, 0),
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.7, depthWrite: false })
      );
      group.add(ring);
      haloRef.current.push({ node, ring });
    } else if (meta.isNew) {
      group.add(new THREE.Mesh(
        new THREE.OctahedronGeometry(radius * 1.55, 0),
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.34, depthWrite: false })
      ));
    }
    if (meta.conflict) {
      group.add(new THREE.Mesh(
        new THREE.OctahedronGeometry(radius * 1.4, 0),
        new THREE.MeshBasicMaterial({ color: 0xc9413b, wireframe: true, transparent: true, opacity: 0.85, depthWrite: false })
      ));
    }
    return group;
  }

  if (node.type === "owner") {
    const palette = ownerPalette((node.meta?.owner as string) ?? node.label);
    const owner = (node.meta?.owner as string) ?? node.label;
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(11, 20, 14),
      new THREE.MeshBasicMaterial({ color: ownerStrokeHex(owner) })
    ));
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(16, 16, 12),
      new THREE.MeshBasicMaterial({ color: ownerFillHex(owner), transparent: true, opacity: 0.45, depthWrite: false })
    ));
    const label = textSprite(`${node.label} · ${Number(node.meta?.modules ?? 0)}`, { color: palette.text, scale: 0.1 });
    label.position.set(0, -21, 0);
    group.add(label);
    return group;
  }

  if (node.type === "module") {
    const owner = (node.meta?.owner as string) ?? null;
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(8, 16, 12),
      new THREE.MeshBasicMaterial({ color: ownerStrokeHex(owner) })
    ));
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(12.5, 14, 10),
      new THREE.MeshBasicMaterial({ color: ownerFillHex(owner), transparent: true, opacity: 0.42, depthWrite: false })
    ));
    // 不渲染逐模块文字：100+ 个精灵会压满画面，也会把 zoomToFit 的包围盒撑大导致镜头过远
    return group;
  }

  if (node.type === "author") {
    group.add(new THREE.Mesh(new THREE.SphereGeometry(4.4, 14, 10), new THREE.MeshBasicMaterial({ color: 0x7d95a1 })));
    return group;
  }

  if (node.type === "pull") {
    group.add(new THREE.Mesh(new THREE.BoxGeometry(9, 9, 9), new THREE.MeshBasicMaterial({ color: 0x7d6bb0 })));
    const label = textSprite(`PR ${node.label}`, { color: "#4b3f75", scale: 0.08 });
    label.position.set(0, -9, 0);
    group.add(label);
    return group;
  }

  if (node.type === "project") {
    group.add(new THREE.Mesh(new THREE.SphereGeometry(15, 24, 18), new THREE.MeshBasicMaterial({ color: 0x2f6f7a })));
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(21, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x74b3ab, transparent: true, opacity: 0.24, depthWrite: false })
    ));
    const label = textSprite(node.label, { color: "#1f4d55", scale: 0.1 });
    label.position.set(0, -26, 0);
    group.add(label);
    return group;
  }

  group.add(new THREE.Mesh(new THREE.SphereGeometry(3, 12, 9), new THREE.MeshBasicMaterial({ color: 0x9fb3bd })));
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
