import crypto from "node:crypto";
import { config } from "./config.js";
import { execute, queryAll, queryOne } from "./db.js";

type SecretBox = { iv: string; tag: string; ciphertext: string };

function deriveKey(): Buffer {
  return crypto.scryptSync(config.sessionSecret || "local-development-session-secret", "giteehelper-settings", 32);
}

function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const box: SecretBox = {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
  return `enc:v1:${JSON.stringify(box)}`;
}

function decryptSecret(value: string): string {
  if (!value.startsWith("enc:v1:")) return value;
  const box = JSON.parse(value.slice(7)) as SecretBox;
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(box.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

const runtimeSettings = {
  giteeApiBase: "GITEE_API_BASE",
  giteeToken: "GITEE_TOKEN",
  giteeWebhookSecret: "GITEE_WEBHOOK_SECRET",
  giteeRepo: "GITEE_REPO",
  giteeDefaultBranch: "GITEE_DEFAULT_BRANCH",
  feishuWebhookUrl: "FEISHU_WEBHOOK_URL"
} as const;

type RuntimeKey = keyof typeof runtimeSettings;
const secretKeys: RuntimeKey[] = ["giteeToken", "giteeWebhookSecret", "feishuWebhookUrl"];

export function loadRuntimeSettings() {
  for (const [key, envKey] of Object.entries(runtimeSettings)) {
    const row = queryOne<{ value: string; is_secret: number }>(`SELECT value, is_secret FROM settings WHERE key = ?`, [key]);
    if (!row) continue;
    const value = row.is_secret ? decryptSecret(row.value) : row.value;
    (config as Record<string, unknown>)[key === "giteeApiBase" ? "giteeApiBase" : key] = value;
    if (envKey === "GITEE_API_BASE") config.giteeApiBase = value.replace(/\/$/, "");
    else if (key === "giteeToken") config.giteeToken = value;
    else if (key === "giteeWebhookSecret") config.giteeWebhookSecret = value;
    else if (key === "giteeRepo") config.giteeRepo = value;
    else if (key === "giteeDefaultBranch") config.giteeDefaultBranch = value;
    else if (key === "feishuWebhookUrl") config.feishuWebhookUrl = value;
  }
}

export function publicRuntimeSettings() {
  return {
    giteeApiBase: config.giteeApiBase,
    giteeRepo: config.giteeRepo,
    giteeDefaultBranch: config.giteeDefaultBranch,
    giteeTokenConfigured: Boolean(config.giteeToken),
    giteeWebhookSecretConfigured: Boolean(config.giteeWebhookSecret),
    feishuWebhookConfigured: Boolean(config.feishuWebhookUrl),
    secretsVisible: false
  };
}

export function updateRuntimeSettings(input: Record<string, unknown>) {
  const changed: Record<string, boolean> = {};
  const assignments: Partial<Record<RuntimeKey, string>> = {};

  const stringOrNull = (value: unknown) => typeof value === "string" ? value : null;

  const apiBase = stringOrNull(input.giteeApiBase);
  if (apiBase !== null) {
    const normalized = apiBase.trim().replace(/\/$/, "");
    if (!/^https?:\/\//i.test(normalized)) throw new Error("Gitee API Base 必须是 http(s) URL");
    assignments.giteeApiBase = normalized;
  }

  const repo = stringOrNull(input.giteeRepo);
  if (repo !== null) {
    const normalized = repo.trim();
    if (normalized && !/^[^/\s]+\/[^/\s]+$/.test(normalized)) throw new Error("Gitee 仓库必须是 owner/repository");
    assignments.giteeRepo = normalized;
  }

  const branch = stringOrNull(input.giteeDefaultBranch);
  if (branch !== null) {
    const normalized = branch.trim();
    if (!normalized) throw new Error("默认分支不能为空");
    assignments.giteeDefaultBranch = normalized;
  }

  for (const key of ["giteeToken", "giteeWebhookSecret", "feishuWebhookUrl"] as const) {
    const value = stringOrNull(input[key]);
    if (value !== null && value.trim()) assignments[key] = value.trim();
  }

  for (const [key, value] of Object.entries(assignments) as Array<[RuntimeKey, string]>) {
    const isSecret = secretKeys.includes(key);
    execute(
      `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = excluded.updated_at`,
      [key, isSecret ? encryptSecret(value) : value, isSecret ? 1 : 0]
    );
    if (key === "giteeApiBase") config.giteeApiBase = value;
    else if (key === "giteeToken") config.giteeToken = value;
    else if (key === "giteeWebhookSecret") config.giteeWebhookSecret = value;
    else if (key === "giteeRepo") config.giteeRepo = value;
    else if (key === "giteeDefaultBranch") config.giteeDefaultBranch = value;
    else if (key === "feishuWebhookUrl") config.feishuWebhookUrl = value;
    changed[key] = true;
  }

  return changed;
}

export function settingsTableExists() {
  return Boolean(queryOne(`SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`));
}

export function settingKeys() {
  return queryAll<{ key: string }>(`SELECT key FROM settings ORDER BY key`).map((row) => row.key);
}
