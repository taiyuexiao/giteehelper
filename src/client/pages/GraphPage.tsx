import { useEffect, useMemo, useState } from "react";
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, useEdgesState, useNodesState, type Edge, type Node, type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Boxes, FileCode2, Focus, GitPullRequest, Network, Search, Shapes, UserRound, Workflow, X
} from "lucide-react";
import { api } from "../api";
import { Loading, PageHeader } from "../components";
import type { GraphData, GraphEdge, GraphNode } from "../../shared/types";

type EntityType = GraphNode["type"];
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
  event: "事件"
};

const typeIcons: Record<EntityType, typeof Boxes> = {
  project: Network,
  module: Boxes,
  contract: FileCode2,
  scenario: Workflow,
  user: UserRound,
  event: GitPullRequest
};

const typeColors: Record<EntityType, string> = {
  project: "#163c52",
  module: "#17766f",
  contract: "#c66c2c",
  scenario: "#607b87",
  user: "#925b72",
  event: "#b8443c"
};

function subtitleFor(node: GraphNode): string {
  const meta = node.meta ?? {};
  if (node.type === "module") return String(meta.key ?? "") + (meta.status ? ` · ${String(meta.status)}` : "");
  if (node.type === "contract") return meta.version ? `v${String(meta.version)}` : "契约";
  if (node.type === "user") return String(meta.role ?? "用户");
  return typeLabels[node.type];
}

function toFlowNodes(data: GraphData): EntityFlowNode[] {
  const counters: Record<EntityType, number> = { project: 0, module: 0, contract: 0, scenario: 0, user: 0, event: 0 };
  const x: Record<EntityType, number> = { user: 15, project: 275, module: 275, contract: 545, scenario: 805, event: 1070 };
  return data.nodes.map((node) => {
    const index = counters[node.type]++;
    const y = node.type === "project" ? -55 : 70 + index * 112;
    return {
      id: node.id,
      type: "entity",
      position: { x: x[node.type], y },
      data: { label: node.label, type: node.type, subtitle: subtitleFor(node), meta: node.meta },
      style: { width: 224 }
    };
  });
}

function toFlowEdges(data: GraphData): RelationFlowEdge[] {
  return data.edges.map((edge) => {
    const impact = edge.label === "blocking" || edge.label === "contract" || edge.label === "implementation";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: impact,
      data: { confidence: edge.confidence, kind: edge.label },
      style: {
        stroke: impact ? "#b8443c" : edge.confidence === "contract" ? "#c66c2c" : "#9aadb2",
        strokeWidth: impact ? 2.2 : 1.5,
        strokeDasharray: edge.confidence === "inferred" ? "6 5" : edge.confidence === "history" ? "3 4" : undefined,
        opacity: edge.confidence === "manual" || impact ? 0.92 : 0.7
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
      <div className="entity-icon" style={{ color: typeColors[data.type], background: `${typeColors[data.type]}16` }}><Icon size={18} /></div>
      <div className="entity-copy"><strong>{data.label}</strong><span>{data.subtitle}</span></div>
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
  const [types, setTypes] = useState<Set<EntityType>>(new Set(["project", "module", "contract", "scenario", "user", "event"]));
  const [error, setError] = useState("");

  useEffect(() => {
    api<GraphData>("/graph").then((graph) => {
      setData(graph);
      setNodes(toFlowNodes(graph));
      setEdges(toFlowEdges(graph));
      const latestEvent = graph.nodes.filter((node) => node.type === "event").at(-1);
      if (latestEvent) setFocusEvent(latestEvent.id);
    }).catch((reason) => setError(String(reason)));
  }, [setNodes, setEdges]);

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
    let allowed = new Set(data.nodes.filter((node) => types.has(node.type)).map((node) => node.id));
    const normalized = query.trim().toLowerCase();
    if (normalized) {
      const matches = data.nodes.filter((node) => `${node.label} ${subtitleFor(node)}`.toLowerCase().includes(normalized)).map((node) => node.id);
      const withNeighbors = new Set(matches);
      for (const match of matches) for (const neighbor of adjacency.get(match) ?? []) withNeighbors.add(neighbor);
      allowed = new Set([...allowed].filter((id) => withNeighbors.has(id)));
    }
    if (focusEvent) {
      const focusSet = new Set([focusEvent]);
      const direct = [...(adjacency.get(focusEvent) ?? [])];
      for (const first of direct) {
        focusSet.add(first);
        for (const second of adjacency.get(first) ?? []) {
          const secondNode = data.nodes.find((node) => node.id === second);
          if (secondNode?.type !== "event") focusSet.add(second);
        }
      }
      allowed = new Set([...allowed].filter((id) => focusSet.has(id)));
    }
    return allowed;
  }, [data, types, query, focusEvent, adjacency]);

  useEffect(() => {
    setNodes((current) => current.map((node) => ({
      ...node,
      hidden: !visibleIds.has(node.id),
      selected: node.id === selectedId,
      data: node.data
    })));
    setEdges((current) => current.map((edge) => ({
      ...edge,
      hidden: !visibleIds.has(edge.source) || !visibleIds.has(edge.target),
      selected: Boolean(selectedId && (edge.source === selectedId || edge.target === selectedId))
    })));
  }, [visibleIds, selectedId, setNodes, setEdges]);

  const selected = data?.nodes.find((node) => node.id === selectedId);
  const selectedRelations = data?.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target) && (edge.source === selectedId || edge.target === selectedId)) ?? [];
  const eventOptions = data?.nodes.filter((node) => node.type === "event") ?? [];

  function toggleType(type: EntityType) {
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  if (!data) return <Loading />;

  return (
    <>
      <PageHeader
        title="关系图"
        description="默认聚焦最新事件的影响路径；点击节点查看证据关系，切换全景查看全部对象。"
        actions={<button className="secondary-button" onClick={() => {
          const latestEvent = data.nodes.filter((node) => node.type === "event").at(-1);
          setSelectedId(null);
          setFocusEvent(latestEvent?.id ?? "");
          setQuery("");
          setTypes(new Set(["project", "module", "contract", "scenario", "user", "event"]));
        }}><X size={16} />重置筛选</button>}
      />
      {error && <div className="alert">{error}</div>}

      <section className="graph-toolbar panel">
        <label className="graph-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模块、契约、人员或事件" /></label>
        <label className="graph-focus"><Focus size={17} /><select value={focusEvent} onChange={(event) => setFocusEvent(event.target.value)}><option value="">全景关系</option>{eventOptions.map((event) => <option key={event.id} value={event.id}>聚焦：{event.label}</option>)}</select></label>
        <div className="graph-type-filters">
          {(Object.keys(typeLabels) as EntityType[]).map((type) => {
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
            key={`${focusEvent}-${query}`}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
            minZoom={0.22}
            maxZoom={1.5}
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
              <h2>选择关系节点</h2>
              <p>点击节点查看类型、状态、相邻关系和置信度。拖动画布可平移，滚轮缩放。</p>
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
            <strong>置信度</strong>
            <span><i className="line manual" />manual 人工确认</span>
            <span><i className="line contract" />contract 契约定义</span>
            <span><i className="line inferred" />inferred 自动推断</span>
          </div>
        </aside>
      </section>
    </>
  );
}
