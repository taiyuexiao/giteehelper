import crypto from "node:crypto";
import { config } from "./config.js";
import { audit } from "./db.js";
import type { EventInput } from "./impact.js";

export function verifyGiteeSignature(secret: string, token: string | undefined, timestamp: string | undefined): boolean {
  if (!secret || !token) return false;
  if (token === secret) return true;
  if (!timestamp) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  const normalizedExpected = encodeURIComponent(expected);
  return token === expected || token === normalizedExpected;
}

export async function giteeRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!config.giteeToken) throw new Error("GITEE_TOKEN is not configured");
  const url = `${config.giteeApiBase}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.giteeToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Gitee API ${response.status}: ${text.slice(0, 300)}`);
  return data as T;
}

export async function testGiteeConnection() {
  const user = await giteeRequest<{ login: string; name?: string; html_url?: string }>("/user");
  return { ok: true, login: user.login, name: user.name ?? user.login, url: user.html_url };
}

export async function createPullComment(repo: string, pullNumber: number, body: string) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("GITEE_REPO must be owner/repo");
  return giteeRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${pullNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body })
  });
}

export function normalizeGiteeEvent(payload: Record<string, unknown>, eventTypeHeader: string | undefined): EventInput {
  const hookName = String(payload.hook_name ?? "");
  const action = String(payload.action ?? (hookName === "push_hooks" ? "push" : "updated"));
  const pull = (payload.pull_request ?? payload) as Record<string, unknown>;
  const repository = (payload.repository ?? payload.project ?? {}) as Record<string, unknown>;
  const note = payload.note as Record<string, unknown> | undefined;
  const eventInput: EventInput = {
    source: "gitee",
    sourceId: String(payload.hook_id ?? pull.id ?? payload.after ?? crypto.randomUUID()),
    eventType: hookName.includes("merge_request") ? "pull_request" : hookName.includes("note") ? "note" : hookName.includes("issue") ? "issue" : "push",
    action,
    title: String(pull.title ?? payload.title ?? note?.body ?? eventTypeHeader ?? "Gitee 变化"),
    author: String((payload.sender as Record<string, unknown> | undefined)?.login ?? (pull.author as Record<string, unknown> | undefined)?.login ?? payload.user_name ?? "unknown"),
    branch: String(pull.target_branch ?? payload.ref ?? payload.branch ?? "main"),
    url: String(pull.html_url ?? payload.url ?? repository.html_url ?? ""),
    payload
  };
  return eventInput;
}

export async function listPullRequests(repo: string, state: "open" | "closed" | "all" = "all") {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("GITEE_REPO must be owner/repo");
  return giteeRequest<Array<Record<string, unknown>>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=${state}&per_page=20&sort=updated&direction=desc`);
}

export async function createBranch(repo: string, branchName: string, ref: string) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("GITEE_REPO must be owner/repo");
  return giteeRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`, {
    method: "POST",
    body: JSON.stringify({ refs: ref, branch_name: branchName })
  });
}

export async function createPullRequest(repo: string, title: string, head: string, base: string, body: string) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("GITEE_REPO must be owner/repo");
  return giteeRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head, base, body })
  });
}

export function recordExternalWrite(action: string, detail: Record<string, unknown>) {
  audit(null, "system", action, "external_write", action, detail);
}
