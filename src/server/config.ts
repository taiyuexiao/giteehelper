import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

const root = process.cwd();

/** 未配置 SESSION_SECRET 时的回退值。它同时用于派生 Secret Store 的加密密钥，生产环境必须显式配置。 */
export const DEFAULT_SESSION_SECRET = "local-development-session-secret";

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
  // 通知里要给出可点击的控制台链接，因此需要知道自己的对外地址
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
  // 可选：OpenAI 兼容的大模型服务，用于通知卡片的「概要」。未配置时概要留空，不影响通知。
  llmApiBase: (process.env.LLM_API_BASE ?? "").replace(/\/$/, ""),
  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "glm-4-flash",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? DEFAULT_SESSION_SECRET,
  isProduction: process.env.NODE_ENV === "production"
};

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
