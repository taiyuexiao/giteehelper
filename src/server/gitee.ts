import crypto from "node:crypto";
import { config } from "./config.js";
import type { CommitFile, CommitInput } from "./commits.js";
import type { EventInput } from "./impact.js";

export function verifyGiteeSignature(secret: string, token: string | undefined, timestamp: string | undefined): boolean {
  if (!secret || !token) return false;
  if (token === secret) return true;
  if (!timestamp) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  const normalizedExpected = encodeURIComponent(expected);
  const candidates = [expected, normalizedExpected];
  return candidates.some((candidate) => {
    const left = Buffer.from(candidate);
    const right = Buffer.from(token);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
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
    branch: branchOf(pull.target_branch ?? payload.ref ?? payload.branch, "main"),
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

function splitRepo(repo: string): [string, string] {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("GITEE_REPO must be owner/repo");
  return [owner, name];
}

function branchOf(ref: unknown, fallback: string): string {
  const value = typeof ref === "string" ? ref : "";
  return value.replace(/^refs\/heads\//, "") || fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function filesOf(raw: Record<string, unknown>): CommitFile[] {
  const files: CommitFile[] = [];
  for (const key of ["added", "removed", "modified"] as const) {
    const list = raw[key];
    if (Array.isArray(list)) {
      for (const item of list) if (typeof item === "string") files.push({ path: item });
    }
  }
  const detailed = raw.files;
  if (Array.isArray(detailed)) {
    for (const item of detailed) {
      if (!item || typeof item !== "object") continue;
      const file = item as Record<string, unknown>;
      const path = asString(file.filename) ?? asString(file.path) ?? asString(file.new_path);
      if (!path) continue;
      files.push({
        path,
        additions: typeof file.additions === "number" ? file.additions : undefined,
        deletions: typeof file.deletions === "number" ? file.deletions : undefined
      });
    }
  }
  const seen = new Set<string>();
  return files.filter((file) => (seen.has(file.path) ? false : (seen.add(file.path), true)));
}

/** Gitee Push 事件里已经带了提交列表，不需要再回查 API，可直接用于“新提交及时分析”。 */
export function extractPushCommits(payload: Record<string, unknown>, repo?: string): CommitInput[] {
  const branch = branchOf(payload.ref, "main");
  const repository = (payload.repository ?? payload.project ?? {}) as Record<string, unknown>;
  const repoName = repo || asString(repository.path_with_namespace) || asString(repository.full_name) || "";
  const raw = Array.isArray(payload.commits) ? payload.commits : [];
  const list = raw.length ? raw : (payload.head_commit ? [payload.head_commit] : []);
  const commits: CommitInput[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const commit = item as Record<string, unknown>;
    const sha = asString(commit.id) ?? asString(commit.sha);
    if (!sha) continue;
    const author = (commit.author ?? {}) as Record<string, unknown>;
    const committer = (commit.committer ?? {}) as Record<string, unknown>;
    commits.push({
      sha,
      message: asString(commit.message) ?? "",
      authorName: asString(author.name) ?? asString(committer.name) ?? null,
      authorEmail: asString(author.email) ?? asString(committer.email) ?? null,
      committedAt: asString(commit.timestamp) ?? asString(author.time) ?? asString(committer.date) ?? null,
      branch,
      url: asString(commit.url) ?? (repoName ? `https://gitee.com/${repoName}/commit/${sha}` : null),
      files: filesOf(commit)
    });
  }
  return commits;
}

export async function listCommits(repo: string, branch: string, perPage = 30): Promise<CommitInput[]> {
  const [owner, name] = splitRepo(repo);
  const rows = await giteeRequest<Array<Record<string, unknown>>>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const commit = (row.commit ?? {}) as Record<string, unknown>;
    const author = (commit.author ?? {}) as Record<string, unknown>;
    const user = (row.author ?? {}) as Record<string, unknown>;
    const sha = asString(row.sha) ?? asString(row.id) ?? "";
    return {
      sha,
      message: asString(commit.message) ?? "",
      authorLogin: asString(user.login) ?? null,
      authorName: asString(user.name) ?? asString(author.name) ?? null,
      authorEmail: asString(user.email) ?? asString(author.email) ?? null,
      committedAt: asString(author.date) ?? asString(commit.committer && (commit.committer as Record<string, unknown>).date) ?? null,
      branch,
      url: asString(row.html_url) ?? (sha ? `https://gitee.com/${repo}/commit/${sha}` : null),
      files: filesOf(row)
    } satisfies CommitInput;
  }).filter((commit) => Boolean(commit.sha));
}

/** 列表接口通常不带文件明细，逐个补齐；调用方需要限制次数以尊重 API 限额。 */
export async function fetchCommitDetail(repo: string, sha: string): Promise<CommitInput | undefined> {
  const [owner, name] = splitRepo(repo);
  const row = await giteeRequest<Record<string, unknown>>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`
  );
  if (!row || typeof row !== "object") return undefined;
  const commit = (row.commit ?? {}) as Record<string, unknown>;
  const author = (commit.author ?? {}) as Record<string, unknown>;
  const user = (row.author ?? {}) as Record<string, unknown>;
  return {
    sha,
    message: asString(commit.message) ?? "",
    authorLogin: asString(user.login) ?? null,
    authorName: asString(user.name) ?? asString(author.name) ?? null,
    authorEmail: asString(user.email) ?? asString(author.email) ?? null,
    committedAt: asString(author.date) ?? null,
    url: asString(row.html_url) ?? `https://gitee.com/${repo}/commit/${sha}`,
    files: filesOf(row),
    additions: typeof row.stats === "object" && row.stats ? Number((row.stats as Record<string, unknown>).additions) || 0 : undefined,
    deletions: typeof row.stats === "object" && row.stats ? Number((row.stats as Record<string, unknown>).deletions) || 0 : undefined
  };
}

export async function createBranch(repo: string, branchName: string, ref: string) {
  const [owner, name] = splitRepo(repo);
  return giteeRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`, {
    method: "POST",
    body: JSON.stringify({ refs: ref, branch_name: branchName })
  });
}

export async function createPullRequest(repo: string, title: string, head: string, base: string, body: string) {
  const [owner, name] = splitRepo(repo);
  return giteeRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head, base, body })
  });
}
