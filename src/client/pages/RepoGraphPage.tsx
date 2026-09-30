import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import ForceGraph3D, { type ConfigOptions, type ForceGraph3DInstance } from "3d-force-graph";
import * as THREE from "three";
import {
  AlertTriangle, Boxes, ChevronRight, FolderGit2, GitCommitHorizontal, Maximize2, Minimize2,
  Minus, Plus, RefreshCw, RotateCcw, Search, Sparkles, Users
} from "lucide-react";
import { api } from "../api";
import { EmptyState, Loading, PageHeader, SeverityBadge } from "../components";
import { LabelLayer, type LabelItem } from "../repo/labelLayer";
import { ownerFillHex, ownerPalette, ownerStrokeHex, UNASSIGNED_OWNER } from "../../shared/ownerColor";
import type { GraphNode, RepoCommitMeta, RepoGraphData, RepoOwnerCluster, Severity } from "../../shared/types";

type RepoNode = GraphNode & { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number };
type RepoLink = { id: string; source: string | RepoNode; target: string | RepoNode; label: string; confidence: string };
type ViewMode = "all" | "new" | "conflict" | "unattributed";
type FocusLevel =
  | { kind: "overview" }
  | { kind: "owner"; owner: string }
  | { kind: "module"; id: number; name: string };

const BACKGROUND = "#fbfcfc";  // 近白底色，浅色系分区才看得出来
const SEEN_KEY = "giteehelper:repo:lastSeen";
const REFRESH_MS = 60_000;

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
  owner: "负责人",
  module: "模块",
  contract: "契约",
  scenario: "场景",
  author: "提交人",
  commit: "提交",
  pull: "PR"
};

function commitMeta(node: RepoNode): RepoCommitMeta | undefined {
  return node.type === "commit" ? (node.meta as unknown as RepoCommitMeta) : undefined;
}

function commitColor(meta: RepoCommitMeta) {
  if (meta.conflict) return SEVERITY_COLORS[meta.severity ?? "blocking"] ?? SEVERITY_COLORS.blocking;
  return SEVERITY_COLORS[meta.severity ?? "informational"] ?? SEVERITY_COLORS.informational;
}

function ownerOfCommit(meta: RepoCommitMeta) {
  return meta.affectedModules?.[0]?.owner || UNASSIGNED_OWNER;
}

function timeAgo(value: string | null | undefined) {
  if (!value) return "—";
  const stamp = parseDbTime(value);
  if (!stamp) return value;
  const minutes = Math.round((Date.now() - stamp) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`;
  return `${Math.round(minutes / 1440)} 天前`;
}

/** SQLite 的 datetime('now') 是无时区 UTC 串，直接 Date.parse 会按本地时区解读，未读计数会差出几个小时 */
function parseDbTime(value: string | null | undefined) {
  if (!value) return 0;
  const stamp = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(stamp) ? stamp : 0;
}

export default function RepoGraphPage({ user }: { user: { role: string } }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const nodesRef = useRef<RepoNode[]>([]);
  const linksRef = useRef<RepoLink[]>([]);
  const clusterRef = useRef<{ cluster: RepoOwnerCluster; mesh: THREE.Mesh; ring: THREE.Mesh }[]>([]);
  const haloRef = useRef<{ node: RepoNode; ring: THREE.Mesh }[]>([]);
  const nodeObjectsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const burstRef = useRef<Array<{ object: THREE.Object3D; ring: THREE.Mesh; born: number }>>([]);
  const labelLayerRef = useRef<LabelLayer | null>(null);
  const frameGraphRef = useRef<((duration?: number, scope?: RepoNode[]) => void) | null>(null);
  const focusRef = useRef<FocusLevel>({ kind: "overview" });
  const graphRadiusRef = useRef(300);
  const anchorsRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());
  /** 力学引擎当前使用的锚点：全景时等于 anchorsRef，聚焦展开时换成展开圆盘 */
  const activeAnchorsRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());
  const resizeRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number>(0);
  const knownCommitsRef = useRef<Set<string>>(new Set());
  const didFrameRef = useRef(false);

  const [data, setData] = useState<RepoGraphData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ViewMode>("all");
  const [query, setQuery] = useState("");
  const [owners, setOwners] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(40);
  const [hovered, setHovered] = useState<{ node: RepoNode; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<RepoNode | null>(null);
  const [focus, setFocus] = useState<FocusLevel>({ kind: "overview" });
  const [fullscreen, setFullscreen] = useState(false);
  const [lastSeen, setLastSeen] = useState(() => Number(localStorage.getItem(SEEN_KEY) ?? 0));
  const [burstIds, setBurstIds] = useState<string[]>([]);

  focusRef.current = focus;

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

  // 「补齐提交」必须真的调同步接口：只刷新图数据时，没有公网回调的时段永远等不到新提交
  const syncCommits = useCallback(async () => {
    setBusy(true);
    try {
      await api("/gitee/sync", { method: "POST", body: JSON.stringify({ only: "commits" }) });
      await load(limit);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [load, limit]);

  useEffect(() => { void load(limit); }, [limit, load]);

  // 自动刷新：WebHook 是实时入口，页面也要自己把新提交拉进来，"新提交提示"才有意义
  useEffect(() => {
    const timer = window.setInterval(() => { void load(limit); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [limit, load]);

  const regions = useMemo(() => {
    const map = new Map<string, { owner: string; modules: RepoNode[]; commits: RepoNode[]; unread: number; conflicts: number }>();
    const ensure = (owner: string) => {
      if (!map.has(owner)) map.set(owner, { owner, modules: [], commits: [], unread: 0, conflicts: 0 });
      return map.get(owner)!;
    };
    for (const node of data?.nodes ?? []) {
      if (node.type === "module") ensure((node.meta?.owner as string) || UNASSIGNED_OWNER).modules.push(node as RepoNode);
    }
    for (const node of data?.nodes ?? []) {
      const meta = commitMeta(node as RepoNode);
      if (!meta) continue;
      const region = ensure(ownerOfCommit(meta));
      region.commits.push(node as RepoNode);
      if (meta.conflict) region.conflicts += 1;
      if (parseDbTime(meta.receivedAt) > lastSeen) region.unread += 1;
    }
    return [...map.values()].sort((a, b) => b.modules.length - a.modules.length);
  }, [data, lastSeen]);

  const unreadCommits = useMemo(() => {
    return (data?.nodes ?? [])
      .map((node) => node as RepoNode)
      .filter((node) => {
        const meta = commitMeta(node);
        return meta ? parseDbTime(meta.receivedAt) > lastSeen : false;
      })
      .sort((a, b) => parseDbTime(commitMeta(b)!.receivedAt) - parseDbTime(commitMeta(a)!.receivedAt));
  }, [data, lastSeen]);

  // ---- 可见子集（只算 id，对象复用，过滤时不重跑布局）----
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    const keyword = query.trim().toLowerCase();
    for (const node of data?.nodes ?? []) {
      const meta = commitMeta(node as RepoNode);
      if (mode === "new" && !(node.type === "project" || node.type === "owner" || (meta && (meta.isNew || meta.justArrived)))) continue;
      if (mode === "conflict" && !(node.type === "project" || node.type === "owner" || node.type === "module" || (meta?.conflict ?? false))) continue;
      if (mode === "unattributed" && !(node.type === "project" || node.type === "owner" || (meta && meta.affectedModules.length === 0))) continue;
      if (owners.size > 0 && node.type === "module" && !owners.has((node.meta?.owner as string) ?? "")) continue;
      if (keyword) {
        const haystack = `${node.label} ${node.type} ${meta?.summary ?? ""} ${meta?.author ?? ""} ${(node.meta?.owner as string) ?? ""}`.toLowerCase();
        if (!haystack.includes(keyword)) continue;
      }
      ids.add(node.id);
    }
    return ids;
  }, [data, mode, owners, query]);

  // ---- 相机 ----
  /**
   * 取景。scope 为空表示全景；传具体节点集合时按该集合的包围范围取景。
   * 不能用"距锚点多远"来猜范围——邻近区域会被卷进来，镜头过远会让标签全部重叠。
   */
  const frameGraph = useCallback((duration = 700, scope?: RepoNode[]) => {
    const graph = graphRef.current;
    if (!graph) return;
    const all = nodesRef.current.filter((node) => node.x !== undefined);
    if (!all.length) return;
    const camera = graph.camera() as THREE.PerspectiveCamera;
    const height = graph.height() || 600;
    const width = graph.width() || 900;
    const focusNodes = scope && scope.length ? scope.filter((node) => node.x !== undefined) : all;

    const centroid = focusNodes.reduce(
      (accumulator, node) => ({ x: accumulator.x + (node.x ?? 0), y: accumulator.y + (node.y ?? 0), z: accumulator.z + (node.z ?? 0) }),
      { x: 0, y: 0, z: 0 }
    );
    centroid.x /= focusNodes.length;
    centroid.y /= focusNodes.length;
    centroid.z /= focusNodes.length;
    const center = new THREE.Vector3(centroid.x, centroid.y, centroid.z);

    let radius: number;
    if (scope && scope.length) {
      radius = Math.max(60, Math.max(...focusNodes.map((node) => new THREE.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0).distanceTo(center))) + 40);
    } else {
      radius = Math.max(...all.map((node) => Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0))) + 80;
      graphRadiusRef.current = radius;
    }

    const halfFov = ((camera.fov || 50) * Math.PI) / 360;
    let distance = (radius * 1.2) / Math.tan(halfFov);
    const place = (value: number, ms: number) => {
      // 方向取自范围中心：中心离原点足够远时从外部看进去，否则用固定的舒适视角。
      // 阈值不能太小，否则中心附近的一点点偏移就会决定整个视角。
      const outward = center.lengthSq() > 4000
        ? center.clone().normalize()
        : new THREE.Vector3(0.22, 0.18, 1).normalize();
      const position = center.clone().add(outward.multiplyScalar(value));
      position.y += value * 0.14;
      graph.cameraPosition({ x: position.x, y: position.y, z: position.z }, { x: center.x, y: center.y, z: center.z }, ms);
      // graph2ScreenCoords 依赖 matrixWorldInverse，只调 updateMatrixWorld 会量到上一帧的投影
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.updateProjectionMatrix();
    };

    for (let pass = 0; pass < 2; pass += 1) {
      place(distance, 0);
      const points = focusNodes.map((node) => graph.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0));
      const spanY = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
      const spanX = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
      const overflow = Math.max(spanY / (height * (scope && scope.length ? 0.94 : 0.78)), spanX / (width * 0.86));
      if (!Number.isFinite(overflow) || overflow <= 0.02) break;
      distance *= overflow;
    }
    place(distance, duration);
  }, []);

  frameGraphRef.current = frameGraph;

  /**
   * 锚点力必须读 ref 而不是闭包捕获的数组：自动刷新会重建节点对象数组，
   * 捕获旧数组会让锚点力只作用于已废弃的对象，布局随刷新逐渐散架。
   */
  const anchorForce = useCallback((alpha: number) => {
    const anchors = activeAnchorsRef.current;
    for (const node of nodesRef.current) {
      const anchor = anchors.get(node.id);
      if (!anchor) continue;
      const k = 0.9 * alpha;
      node.vx = (node.vx ?? 0) + (anchor.x - (node.x ?? 0)) * k;
      node.vy = (node.vy ?? 0) + (anchor.y - (node.y ?? 0)) * k;
      node.vz = (node.vz ?? 0) + (anchor.z - (node.z ?? 0)) * k;
    }
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const graph = graphRef.current;
    if (!graph) return;
    const camera = graph.camera() as THREE.PerspectiveCamera;
    const distance = camera.position.length() || graphRadiusRef.current;
    const next = Math.min(graphRadiusRef.current * 5, Math.max(graphRadiusRef.current * 0.16, distance * factor));
    const scale = next / distance;
    graph.cameraPosition(
      { x: camera.position.x * scale, y: camera.position.y * scale, z: camera.position.z * scale },
      { x: 0, y: 0, z: 0 },
      220
    );
  }, []);

  const scopeOfOwner = useCallback((owner: string) => {
    return nodesRef.current.filter((node) => {
      if (node.type === "owner") return ((node.meta?.owner as string) || UNASSIGNED_OWNER) === owner;
      if (node.type === "module") return ((node.meta?.owner as string) || UNASSIGNED_OWNER) === owner;
      const meta = commitMeta(node);
      return meta ? ownerOfCommit(meta) === owner : false;
    });
  }, []);

  const focusOwner = useCallback((owner: string) => {
    setFocus({ kind: "owner", owner });
    setSelected(null);
  }, []);

  const scopeOfModule = useCallback((id: number) => {
    return nodesRef.current.filter((node) => {
      if (node.id === `module:${id}`) return true;
      const meta = commitMeta(node);
      return meta ? meta.affectedModules.some((module) => module.id === id) : false;
    });
  }, []);

  const focusModule = useCallback((id: number, name: string) => {
    setFocus({ kind: "module", id, name });
    setSelected(null);
  }, []);

  const backToOverview = useCallback(() => {
    setFocus({ kind: "overview" });
    setSelected(null);
    frameGraphRef.current?.(900);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const element = wrapRef.current;
    if (!element) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    else await element.requestFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      window.setTimeout(() => {
        const element = containerRef.current;
        const graph = graphRef.current;
        if (element && graph) graph.width(element.clientWidth).height(element.clientHeight);
        frameGraphRef.current?.(400);
      }, 240);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 输入框里打 "C++"、"e-2" 不能触发缩放，Esc 也不能把聚焦层级退掉
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (event.key === "Escape" && focusRef.current.kind !== "overview" && !document.fullscreenElement) backToOverview();
      if (event.key === "+" || event.key === "=") zoomBy(0.8);
      if (event.key === "-") zoomBy(1.25);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backToOverview, zoomBy]);

  // ---- 数据装载：改写两级结构并建场景 ----
  useEffect(() => {
    if (!data) return;
    const projectId = data.nodes.find((node) => node.type === "project")?.id;
    const hubs = new Map<string, RepoNode>();
    // 复用上一次的节点对象：力学引擎累计的位置与速度都在对象上，
    // 整体重建会让 60 秒一次的自动刷新把布局打散（对象换了，锚点与速度全部归零）
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    const displayNodes: RepoNode[] = data.nodes.map((node) => {
      const reused = previous.get(node.id);
      if (!reused) return { ...node };
      Object.assign(reused, node);
      return reused;
    });
    const displayLinks: RepoLink[] = [];
    for (const edge of data.edges) {
      const target = edge.label === "contains" ? data.nodes.find((node) => node.id === edge.target) : undefined;
      if (target?.type === "module") {
        const owner = (target.meta?.owner as string) || UNASSIGNED_OWNER;
        let hub = hubs.get(owner);
        if (!hub) {
          const hubId = `owner:${owner}`;
          const reused = previous.get(hubId);
          hub = reused ?? { id: hubId, label: owner, type: "owner", meta: { owner, modules: 0 } };
          hub.label = owner;
          hub.meta = { owner, modules: 0 };
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

    // 锚点是确定性的，只补新出现的节点；已有节点保留原锚点，力学目标不漂移
    for (const [id, anchor] of computeAnchors(nodesRef.current)) {
      if (!anchorsRef.current.has(id)) anchorsRef.current.set(id, anchor);
    }
    if (activeAnchorsRef.current.size === 0) activeAnchorsRef.current = anchorsRef.current;
    for (const node of nodesRef.current) {
      if (node.x !== undefined) continue;
      const anchor = anchorsRef.current.get(node.id);
      if (!anchor) continue;
      node.x = anchor.x;
      node.y = anchor.y;
      node.z = anchor.z;
    }

    let graph = graphRef.current;
    if (!graph && containerRef.current) {
      try {
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
        .cooldownTicks(420)  // 必须让 alpha 衰减到阈值，否则 d3 的 end 事件不触发，onEngineStop 永远不会调用
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
        .linkDirectionalParticleColor((link) => ((link as RepoLink).label === "blocking" ? "#c9413b" : "#db8a2b"))
        .nodeThreeObject((node) => buildNodeObject(node as RepoNode, haloRef, nodeObjectsRef.current))
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
        .onNodeClick((node) => {
          const target = node as RepoNode;
          if (target.type === "owner") focusOwner((target.meta?.owner as string) || target.label);
          else if (target.type === "module") focusModule(Number(target.id.slice(7)), target.label);
          else setSelected(target);
        })
        .onBackgroundClick(() => {
          setSelected(null);
          if (focusRef.current.kind !== "overview") backToOverview();
        })
        .onEngineStop(() => {
          // 力学收敛后布局才定型：只在此时取景，才能得到准确的构图
          const current = focusRef.current;
          const scope = current.kind === "overview"
            ? undefined
            : current.kind === "owner" ? scopeOfOwner(current.owner) : scopeOfModule(current.id);
          frameGraphRef.current?.(500, scope);
        });

      graph.d3Force("anchor", anchorForce as never);

      const charge = graph.d3Force("charge");
      if (charge && "strength" in charge) (charge as unknown as { strength: (value: number) => void }).strength(-22);
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

      if (!labelLayerRef.current && wrapRef.current) labelLayerRef.current = new LabelLayer(wrapRef.current);
    }
    if (!graph) return;

    haloRef.current = [];
    nodeObjectsRef.current.clear();
    for (const item of clusterRef.current) {
      graph.scene().remove(item.mesh, item.ring);
      item.mesh.geometry.dispose();
      item.ring.geometry.dispose();
      (item.mesh.material as THREE.Material).dispose();
      (item.ring.material as THREE.Material).dispose();
    }
    clusterRef.current = [];
    for (const cluster of data.clusters) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 14),
        new THREE.MeshBasicMaterial({ color: ownerFillHex(cluster.owner), transparent: true, opacity: 0.17, depthWrite: false })
      );
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 7),
        new THREE.MeshBasicMaterial({ color: ownerStrokeHex(cluster.owner), transparent: true, opacity: 0.14, wireframe: true, depthWrite: false })
      );
      for (const object of [mesh, ring]) {
        object.raycast = () => {};
        object.userData.__graphObjType = "cluster";
        Object.defineProperty(object, "__graphObjType", { value: "cluster", enumerable: false });
      }
      graph.scene().add(mesh, ring);
      clusterRef.current.push({ cluster, mesh, ring });
    }

    graph.graphData({ nodes: nodesRef.current, links: linksRef.current });
    updateClusterPositions();
    if (!didFrameRef.current) {
      didFrameRef.current = true;
      frameGraphRef.current?.(700);
    }

    // 本次刷新才出现的提交做一次爆发动画
    const arrived: string[] = [];
    for (const node of nodesRef.current) {
      if (node.type !== "commit") continue;
      if (!knownCommitsRef.current.has(node.id) && knownCommitsRef.current.size > 0) arrived.push(node.id);
      knownCommitsRef.current.add(node.id);
    }
    if (arrived.length) {
      setBurstIds(arrived);
      window.setTimeout(() => setBurstIds([]), 4000);
    }
  }, [data, backToOverview, focusModule, focusOwner, scopeOfModule, scopeOfOwner]);

  /**
   * 聚焦展开：进入某区域时把该区域的模块重排成一张"圆盘"（黄金角螺旋），
   * 提交排在它前方的一个平行面上；返回全景时收回原锚点。
   *
   * 为什么不是"撑开再放大"：撑开后镜头同样会按范围拉远，屏幕上占的面积不变，
   * 标签依旧重叠。排成平面螺旋则保证投影上互不遮挡，标签才有地方放。
   */
  useEffect(() => {
    const graph = graphRef.current;
    const base = anchorsRef.current;
    if (!graph || !base.size) return;
    const expanded = new Map(base);
    if (focus.kind !== "overview") {
      const owner = focus.kind === "owner"
        ? focus.owner
        : ((nodesRef.current.find((node) => node.id === `module:${focus.id}`)?.meta?.owner as string | undefined) || UNASSIGNED_OWNER);
      const hub = base.get(`owner:${owner}`);
      if (hub) {
        const mine = nodesRef.current.filter((node) => {
          if (node.type === "module") return ((node.meta?.owner as string) || UNASSIGNED_OWNER) === owner;
          const meta = commitMeta(node);
          return meta ? ownerOfCommit(meta) === owner : false;
        });
        // 模块与提交共用同一张圆盘：提交另起更大的环会把取景范围撑大，反而压缩模块标签的空间
        const ordered = [...mine.filter((node) => node.type === "module"), ...mine.filter((node) => node.type === "commit")];
        const discRadius = 95 + ordered.length * 6;
        const GOLDEN = 2.399963;
        ordered.forEach((node, index) => {
          const angle = index * GOLDEN;
          const radius = discRadius * Math.sqrt((index + 0.55) / Math.max(ordered.length, 1));
          expanded.set(node.id, {
            x: hub.x + Math.cos(angle) * radius,
            y: hub.y + Math.sin(angle) * radius,
            z: hub.z + (node.type === "commit" ? 26 : 0)
          });
        });
      }
    }
    graph.d3Force("anchor", anchorForce as never);
    activeAnchorsRef.current = expanded;
    graph.d3ReheatSimulation?.();
    const scope = focus.kind === "overview"
      ? undefined
      : focus.kind === "owner" ? scopeOfOwner(focus.owner) : scopeOfModule(focus.id);
    const timer = window.setTimeout(() => frameGraphRef.current?.(900, scope), 320);
    return () => window.clearTimeout(timer);
  }, [focus, scopeOfModule, scopeOfOwner]);

  // ---- 聚焦：淡出非当前范围的对象 ----
  useEffect(() => {
    if (!graphRef.current) return;
    const keep = new Set<string>();
    if (focus.kind === "owner") {
      for (const node of nodesRef.current) {
        if (node.type === "owner" && ((node.meta?.owner as string) || UNASSIGNED_OWNER) === focus.owner) keep.add(node.id);
        if (node.type === "module" && ((node.meta?.owner as string) || UNASSIGNED_OWNER) === focus.owner) keep.add(node.id);
        const meta = commitMeta(node);
        if (meta && ownerOfCommit(meta) === focus.owner) keep.add(node.id);
      }
    } else if (focus.kind === "module") {
      keep.add(`module:${focus.id}`);
      for (const node of nodesRef.current) {
        const meta = commitMeta(node);
        if (meta?.affectedModules.some((module) => module.id === focus.id)) keep.add(node.id);
      }
    }
    for (const [id, object] of nodeObjectsRef.current) {
      setObjectOpacity(object, focus.kind === "overview" || keep.has(id) ? 1 : 0.1);
    }
    for (const item of clusterRef.current) {
      const active = focus.kind !== "owner" || item.cluster.owner === focus.owner;
      (item.mesh.material as THREE.MeshBasicMaterial).opacity = active ? 0.17 : 0.04;
      (item.ring.material as THREE.MeshBasicMaterial).opacity = active ? 0.14 : 0.03;
    }
  }, [focus, data]);

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
      const radius = Math.min(105, Math.max(30, spread * 1.12 + 16));
      item.mesh.position.set(centroid.x, centroid.y, centroid.z);
      item.ring.position.copy(item.mesh.position);
      item.mesh.scale.setScalar(radius);
      item.ring.scale.setScalar(radius * 1.03);
    }
  }, []);

  // ---- 标签层：分区常驻标题 + 按层级展开模块/提交 ----
  const labelItems = useMemo<LabelItem[]>(() => {
    if (!data) return [];
    const items: LabelItem[] = [];
    const positionOf = (id: string) => () => {
      const node = nodesRef.current.find((item) => item.id === id);
      return node && node.x !== undefined ? { x: node.x, y: node.y ?? 0, z: node.z ?? 0 } : null;
    };

    for (const region of regions) {
      items.push({
        id: `label-owner:${region.owner}`,
        world: positionOf(`owner:${region.owner}`),
        priority: focus.kind === "owner" && focus.owner === region.owner ? 120 : 100,
        offsetY: -26,
        enabled: () => focusRef.current.kind !== "module",
        element: labelElement(`owner:${region.owner}`, () => {
          const palette = ownerPalette(region.owner);
          return `<i style="background:${palette.stroke}"></i>`
            + `<b style="color:${palette.text}">${escapeHtml(region.owner)}</b>`
            + `<small>${region.modules.length} 模块 · ${region.commits.length} 提交</small>`
            + (region.conflicts ? `<span class="repo-label-badge muted">${region.conflicts} 冲突</span>` : "")
            + (region.unread ? `<span class="repo-label-badge">${region.unread} 新</span>` : "");
        }, `repo-label repo-label-owner${focus.kind === "owner" && focus.owner === region.owner ? " active" : ""}`, () => focusOwner(region.owner))
      });
    }

    if (focus.kind === "owner" || focus.kind === "module") {
      const scopeOwner = focus.kind === "owner" ? focus.owner : null;
      for (const node of nodesRef.current) {
        if (node.type !== "module") continue;
        const owner = (node.meta?.owner as string) || UNASSIGNED_OWNER;
        const inScope = focus.kind === "module" ? node.id === `module:${focus.id}` : owner === scopeOwner;
        if (!inScope) continue;
        const moduleId = Number(node.id.slice(7));
        // 有提交的模块更值得出现在画布上：标签放不下时由优先级决定谁被保留
        const activity = countCommitsOfModule(data, node.id);
        items.push({
          id: `label-module:${node.id}`,
          world: positionOf(node.id),
          priority: focus.kind === "module" ? 110 : 55 + Math.min(activity, 12),
          enabled: () => true,
          offsetY: -17,
          element: labelElement(node.id, () => {
            const palette = ownerPalette(owner);
            return `<i style="background:${palette.stroke}"></i><span title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</span>`;
          }, "repo-label repo-label-module", () => focusModule(moduleId, node.label))
        });
      }
    }

    if (focus.kind === "module") {
      for (const node of nodesRef.current) {
        const meta = commitMeta(node);
        if (!meta || !meta.affectedModules.some((module) => module.id === focus.id)) continue;
        items.push({
          id: `label-commit:${node.id}`,
          world: positionOf(node.id),
          priority: meta.conflict ? 80 : 40,
          enabled: () => true,
          element: labelElement(node.id, () => `${escapeHtml(meta.shortSha)}${meta.conflict ? " ⚠" : ""}`,
            `repo-label repo-label-commit${meta.conflict ? " conflict" : ""}`, () => setSelected(node))
        });
      }
    }

    if (focus.kind === "owner") {
      for (const node of nodesRef.current) {
        const meta = commitMeta(node);
        if (!meta?.conflict || ownerOfCommit(meta) !== focus.owner) continue;
        items.push({
          id: `label-commit:${node.id}`,
          world: positionOf(node.id),
          priority: 70,
          enabled: () => true,
          element: labelElement(node.id, () => `${escapeHtml(meta.shortSha)} ⚠`, "repo-label repo-label-commit conflict", () => setSelected(node))
        });
      }
    }
    return items;
  }, [data, regions, focus, focusOwner, focusModule]);

  useEffect(() => {
    const layer = labelLayerRef.current;
    if (!layer) return;
    layer.set(labelItems);
    layer.invalidate();
  }, [labelItems]);

  // ---- 每帧：脉冲、爆发、标签投影 ----
  useEffect(() => {
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const time = performance.now();
      const wave = (Math.sin(time / 320) + 1) / 2;
      for (const { ring } of haloRef.current) {
        ring.scale.setScalar(0.88 + wave * 0.5);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.3 + wave * 0.55;
      }
      for (let index = burstRef.current.length - 1; index >= 0; index -= 1) {
        const burst = burstRef.current[index];
        const age = (time - burst.born) / 2200;
        if (age >= 1) {
          burst.object.remove(burst.ring);
          burst.ring.geometry.dispose();
          (burst.ring.material as THREE.Material).dispose();
          burstRef.current.splice(index, 1);
          continue;
        }
        burst.ring.scale.setScalar(1 + age * 3.4);
        (burst.ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - age);
      }
      const graph = graphRef.current;
      const layer = labelLayerRef.current;
      if (graph && layer) {
        layer.renderThrottled(
          (x, y, z) => {
            const point = graph.graph2ScreenCoords(x, y, z);
            return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
          },
          graph.width() || 900,
          graph.height() || 600
        );
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    for (const id of burstIds) {
      const object = nodeObjectsRef.current.get(id);
      const node = nodesRef.current.find((item) => item.id === id);
      if (!object || !node) continue;
      const meta = commitMeta(node);
      const ring = new THREE.Mesh(
        new THREE.OctahedronGeometry(10, 0),
        new THREE.MeshBasicMaterial({ color: meta ? commitColor(meta) : 0x3f9c86, wireframe: true, transparent: true, opacity: 0.85, depthWrite: false })
      );
      object.add(ring);
      burstRef.current.push({ object, ring, born: performance.now() });
    }
  }, [burstIds]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const nodes = nodesRef.current.filter((node) => visibleIds.has(node.id));
    const links = linksRef.current.filter((link) => {
      const source = typeof link.source === "string" ? link.source : link.source.id;
      const target = typeof link.target === "string" ? link.target : link.target.id;
      return visibleIds.has(source) && visibleIds.has(target);
    });
    graph.graphData({ nodes, links });
  }, [visibleIds]);

  useEffect(() => () => {
    if (resizeRef.current) window.removeEventListener("resize", resizeRef.current);
    cancelAnimationFrame(frameRef.current);
    labelLayerRef.current?.destroy();
    labelLayerRef.current = null;
    graphRef.current?._destructor?.();
    graphRef.current = null;
  }, []);

  const markSeen = useCallback(() => {
    const now = Date.now();
    localStorage.setItem(SEEN_KEY, String(now));
    setLastSeen(now);
  }, []);

  const jumpToLatest = useCallback(() => {
    const newest = unreadCommits[0];
    markSeen();
    if (!newest) return;
    const meta = commitMeta(newest);
    if (meta) focusOwner(ownerOfCommit(meta));
  }, [focusOwner, markSeen, unreadCommits]);

  if (!data && !error) return <Loading />;
  if (!data) return <><PageHeader title="仓库全景" description="3D 视图加载失败。" /><div className="alert">{error}</div></>;

  const stats = data.stats;
  const visibleCommits = data.nodes.filter((node) => node.type === "commit" && visibleIds.has(node.id)).length;
  const moduleOwner = focus.kind === "module"
    ? ((nodesRef.current.find((node) => node.id === `module:${focus.id}`)?.meta?.owner as string | undefined) ?? null)
    : null;

  return (
    <>
      <PageHeader
        title="仓库全景"
        description="点分区标题进入负责人的区域，点模块查看它的详情与相关提交；颜色代表负责人，菱形是提交。"
        actions={
          <>
            <button className="secondary-button" onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{fullscreen ? "退出全屏" : "全屏"}
            </button>
            {user.role === "admin" && <button className="secondary-button" onClick={() => void syncCommits()} disabled={busy}><RefreshCw size={16} />补齐提交</button>}
            <button className="primary-button" onClick={() => void load(limit)} disabled={busy}><RefreshCw size={16} />{busy ? "加载中…" : "刷新"}</button>
          </>
        }
      />
      {error && <div className="alert">{error}</div>}

      {unreadCommits.length > 0 && (
        <div className="repo-newbar">
          <Sparkles size={16} />
          <span>自上次查看以来有 <strong>{unreadCommits.length} 个新提交</strong>，最近一个是 {timeAgo(commitMeta(unreadCommits[0])?.receivedAt)}。</span>
          <button onClick={jumpToLatest}>跳到最新</button>
          <button onClick={markSeen}>标记已读</button>
        </div>
      )}

      <section className="metric-grid repo-metrics">
        <article className="metric"><span>提交总数</span><strong>{stats.totalCommits}</strong><GitCommitHorizontal size={19} /></article>
        <article className="metric"><span>24 小时新增</span><strong>{stats.last24h}</strong><Sparkles size={19} /></article>
        <article className={`metric ${stats.conflicts > 0 ? "metric-danger" : ""}`}><span>冲突提交</span><strong>{stats.conflicts}</strong><AlertTriangle size={19} /></article>
        <article className="metric"><span>提交人</span><strong>{stats.authors}</strong><Users size={19} /></article>
        <article className="metric"><span>当前显示</span><strong>{visibleCommits}</strong><Boxes size={19} /></article>
      </section>

      {focus.kind === "overview" && (stats.unattributedCommits > 0 || stats.modulesWithoutPaths > 0) && (
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
        <div className="repo-canvas-wrap" ref={wrapRef}>
          <div ref={containerRef} className="repo-canvas" />
          {hovered && <HoverCard node={hovered.node} x={hovered.x} y={hovered.y} />}

          <div className="repo-controls">
            <nav className="repo-breadcrumb" aria-label="层级导航">
              <button onClick={backToOverview} disabled={focus.kind === "overview"}>仓库全景</button>
              {focus.kind !== "overview" && <ChevronRight size={13} />}
              {focus.kind === "owner" && <strong>{focus.owner}</strong>}
              {focus.kind === "module" && (
                <>
                  <button onClick={() => moduleOwner && focusOwner(moduleOwner)}>{moduleOwner ?? "区域"}</button>
                  <ChevronRight size={13} />
                  <strong>{focus.name}</strong>
                </>
              )}
              {focus.kind !== "overview" && <span>· Esc 返回</span>}
            </nav>
            <label className="repo-search">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提交、作者、模块" />
            </label>
            {focus.kind === "overview" && (
              <>
                <label className="repo-range">
                  <span>提交数量 {limit}</span>
                  <input type="range" min={20} max={200} step={20} value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
                </label>
                <div className="view-switcher" role="tablist" aria-label="视图过滤">
                  {([["all", "全部"], ["new", "仅新提交"], ["conflict", "仅冲突"], ["unattributed", "未归属"]] as Array<[ViewMode, string]>).map(([value, label]) => (
                    <button key={value} role="tab" aria-selected={mode === value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="repo-zoom">
            <button onClick={() => zoomBy(0.8)} title="放大（+）" aria-label="放大"><Plus size={16} /></button>
            <button onClick={() => zoomBy(1.25)} title="缩小（-）" aria-label="缩小"><Minus size={16} /></button>
            <button onClick={() => frameGraphRef.current?.(600)} title="适配全图" aria-label="适配全图"><RotateCcw size={15} /></button>
            <button onClick={toggleFullscreen} title={fullscreen ? "退出全屏" : "全屏"} aria-label="全屏">
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>

          {data.nodes.length === 0 && (
            <EmptyState icon={<FolderGit2 size={25} />} title="还没有提交数据" text="配置 Gitee WebHook 后新提交会自动进入；也可以点击「补齐提交」拉取最近记录。" />
          )}
        </div>

        <aside className="repo-sidebar">
          {focus.kind === "overview" && (
            <>
              <div className="panel">
                <div className="panel-header"><div><h2>负责人分区</h2><p>点名字进入该区域。</p></div></div>
                <div className="repo-panel-list">
                  {regions.map((region) => {
                    const palette = ownerPalette(region.owner);
                    return (
                      <button key={region.owner} className="repo-row" onClick={() => focusOwner(region.owner)}>
                        <i style={{ background: palette.stroke }} />
                        <span>{region.owner}</span>
                        <small>{region.modules.length} 模块 · {region.commits.length} 提交{region.conflicts ? ` · ${region.conflicts} 冲突` : ""}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="panel">
                <div className="panel-header"><div><h2>接入状态</h2><p>WebHook 是实时分析的唯一入口。</p></div></div>
                <div className="repo-stat-list">
                  <div><span>最近收到事件</span><strong>{stats.lastDeliveryAt ?? "尚未收到"}</strong></div>
                  <div><span>处理结果</span><strong>{DELIVERY_LABELS[stats.lastDeliveryStatus ?? ""] ?? stats.lastDeliveryStatus ?? "—"}</strong></div>
                  <div><span>最新提交时间</span><strong>{stats.latestCommitAt ?? "—"}</strong></div>
                  <div><span>未归属提交</span><strong className={stats.unattributedCommits > 0 ? "warn" : ""}>{stats.unattributedCommits}</strong></div>
                  <div><span>自动刷新</span><strong>每 {REFRESH_MS / 1000} 秒</strong></div>
                </div>
              </div>
              <div className="panel">
                <div className="panel-header"><div><h2>图例</h2><p>按类型区分节点。</p></div></div>
                <div className="legend">
                  {Object.entries(TYPE_LABELS).filter(([type]) => type !== "scenario").map(([type, label]) => (
                    <div key={type} className={`legend-item legend-${type}`}><i /><span>{label}</span></div>
                  ))}
                  <div className="legend-item legend-new"><i /><span>30 分钟内到达（爆发光圈）</span></div>
                  <div className="legend-item legend-conflict"><i /><span>冲突提交（红色描边）</span></div>
                </div>
              </div>
            </>
          )}

          {focus.kind === "owner" && (() => {
            const region = regions.find((item) => item.owner === focus.owner);
            if (!region) return null;
            return (
              <>
                <div className="panel">
                  <div className="panel-header"><div><h2>{region.owner}</h2><p>{region.modules.length} 个模块 · {region.commits.length} 个提交</p></div></div>
                  <div className="repo-stat-list">
                    <div><span>冲突提交</span><strong className={region.conflicts ? "warn" : ""}>{region.conflicts}</strong></div>
                    <div><span>未读提交</span><strong className={region.unread ? "warn" : ""}>{region.unread}</strong></div>
                    <div><span>最近提交</span><strong>{timeAgo(commitMeta(region.commits[0])?.receivedAt)}</strong></div>
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-header"><div><h2>模块</h2><p>完整清单；画布上优先显示有提交的模块。</p></div></div>
                  <div className="repo-panel-list">
                    {region.modules.map((node) => (
                      <button key={node.id} className="repo-row" onClick={() => focusModule(Number(node.id.slice(7)), node.label)}>
                        <i style={{ background: ownerPalette(region.owner).stroke }} />
                        <span>{node.label}</span>
                        <small>{countCommitsOfModule(data, node.id)} 提交</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-header"><div><h2>最近提交</h2><p>该区域的提交记录。</p></div></div>
                  <div className="repo-panel-list">
                    {region.commits.slice(0, 12).map((node) => <CommitRow key={node.id} node={node} onSelect={setSelected} />)}
                    {region.commits.length === 0 && <p className="detail-note">该区域暂无提交。</p>}
                  </div>
                </div>
              </>
            );
          })()}

          {focus.kind === "module" && (() => {
            const node = nodesRef.current.find((item) => item.id === `module:${focus.id}`);
            const owner = (node?.meta?.owner as string) || UNASSIGNED_OWNER;
            const related = (data.nodes as RepoNode[])
              .map((item) => ({ node: item, meta: commitMeta(item) }))
              .filter((item) => item.meta?.affectedModules.some((module) => module.id === focus.id))
              .sort((a, b) => Date.parse(b.meta!.receivedAt) - Date.parse(a.meta!.receivedAt));
            return (
              <>
                <div className="panel">
                  <div className="panel-header"><div><h2>{focus.name}</h2><p>{owner}{node?.meta?.key ? ` · ${String(node.meta.key)}` : ""}</p></div></div>
                  <div className="repo-stat-list">
                    <div><span>相关提交</span><strong>{related.length}</strong></div>
                    <div><span>含冲突</span><strong className={related.some((item) => item.meta?.conflict) ? "warn" : ""}>{related.filter((item) => item.meta?.conflict).length}</strong></div>
                    <div><span>负责人</span><strong>{owner}</strong></div>
                  </div>
                  {Array.isArray(node?.meta?.paths) && (node?.meta?.paths as string[]).length > 0 && (
                    <div className="repo-detail-grid">
                      <span className="detail-note">路径模式</span>
                      {(node?.meta?.paths as string[]).map((path) => <code key={path} className="detail-code">{path}</code>)}
                    </div>
                  )}
                </div>
                <div className="panel">
                  <div className="panel-header"><div><h2>相关提交</h2><p>点击查看该提交处理了什么。</p></div></div>
                  <div className="repo-panel-list">
                    {related.map((item) => <CommitRow key={item.node.id} node={item.node} onSelect={setSelected} />)}
                    {related.length === 0 && <p className="detail-note">暂无提交命中该模块。补充路径模式可以提高归属准确度。</p>}
                  </div>
                </div>
              </>
            );
          })()}
        </aside>
      </section>

      {selected && <CommitDrawer node={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

/* ---------- 场景构建 ---------- */

function setObjectOpacity(object: THREE.Object3D, value: number) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const store = material.userData as { baseOpacity?: number };
      if (store.baseOpacity === undefined) store.baseOpacity = material.opacity;
      material.transparent = true;
      material.opacity = store.baseOpacity * value;
    }
  });
}

function jitter(seed: string, index: number, spread: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100003;
  const angle = (hash % 360) * (Math.PI / 180) + index * 1.7;
  return { x: Math.cos(angle) * spread, y: Math.sin(angle * 1.3) * spread, z: Math.sin(angle) * spread };
}

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
    // 分区内要留出足够间距，否则进入区域后模块标签会互相压住
    const inner = 32 + Math.min(modules.length, 30) * 2.4;
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
      const meta = commitMeta(node);
      const base = meta ? ownerAnchor.get(ownerOfCommit(meta)) : undefined;
      if (base) {
        anchors.set(node.id, { x: base.x * 0.86, y: base.y * 0.86 - 20, z: base.z * 0.86 });
        continue;
      }
    }
    anchors.set(node.id, jitter(node.id, 0, 55));
  }
  return anchors;
}

function buildNodeObject(
  node: RepoNode,
  haloRef: MutableRefObject<{ node: RepoNode; ring: THREE.Mesh }[]>,
  registry: Map<string, THREE.Object3D>
) {
  const group = new THREE.Group();
  const meta = commitMeta(node);

  if (node.type === "commit" && meta) {
    const color = commitColor(meta);
    const volume = Math.min(meta.additions + meta.deletions, 600);
    const radius = meta.conflict ? 8 : 5.5 + Math.sqrt(volume) * 0.16;
    group.add(new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), new THREE.MeshBasicMaterial({ color })));
    if (meta.justArrived) {
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
    registry.set(node.id, group);
    return group;
  }

  if (node.type === "owner") {
    const owner = (node.meta?.owner as string) ?? node.label;
    group.add(new THREE.Mesh(new THREE.SphereGeometry(11, 20, 14), new THREE.MeshBasicMaterial({ color: ownerStrokeHex(owner) })));
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(16, 16, 12),
      new THREE.MeshBasicMaterial({ color: ownerFillHex(owner), transparent: true, opacity: 0.45, depthWrite: false })
    ));
    registry.set(node.id, group);
    return group;
  }

  if (node.type === "module") {
    const owner = (node.meta?.owner as string) ?? null;
    group.add(new THREE.Mesh(new THREE.SphereGeometry(8, 16, 12), new THREE.MeshBasicMaterial({ color: ownerStrokeHex(owner) })));
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(12.5, 14, 10),
      new THREE.MeshBasicMaterial({ color: ownerFillHex(owner), transparent: true, opacity: 0.42, depthWrite: false })
    ));
    registry.set(node.id, group);
    return group;
  }

  if (node.type === "author") {
    group.add(new THREE.Mesh(new THREE.SphereGeometry(4.4, 14, 10), new THREE.MeshBasicMaterial({ color: 0x7d95a1 })));
    registry.set(node.id, group);
    return group;
  }

  if (node.type === "pull") {
    group.add(new THREE.Mesh(new THREE.BoxGeometry(9, 9, 9), new THREE.MeshBasicMaterial({ color: 0x7d6bb0 })));
    registry.set(node.id, group);
    return group;
  }

  if (node.type === "project") {
    group.add(new THREE.Mesh(new THREE.SphereGeometry(15, 24, 18), new THREE.MeshBasicMaterial({ color: 0x2f6f7a })));
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(21, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x74b3ab, transparent: true, opacity: 0.24, depthWrite: false })
    ));
    registry.set(node.id, group);
    return group;
  }

  group.add(new THREE.Mesh(new THREE.SphereGeometry(3, 12, 9), new THREE.MeshBasicMaterial({ color: 0x9fb3bd })));
  registry.set(node.id, group);
  return group;
}

/* ---------- 标签与小组件 ---------- */

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}

const labelElements = new Map<string, { element: HTMLButtonElement; signature: string }>();
const LABEL_CACHE_LIMIT = 600;

function labelElement(id: string, content: () => string, className: string, onClick?: () => void) {
  let entry = labelElements.get(id);
  if (!entry) {
    // 缓存有上限：长会话里提交标签会随刷新不断累积，超限先清掉已断开的元素
    if (labelElements.size >= LABEL_CACHE_LIMIT) {
      for (const [key, value] of labelElements) {
        if (!value.element.isConnected) labelElements.delete(key);
      }
    }
    const element = document.createElement("button");
    element.type = "button";
    entry = { element, signature: "" };
    labelElements.set(id, entry);
  }
  entry.element.className = className;
  const html = content();
  if (entry.signature !== html) {
    entry.element.innerHTML = html;
    entry.signature = html;
  }
  entry.element.onclick = onClick ? (event) => { event.stopPropagation(); onClick(); } : null;
  return entry.element;
}

function countCommitsOfModule(data: RepoGraphData, moduleId: string) {
  const id = Number(moduleId.slice(7));
  return (data.nodes as RepoNode[]).filter((node) => commitMeta(node)?.affectedModules.some((module) => module.id === id)).length;
}

function CommitRow({ node, onSelect }: { node: RepoNode; onSelect: (node: RepoNode) => void }) {
  const meta = commitMeta(node);
  if (!meta) return null;
  return (
    <button className="repo-commit-row" onClick={() => onSelect(node)}>
      <strong>{meta.summary}</strong>
      <span>{meta.author} · {meta.shortSha} · {timeAgo(meta.committedAt ?? meta.receivedAt)}</span>
      <span>
        {meta.conflict && <SeverityBadge value={(meta.severity ?? "blocking") as Severity} />}
        {meta.affectedModules.length > 0 ? ` 影响 ${meta.affectedModules.length} 个模块` : " 未归属模块"}
      </span>
    </button>
  );
}

function HoverCard({ node, x, y }: { node: RepoNode; x: number; y: number }) {
  const meta = commitMeta(node);
  return (
    <div className="graph-hover-card" style={{ left: x + 16, top: y + 12 }}>
      {meta ? (
        <>
          <strong>{meta.summary}</strong>
          <span>{meta.author} · {meta.shortSha}</span>
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
          <small>{node.type === "owner" ? "点击进入该区域" : node.type === "module" ? "点击进入模块视图" : "点击查看详情"}</small>
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
            {meta.issueRefs.length > 0 && <div className="detail-row"><span>需求编号</span><strong>{meta.issueRefs.join("、")}</strong></div>}
            {meta.areas.length > 0 && <div className="detail-row"><span>影响目录</span><strong>{meta.areas.join("、")}</strong></div>}

            <h3>这个提交处理了什么</h3>
            <p className="detail-summary">{meta.summary}</p>
            <p className="detail-note">类型：{meta.kindLabel}{meta.scope ? `（${meta.scope}）` : ""}{meta.conflict ? " · 触发冲突提醒" : ""}</p>

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
              {meta.files.slice(0, 40).map((file) => (
                <li key={file.path}><code>{file.path}</code><span>+{file.additions ?? 0}/-{file.deletions ?? 0}</span></li>
              ))}
            </ul>

            {meta.url && <a className="primary-button drawer-link" href={meta.url} target="_blank" rel="noreferrer">在 Gitee 查看提交</a>}
          </>
        ) : (
          <>
            <div className="detail-row"><span>名称</span><strong>{node.label}</strong></div>
            {(node.meta?.owner as string) && <div className="detail-row"><span>负责人</span><strong>{node.meta?.owner as string}</strong></div>}
            {(node.meta?.status as string) && <div className="detail-row"><span>状态</span><strong>{node.meta?.status as string}</strong></div>}
            {(node.meta?.key as string) && <div className="detail-row"><span>模块 Key</span><strong>{node.meta?.key as string}</strong></div>}
          </>
        )}
      </div>
    </aside>
  );
}
