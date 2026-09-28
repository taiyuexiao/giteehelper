export type Role = "admin" | "maintainer" | "reviewer" | "developer" | "observer";
export type ModuleStatus = "not_started" | "contract_ready" | "code_submitted" | "contract_verified" | "slice_integrated" | "release_ready" | "blocked";
export type Severity = "blocking" | "contract" | "implementation" | "clarification" | "informational";

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  email?: string | null;
  giteeLogin?: string | null;
  feishuUserId?: string | null;
  active: boolean;
  createdAt: string;
  ownedModules?: Array<{
    id: number;
    moduleKey: string;
    name: string;
    status: ModuleStatus;
  }>;
}

export interface Module {
  id: number;
  moduleKey: string;
  name: string;
  ownerUserId: number | null;
  ownerName?: string;
  status: ModuleStatus;
  paths: string[];
  scenarios: string[];
  provides: ContractRef[];
  requires: ContractRef[];
  testCommand?: string | null;
  description?: string | null;
}

export interface ContractRef {
  key: string;
  version: string;
  mode?: "required" | "optional";
}

export interface Contract {
  id: number;
  contractKey: string;
  version: string;
  kind: "api" | "event" | "data" | "ui" | "document" | "scenario";
  schema: Record<string, unknown>;
  ownerUserId: number | null;
}

export interface Rule {
  id: number;
  ruleKey: string;
  name: string;
  enabled: boolean;
  severity: Severity;
  trigger: Record<string, unknown>;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export interface ChangeEvent {
  id: number;
  source: string;
  sourceId: string;
  eventType: string;
  action: string;
  title: string;
  author: string;
  branch?: string | null;
  url?: string | null;
  createdAt: string;
}

export interface Impact {
  id: number;
  eventId: number;
  moduleId: number | null;
  userId: number | null;
  severity: Severity;
  category: string;
  reason: string;
  evidence: Evidence[];
  nextAction: string;
  /** 影响原因（规则判定）：为什么这个模块会受影响 */
  reasonCode?: string | null;
  reasonLabel?: string | null;
  reasonNature?: string | null;
  reasonAction?: string | null;
  status: "open" | "acknowledged" | "resolved" | "ignored";
  createdAt: string;
}

export interface Evidence {
  type: string;
  id?: string;
  label: string;
  url?: string;
}

export interface IntegrationCombinationItem {
  moduleKey: string;
  version: string;
  mode: "real" | "stub";
  status: "ready" | "passed" | "failed" | "blocked" | "skipped";
}

export interface IntegrationRun {
  id: number;
  triggerEventId: number | null;
  moduleKey: string;
  status: "queued" | "running" | "passed" | "failed" | "blocked";
  combination: IntegrationCombinationItem[];
  result: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardData {
  stats: {
    events: number;
    openImpacts: number;
    blockingImpacts: number;
    activeModules: number;
    pendingRepairs: number;
  };
  actions: Impact[];
  recentEvents: ChangeEvent[];
  recentRuns: IntegrationRun[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: "project" | "module" | "contract" | "scenario" | "user" | "event" | "author" | "commit" | "pull" | "owner";
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  confidence: "manual" | "contract" | "static" | "history" | "inferred";
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RepoCommitMeta {
  sha: string;
  shortSha: string;
  subject: string;
  summary: string;
  kind: string;
  kindLabel: string;
  scope: string | null;
  issueRefs: string[];
  author: string;
  authorLogin: string | null;
  committedAt: string | null;
  receivedAt: string;
  ageHours: number | null;
  isNew: boolean;
  justArrived: boolean;
  branch: string | null;
  url: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  areas: string[];
  severity: Severity | null;
  conflict: boolean;
  pullNumber: number | null;
  pullTitle: string | null;
  affectedModules: Array<{ id: number; name: string; owner: string | null; severity: Severity; reason: string; nextAction: string }>;
  files: Array<{ path: string; additions?: number; deletions?: number }>;
}

export interface RepoOwnerCluster {
  owner: string;
  fill: string;
  fillSoft: string;
  stroke: string;
  text: string;
  moduleIds: string[];
  commitIds: string[];
  moduleNames: string[];
}

export interface RepoGraphStats {
  totalCommits: number;
  shownCommits: number;
  conflicts: number;
  authors: number;
  last24h: number;
  unattributedCommits: number;
  latestCommitAt: string | null;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  modulesWithoutPaths: number;
  generatedAt: string;
}

export interface RepoGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: RepoOwnerCluster[];
  stats: RepoGraphStats;
}
