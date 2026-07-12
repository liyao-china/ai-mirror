import { createClient } from "npm:@supabase/supabase-js@2";

/* =============================================================================
 * AI面镜 · ai-proxy Edge Function（全站唯一 AI 代理）
 * -----------------------------------------------------------------------------
 * 【为什么密钥只在服务端】
 *   前端只持有 Supabase 匿名公钥（无计费、无模型调用能力），所有真实模型调用都
 *   收敛到这里。DASHSCOPE_API_KEY 仅通过 Deno.env 读取，永不下发给浏览器，这样
 *   即使前端代码被完全下载，攻击者也拿不到阿里云百炼密钥，无法盗刷。
 *
 * 【为什么额度按身份原子扣减】
 *   面试场景下用户可能并发触发多个 AI 请求（如连续语音识别）。若先「读额度」再
 *   「扣额度」，两步之间存在竞态窗口，并发请求会同时读到未超限、同时放行，导致
 *   超额。因此统一调用数据库 RPC bump_ai_usage，在 Postgres 内用单条
 *   UPDATE...RETURNING 原子累加并返回当日新总量，再由本函数判断是否超限——整个
 *   「扣减+取量」是不可分割的一次事务，杜绝并发超额。身份维度（user:{id} 或
 *   ip:{x}）则保证登录用户与匿名访客各自独立计数，互不影响。
 * =================================================================================== */

// ===== 环境变量（已在 Supabase secrets 配好，代码中不出现明文） =====
const DASHSCOPE_API_KEY = Deno.env.get("DASHSCOPE_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ===== 上游端点 =====
// 对话 / 向量走 OpenAI 兼容端点；语音（TTS/ASR）走原生多模态端点
const CHAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const EMBED_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const MULTIMODAL_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

// ===== 模型（服务端写死，客户端不可指定，防止越权调用昂贵模型） =====
const MODEL_CHAT_FAST = "qwen-plus"; // payload.mode==='fast' 时（逐轮提问/小结）
const MODEL_CHAT_STRONG = "qwen3.7-plus"; // 缺省强模型（报告生成）
const MODEL_VISION = "qwen-vl-max";
const MODEL_TTS = "qwen3-tts-flash";
const MODEL_ASR = "qwen3-asr-flash";
const MODEL_EMBED = "text-embedding-v3";

// TTS 音色白名单，非法值回退第一个
const VOICE_WHITELIST = ["Cherry", "Serena", "Ethan", "Chelsie"];

// ===== 额度上限与计费单位 =====
const LIMIT_LOGGED = 105; // 登录用户 105 单位/天
const LIMIT_ANON = 35; // 匿名访客 35 单位/天
const COST_MAP: Record<string, number> = {
  chat: 1,
  vision: 2,
  tts: 1,
  asr: 1,
  embed: 1,
};

// ASR 为空 context 时的默认热词句（中文面试口语、常见岗位与技术术语、公司名）
const DEFAULT_ASR_CONTEXT =
  "中文面试口语常见词汇：自我介绍、项目经验、技术栈、团队协作、职业规划、优缺点、" +
  "离职原因、期望薪资、抗压能力、沟通能力。常见岗位：前端工程师、后端工程师、全栈工程师、" +
  "产品经理、Java工程师、Python工程师、Go工程师、算法工程师、数据分析师、UI设计师、" +
  "测试工程师、运维工程师、架构师。常见技术术语：React、Vue、TypeScript、Node.js、" +
  "微服务、分布式、MySQL、Redis、Docker、Kubernetes、CI/CD、API、RESTful、GraphQL、" +
  "WebSocket、Spring、中间件、高并发。常见公司名：阿里巴巴、腾讯、字节跳动、百度、" +
  "美团、京东、华为、小米、网易、拼多多、快手、滴滴、微软、谷歌。";

// service client（service_role，可绕过 RLS 做 auth.getUser 验签与 RPC 计费）
const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ===== 工具：自定义 HTTP 错误 =====
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ===== CORS：白名单 Origin =====
function isAllowedOrigin(origin: string | null): boolean {
  // 空 / null（file:// 调试）放行
  if (!origin || origin === "null") return true;
  if (origin === "https://liyao-china.github.io") return true;
  // 任意端口的 localhost / 127.0.0.1（本地开发）
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (isAllowedOrigin(origin)) {
    // 回显具体 Origin；file:// 时 Origin 为 "null"，用 * 兜底
    headers["Access-Control-Allow-Origin"] =
      origin && origin !== "null" ? origin : "*";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "authorization, content-type";
  }
  // 非白名单 Origin 不附加 CORS 头，回落默认（浏览器跨域拦截）
  return headers;
}

// ===== JSON 响应 =====
function jsonResp(
  status: number,
  body: unknown,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

// ===== JWT payload 解码（仅解 payload 看 role，验签交给 auth.getUser） =====
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "="; // 补齐 padding
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

// ===== 身份解析：登录用户 → user:{id}；匿名 → ip:{x-forwarded-for} =====
async function resolveIdentity(
  authHeader: string | null,
  fwdFor: string | null,
): Promise<{ identity: string; isLogged: boolean }> {
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const payload = decodeJwtPayload(token);
      // role==='authenticated' 才是真实用户 JWT（anon key 的 role 是 'anon'）
      if (payload && payload.role === "authenticated") {
        try {
          // service client 验签拿真实 user.id
          const { data, error } = await sbAdmin.auth.getUser(token);
          if (!error && data?.user?.id) {
            return { identity: `user:${data.user.id}`, isLogged: true };
          }
        } catch {
          // 验签失败静默降级为匿名
        }
      }
    }
  }
  // 匿名：取 x-forwarded-for 第一个 IP
  const ip = fwdFor ? fwdFor.split(",")[0].trim() : "unknown";
  return { identity: `ip:${ip || "unknown"}`, isLogged: false };
}

function resolveLimit(isLogged: boolean): number {
  return isLogged ? LIMIT_LOGGED : LIMIT_ANON;
}

// ===== 计费：原子累加并取当日总量 =====
async function bumpUsage(
  identity: string,
  cost: number,
  isLogged: boolean,
): Promise<{ used: number; limit: number }> {
  const { data, error } = await sbAdmin.rpc("bump_ai_usage", {
    p_identity: identity,
    p_cost: cost,
  });
  if (error) throw new HttpError(500, "额度服务异常，请稍后再试");
  // 兼容 RPC 返回数字或 {used, limit} 两种形态
  if (typeof data === "number") {
    return { used: data, limit: resolveLimit(isLogged) };
  }
  if (data && typeof data === "object") {
    return {
      used: Number(data.used) || 0,
      limit: data.limit != null ? Number(data.limit) : resolveLimit(isLogged),
    };
  }
  return { used: 0, limit: resolveLimit(isLogged) };
}

// ===== quota：不扣费，仅查询当日用量 =====
async function handleQuota(
  identity: string,
  isLogged: boolean,
): Promise<{ used: number; limit: number }> {
  const { data, error } = await sbAdmin.rpc("get_ai_usage", {
    p_identity: identity,
  });
  if (error) throw new HttpError(500, "额度服务异常，请稍后再试");
  if (data && typeof data === "object") {
    return {
      used: Number(data.used) || 0,
      limit: data.limit != null ? Number(data.limit) : resolveLimit(isLogged),
    };
  }
  return {
    used: typeof data === "number" ? data : 0,
    limit: resolveLimit(isLogged),
  };
}

// ===== 上游统一封装：POST + Bearer，90s 超时，非 2xx 或带 error/code 抛错 =====
async function callUpstream(url: string, body: unknown): Promise<any> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });

  let data: any;
  try {
    data = await resp.json();
  } catch {
    throw new Error("AI 服务返回数据异常");
  }

  // 非 2xx，或返回体带 error / code 字段，视为上游失败
  if (!resp.ok || data?.error || data?.code) {
    const msg =
      data?.error?.message ||
      data?.message ||
      (typeof data?.error === "string" ? data.error : "") ||
      "AI 服务暂时不可用";
    throw new Error(msg);
  }
  return data;
}

// ===== 服务 1：chat =====
async function handleChat(payload: any): Promise<{ content: string }> {
  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpError(400, "对话内容不能为空");
  }
  if (JSON.stringify(messages).length > 200000) {
    throw new HttpError(400, "对话内容过长");
  }
  const model = payload?.mode === "fast" ? MODEL_CHAT_FAST : MODEL_CHAT_STRONG;
  // qwen3 系列默认开启思考，显式关闭以降低延迟
  const data = await callUpstream(CHAT_URL, {
    model,
    messages,
    enable_thinking: false,
  });
  const content = data?.choices?.[0]?.message?.content;
  if (content == null) throw new Error("AI 未返回有效回复");
  return { content };
}

// ===== 服务 2：vision（多模态，走 OpenAI 兼容 chat 端点） =====
async function handleVision(payload: any): Promise<{ content: string }> {
  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpError(400, "视觉对话内容不能为空");
  }
  if (JSON.stringify(messages).length > 15_000_000) {
    throw new HttpError(400, "图片内容过大（限15MB）");
  }
  const data = await callUpstream(CHAT_URL, {
    model: MODEL_VISION,
    messages,
  });
  const content = data?.choices?.[0]?.message?.content;
  if (content == null) throw new Error("AI 未返回有效回复");
  return { content };
}

// ===== 服务 3：tts（原生多模态端点） =====
async function handleTts(payload: any): Promise<{ url: string }> {
  let text = typeof payload?.text === "string" ? payload.text : "";
  if (text.length > 600) text = text.slice(0, 600); // 截 600 字
  if (text.length === 0) throw new HttpError(400, "合成文本不能为空");
  let voice = payload?.voice;
  if (!VOICE_WHITELIST.includes(voice)) voice = VOICE_WHITELIST[0]; // 非法回退
  const data = await callUpstream(MULTIMODAL_URL, {
    model: MODEL_TTS,
    input: { text, voice, language_type: "Chinese" },
  });
  const url: string | undefined = data?.output?.audio?.url;
  if (!url) throw new Error("TTS 未返回音频");
  // http→https，防混合内容拦截（GitHub Pages 全站 https）
  return { url: url.replace(/^http:\/\//, "https://") };
}

// ===== 服务 4：asr（原生多模态端点） =====
async function handleAsr(payload: any): Promise<{ text: string }> {
  const audio = payload?.audio;
  if (
    typeof audio !== "string" ||
    !(audio.startsWith("data:audio/") || audio.startsWith("data:video/"))
  ) {
    throw new HttpError(400, "录音格式不正确");
  }
  if (audio.length > 13_000_000) {
    throw new HttpError(400, "录音过大（限10MB）");
  }
  let context = typeof payload?.context === "string" ? payload.context : "";
  if (context.length > 800) context = context.slice(0, 800);
  if (context.length === 0) context = DEFAULT_ASR_CONTEXT; // 空则用默认热词
  const data = await callUpstream(MULTIMODAL_URL, {
    model: MODEL_ASR,
    input: {
      messages: [
        { role: "system", content: [{ text: context }] },
        { role: "user", content: [{ audio }] },
      ],
    },
    parameters: { asr_options: { language: "zh", enable_itn: true } },
  });
  const contentArr = data?.output?.choices?.[0]?.message?.content;
  let text = "";
  if (Array.isArray(contentArr)) {
    // content 是数组，取含 text 字段的项
    const textItem = contentArr.find(
      (it: any) => it && typeof it.text === "string",
    );
    text = textItem?.text ?? "";
  } else if (typeof contentArr === "string") {
    text = contentArr;
  }
  return { text };
}

// ===== 服务 5：embed（OpenAI 兼容端点） =====
async function handleEmbed(
  payload: any,
): Promise<{ embeddings: number[][]; dim: number }> {
  let texts: unknown[] | undefined = payload?.texts;
  if (!Array.isArray(texts)) {
    // 兼容单条 text
    if (typeof payload?.text === "string") {
      texts = [payload.text];
    } else {
      throw new HttpError(400, "向量化文本不能为空");
    }
  }
  if (texts.length > 16) texts = texts.slice(0, 16);
  const input = texts.map((t) =>
    typeof t === "string" ? (t.length > 2000 ? t.slice(0, 2000) : t) : String(t),
  );
  const data = await callUpstream(EMBED_URL, {
    model: MODEL_EMBED,
    input,
    dimensions: 1024,
    encoding_format: "float",
  });
  // 按 index 排序后取向量
  const embeddings = (data?.data ?? [])
    .map((item: any, idx: number) => ({
      embedding: item.embedding,
      index: item.index ?? idx,
    }))
    .sort((a: any, b: any) => a.index - b.index)
    .map((item: any) => item.embedding);
  return { embeddings, dim: 1024 };
}

// ===== 主入口 =====
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);

  // OPTIONS 预检直接 200
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // 仅允许 POST
  if (req.method !== "POST") {
    return jsonResp(405, { error: "仅支持 POST 请求" }, corsHeaders);
  }

  // 解析请求体
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp(400, { error: "请求格式错误" }, corsHeaders);
  }

  const service = body?.service;
  const payload = body?.payload ?? {};

  // 解析身份
  const authHeader = req.headers.get("authorization");
  const fwdFor = req.headers.get("x-forwarded-for");
  let identity = "ip:unknown";
  let isLogged = false;
  try {
    const id = await resolveIdentity(authHeader, fwdFor);
    identity = id.identity;
    isLogged = id.isLogged;
  } catch {
    // 身份解析失败降级为匿名，不阻塞流程
  }

  try {
    // quota 不扣费
    if (service === "quota") {
      const result = await handleQuota(identity, isLogged);
      return jsonResp(200, result, corsHeaders);
    }

    const cost = COST_MAP[service];
    if (cost === undefined) {
      return jsonResp(400, { error: "不支持的服务类型" }, corsHeaders);
    }

    // 计费：先原子扣减再放行
    const usage = await bumpUsage(identity, cost, isLogged);
    if (usage.used > usage.limit) {
      const msg = isLogged
        ? "今日额度已用完，明天再来吧"
        : "今日免费额度已用完，登录后可获得更多额度";
      return jsonResp(429, { error: msg }, corsHeaders);
    }

    // 分发
    let result: unknown;
    switch (service) {
      case "chat":
        result = await handleChat(payload);
        break;
      case "vision":
        result = await handleVision(payload);
        break;
      case "tts":
        result = await handleTts(payload);
        break;
      case "asr":
        result = await handleAsr(payload);
        break;
      case "embed":
        result = await handleEmbed(payload);
        break;
      default:
        return jsonResp(400, { error: "不支持的服务类型" }, corsHeaders);
    }
    return jsonResp(200, result, corsHeaders);
  } catch (err) {
    // 自定义 HTTP 错误（400 等）
    if (err instanceof HttpError) {
      return jsonResp(err.status, { error: err.message }, corsHeaders);
    }
    // 上游异常统一 502
    const msg =
      err instanceof Error && err.message ? err.message : "AI 服务暂时不可用";
    return jsonResp(502, { error: msg }, corsHeaders);
  }
});
