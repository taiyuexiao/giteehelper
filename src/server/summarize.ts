/**
 * 通知卡片的行为概要：用 OpenAI 兼容的大模型把「这次活动做了什么」总结成一句话。
 *
 * 设计约束（都来自生产教训）：
 * - 绝不让概要挂掉通知：未配置、超时、限流、返回畸形，一律回退到确定性摘要（卡片不写概要行）；
 * - 只在 WebHook 的后台分析链路里调用——确认 202 已先返回给 Gitee，概要的延迟不影响回调；
 * - 提示词只喂标题/描述/文件列表等元数据，不喂代码内容。
 */
import { config } from "./config.js";

export interface SummarizeInput {
  /** 事件类型：push / pull_request / note / issue */
  eventType: string;
  title: string;
  /** 提交正文 / PR 描述 / 评论内容，超长截断 */
  body?: string;
  /** 变更文件路径（最多取 30 条） */
  files?: string[];
  /** 一次 push 带多个提交时逐条列出主题 */
  commitSubjects?: string[];
  branch?: string | null;
}

const BODY_LIMIT = 1500;

export function buildSummarizePrompt(input: SummarizeInput): string {
  const parts: string[] = [`类型：${input.eventType}`, `标题：${input.title.slice(0, 300)}`];
  if (input.branch) parts.push(`分支：${input.branch}`);
  if (input.commitSubjects?.length) {
    parts.push(`提交：\n${input.commitSubjects.slice(0, 10).map((subject) => `- ${subject.slice(0, 200)}`).join("\n")}`);
  }
  if (input.body?.trim()) parts.push(`描述：\n${input.body.trim().slice(0, BODY_LIMIT)}`);
  if (input.files?.length) {
    parts.push(`变更文件：\n${input.files.slice(0, 30).join("\n")}`);
  }
  return parts.join("\n");
}

/** 未配置大模型服务时直接返回 null，调用方就不写概要行 */
export async function summarizeActivity(input: SummarizeInput): Promise<string | null> {
  if (!config.llmApiKey || !config.llmApiBase) return null;
  const prompt = buildSummarizePrompt(input);
  try {
    const response = await fetch(`${config.llmApiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`
      },
      body: JSON.stringify({
        model: config.llmModel,
        messages: [
          {
            role: "system",
            content: "你是研发协作助手的摘要器。用一句不超过 60 字的简体中文概括这次代码活动的实际内容与目的：做了什么、为什么、大致影响面。只输出这句话本身，不要任何前缀、引号或列表。"
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 160
      }),
      // 概要值得等，但不能无限等：超时回退到不带概要的卡片
      signal: AbortSignal.timeout(25_000)
    });
    if (!response.ok) return null;
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim().replace(/^["「『]|["」』]$/g, "");
    return text ? text.slice(0, 120) : null;
  } catch {
    return null;
  }
}
