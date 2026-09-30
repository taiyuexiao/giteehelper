import { useEffect, useMemo, useState } from "react";
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, useEdgesState, useNodesState,
  type Edge, type Node, type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Boxes, ExternalLink, FileCode2, GitPullRequest, Network, Search, UserRound, Workflow, X
} from "lucide-react";
import { api } from "../api";
import { Loading, PageHeader } from "../components";
import { GitCommitHorizontal } from "lucide-react";
import type { GraphData, GraphEdge, GraphNode } from "../../shared/types";

type EntityType = GraphNode["type"];
type ViewMode = "architecture" | "impact" | "all";
type EntityNodeData = {
  label: string;
  type: EntityType;
  subtitle: string;
  meta?: Record<string, unknown>;
};
type EntityFlowNode = Node<EntityNodeData, "entity">;
type RelationFlowEdge = Edge<{ confidence: GraphEdge["confidence"]; kind: string }>;

const typeLabels: Record<EntityType, string> = {
  project: "项目",
  module: "模块",
  contract: "契约",
  scenario: "场景",
  user: "人员",
  event: "事件",
  author: "提交人",
  commit: "提交",
  pull: "PR",
  owner: "负责人"
};

const typeIcons: Record<EntityType, typeof Boxes> = {
  project: Network,
  module: Boxes,
  contract: FileCode2,
  scenario: Workflow,
  user: UserRound,
  event: GitPullRequest,
  author: UserRound,
  commit: GitCommitHorizontal,
  pull: GitPullRequest,
  owner: UserRound
};

const typeColors: Record<EntityType, string> = {
  project: "#163c52",
  module: "#17766f",
  contract: "#c66c2c",
  scenario: "#607b87",
  user: "#925b72",
  event: "#b8443c",
  author: "#6f8b96",
  commit: "#39809c",
  pull: "#7d6bb0",
  owner: "#4a8593"
};

function isLegacy(node: GraphNode) {
  return node.label.startsWith("[旧导入]") || node.label.startsWith("[示例]");
}

function subtitleFor(node: GraphNode): string {
  const meta = node.meta ?? {};
  if (node.type === "module") {
    const key = String(meta.key ?? "");
    const owner = String(meta.owner ?? "");
    return [key, owner, String(meta.status ?? "")].filter(Boolean).join(" · ");
  }
  if (node.type === "contract") return meta.version ? `契约 v${String(meta.version)}` : "契约";
  if (node.type === "user") return String(meta.role ?? "用户");
  return typeLabels[node.type];
}

function visibleGraphNodes(data: GraphData, ids: Set<string>): GraphNode[] {
  return data.nodes.filter((node) => ids.has(node.id) && !isLegacy(node));
}

function toFlowNodes(data: GraphData, ids: Set<string>, selectedId: string | null): EntityFlowNode[] {
  const visible = visibleGraphNodes(data, ids);
  const counters: Record<EntityType, number> = { project: 0, module: 0, contract: 0, scenario: 0, user: 0, event: 0, author: 0, commit: 0, pull: 0, owner: 0 };
  const x: Record<EntityType, number> = { user: 18, project: 330, module: 330, contract: 690, scenario: 1035, event: 1375, author: 18, commit: 1035, pull: 690, owner: 18 };
  return visible.map((node) => {
    const index = counters[node.type]++;
    const y = node.type === "project" ? -60 : 78 + index * 112;
    return {
      id: node.id,
      type: "entity",
      position: { x: x[node.type], y },
      selected: node.id === selectedId,
      data: { label: node.label, type: node.type, subtitle: subtitleFor(node), meta: node.meta },
      style: { width: node.type === "module" ? 248 : 224 }
    };
  });
}

function toFlowEdges(data: GraphData, ids: Set<string>, selectedId: string | null): RelationFlowEdge[] {
  return data.edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => {
      const impact = ["blocking", "contract", "implementation"].includes(edge.label);
      const active = selectedId && (edge.source === selectedId || edge.target === selectedId);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        animated: impact,
        selected: Boolean(active),
        data: { confidence: edge.confidence, kind: edge.label },
        style: {
          stroke: impact ? "#b8443c" : edge.confidence === "contract" ? "#c66c2c" : "#9aadb2",
          strokeWidth: active ? 2.8 : impact ? 2.1 : 1.3,
          strokeDasharray: edge.confidence === "inferred" ? "6 5" : edge.confidence === "history" ? "3 4" : undefined,
          opacity: active ? 1 : edge.confidence === "manual" || impact ? 0.88 : 0.58
        },
        markerEnd: { type: "arrowclosed" as never, color: impact ? "#b8443c" : "#9aadb2" }
      };
    });
}

function EntityNode({ data, selected }: NodeProps<EntityFlowNode>) {
  const Icon = typeIcons[data.type];
  return (
    <div className={`entity-node entity-${data.type} ${selected ? "selected" : ""}`} style={{ borderColor: typeColors[data.type] }}>
      <Handle type="target" position={Position.Left} className="entity-handle" />
      <div className="entity-icon" style={{ color: typeColors[data.type], background: `${typeColors[data.type]}16` }}>
        <Icon size={18} />
      </div>
      <div className="entity-copy">
        <strong>{data.label}</strong>
        <span>{data.subtitle}</span>
      </div>
      <Handle type="source" position={Position.Right} className="entity-handle" />
    </div>
  );
}

const nodeTypes = { entity: EntityNode };

export default function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<EntityFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationFlowEdge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focusEvent, setFocusEvent] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("architecture");
  const [types, setTypes] = useState<Set<EntityType>>(new Set(["project", "module", "contract", "scenario", "user"]));
  const [error, setError] = useState("");

  useEffect(() => {
    api<GraphData>("/graph").then((graph) => {
      setData(graph);
      const latestEvent = graph.nodes.filter((node) => node.type === "event" && !isLegacy(node)).at(-1);
      setFocusEvent(latestEvent?.id ?? "");
    }).catch((reason) => setError(String(reason)));
  }, []);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of data?.edges ?? []) {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)?.add(edge.target);
      map.get(edge.target)?.add(edge.source);
    }
    return map;
  }, [data]);

  const visibleIds = useMemo(() => {
    if (!data) return new Set<string>();
    const clean = data.nodes.filter((node) => !isLegacy(node));
    const moduleNodes = clean.filter((node) => node.type === "module");
    // 优先展示导入的顶层工作项模块；没有这类 key 时回退到全部模块，
    // 否则在只有普通模块的项目里架构总览会是一片空白。
    const prefixedModules = moduleNodes.filter((node) => String(node.meta?.key ?? "").startsWith("module-"));
    const topLevelModules = prefixedModules.length ? prefixedModules : moduleNodes;
    let ids = new Set<string>();

    if (viewMode === "architecture") {
      for (const module of topLevelModules) {
        ids.add(module.id);
        for (const neighbor of adjacency.get(module.id) ?? []) {
          const node = data.nodes.find((item) => item.id === neighbor);
          if (node && node.type !== "event" && !isLegacy(node)) ids.add(neighbor);
        }
      }
    } else if (viewMode === "impact") {
      const focusId = focusEvent || clean.filter((node) => node.type === "event").at(-1)?.id;
      if (focusId) {
        ids.add(focusId);
        for (const first of adjacency.get(focusId) ?? []) {
          ids.add(first);
          for (const second of adjacency.get(first) ?? []) {
            const node = data.nodes.find((item) => item.id === second);
            if (node?.type !== "event") ids.add(second);
          }
        }
      }
    } else {
      ids = new Set(clean.map((node) => node.id));
    }

    for (const id of [...ids]) {
      const node = data.nodes.find((item) => item.id === id);
      if (node && !types.has(node.type)) ids.delete(id);
    }

    const normalized = query.trim().toLowerCase();
    if (normalized) {
      const matches = clean.filter((node) => `${node.label} ${subtitleFor(node)}`.toLowerCase().includes(normalized)).map((node) => node.id);
      const withNeighbors = new Set(matches);
      for (const match of matches) for (const neighbor of adjacency.get(match) ?? []) withNeighbors.add(neighbor);
      ids = new Set([...ids].filter((id) => withNeighbors.has(id)));
    }

    return ids;
  }, [data, adjacency, viewMode, focusEvent, query, types]);

  useEffect(() => {
    if (!data) return;
    setNodes(toFlowNodes(data, visibleIds, selectedId));
    setEdges(toFlowEdges(data, visibleIds, selectedId));
  }, [data, visibleIds, selectedId, setNodes, setEdges]);

  const selected = data?.nodes.find((node) => node.id === selectedId);
  const selectedRelations = data?.edges.filter((edge) =>
    visibleIds.has(edge.source) && visibleIds.has(edge.target) &&
    (edge.source === selectedId || edge.target === selectedId)
  ) ?? [];
  const eventOptions = data?.nodes.filter((node) => node.type === "event" && !isLegacy(node)) ?? [];

  function toggleType(type: EntityType) {
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  if (!data) {
    return (
      <>
        <PageHeader title="架构关系图" description="按架构层级查看输入、治理、模块和交付关系。" />
        {error ? <div className="alert">{error}</div> : <Loading />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="架构关系图"
        description="按架构层级查看输入、治理、模块和交付关系；影响模式只显示一次变化的证据链。"
        actions={<>
          <a
            className="secondary-button"
            href={`${import.meta.env.BASE_URL}architecture.html`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} />打开 Archify 架构图
          </a>
          <button className="secondary-button" onClick={() => {
            setSelectedId(null);
            setViewMode("architecture");
            setFocusEvent(eventOptions.at(-1)?.id ?? "");
            setQuery("");
            setTypes(new Set(["project", "module", "contract", "scenario", "user"]));
          }}><X size={16} />重置视图</button>
        </>}
      />
      {error && <div className="alert">{error}</div>}

      <section className="architecture-strip">
        <div><span>01</span><strong>输入</strong><small>Gitee · 文档 · 规范</small></div>
        <i />
        <div><span>02</span><strong>治理</strong><small>影响 · 规则 · 负责人</small></div>
        <i />
        <div><span>03</span><strong>交付</strong><small>模块 · 契约 · 场景</small></div>
        <i />
        <div><span>04</span><strong>验证</strong><small>联调 · 修复 · 审计</small></div>
      </section>

      <section className="graph-toolbar panel">
        <div className="view-switcher" role="tablist" aria-label="关系图模式">
          {([
            ["architecture", "架构总览"],
            ["impact", "影响路径"],
            ["all", "全部对象"]
          ] as Array<[ViewMode, string]>).map(([mode, label]) => (
            <button key={mode} className={viewMode === mode ? "active" : ""} onClick={() => setViewMode(mode)}>{label}</button>
          ))}
        </div>
        <label className="graph-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模块、契约、人员或事件" /></label>
        {viewMode === "impact" && (
          <label className="graph-focus"><GitPullRequest size={17} /><select value={focusEvent} onChange={(event) => setFocusEvent(event.target.value)}><option value="">最近事件</option>{eventOptions.map((event) => <option key={event.id} value={event.id}>聚焦：{event.label}</option>)}</select></label>
        )}
        <div className="graph-type-filters">
          {(Object.keys(typeLabels) as EntityType[]).filter((type) => type !== "event" || viewMode !== "architecture").map((type) => {
            const Icon = typeIcons[type];
            return <button key={type} className={types.has(type) ? "type-filter active" : "type-filter"} style={{ "--type-color": typeColors[type] } as React.CSSProperties} onClick={() => toggleType(type)}><Icon size={14} />{typeLabels[type]}</button>;
          })}
        </div>
      </section>

      <section className="reactflow-layout">
        <div className="reactflow-shell panel">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            // key 不含 query：搜索每敲一个字符都会改 query，含进去会整图重挂载并丢失缩放状态
            key={`${viewMode}-${focusEvent}`}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 0.95 }}
            minZoom={0.22}
            maxZoom={1.35}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#d7e0e2" gap={22} size={1.2} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => typeColors[(node.data as EntityNodeData).type] ?? "#78909c"}
              maskColor="rgba(233, 238, 239, 0.72)"
              position="bottom-right"
            />
          </ReactFlow>
        </div>

        <aside className="panel graph-inspector">
          {!selected ? (
            <div className="graph-inspector-empty">
              <Network size={27} />
              <h2>选择架构节点</h2>
              <p>架构总览默认只显示顶层模块及其人员、契约和场景。点击节点查看关系。</p>
            </div>
          ) : (
            <>
              <div className="inspector-title" style={{ "--type-color": typeColors[selected.type] } as React.CSSProperties}>
                <div className="entity-icon">{(() => { const Icon = typeIcons[selected.type]; return <Icon size={20} />; })()}</div>
                <div><span>{typeLabels[selected.type]}</span><h2>{selected.label}</h2></div>
              </div>
              <div className="inspector-meta">
                {Object.entries(selected.meta ?? {}).map(([key, value]) => <div key={key}><span>{key}</span><strong>{String(value)}</strong></div>)}
              </div>
              <h3>关系（{selectedRelations.length}）</h3>
              <div className="relation-list">
                {selectedRelations.map((relation) => {
                  const otherId = relation.source === selected.id ? relation.target : relation.source;
                  const other = data.nodes.find((node) => node.id === otherId);
                  return (
                    <button key={relation.id} onClick={() => setSelectedId(otherId)}>
                      <span className={`confidence confidence-${relation.confidence}`}>{relation.confidence}</span>
                      <div><strong>{other?.label ?? otherId}</strong><small>{relation.label} · {typeLabels[other?.type ?? "module"]}</small></div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="confidence-legend">
            <strong>关系语义</strong>
            <span><i className="line manual" />manual 人工确认</span>
            <span><i className="line contract" />contract 契约定义</span>
            <span><i className="line inferred" />inferred 影响推断</span>
          </div>
        </aside>
      </section>
    </>
  );
}
