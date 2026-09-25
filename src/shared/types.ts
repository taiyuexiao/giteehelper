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
  status: "passed" | "failed" | "blocked" | "skipped";
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
  type: "project" | "module" | "contract" | "scenario" | "user" | "event";
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
