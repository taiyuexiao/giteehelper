import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

const root = process.cwd();

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: intEnv("PORT", 8787),
  databasePath: path.resolve(root, process.env.DATABASE_PATH ?? "./data/giteehelper.db"),
  giteeApiBase: (process.env.GITEE_API_BASE ?? "https://gitee.com/api/v5").replace(/\/$/, ""),
  giteeToken: process.env.GITEE_TOKEN ?? "",
  giteeWebhookSecret: process.env.GITEE_WEBHOOK_SECRET ?? "",
  giteeRepo: process.env.GITEE_REPO ?? "",
  giteeDefaultBranch: process.env.GITEE_DEFAULT_BRANCH ?? "main",
  feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL ?? "",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "local-development-session-secret",
  isProduction: process.env.NODE_ENV === "production"
};

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
