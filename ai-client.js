/**
 * AI 统一客户端 —— window.AIProxy
 * 封装对 Supabase Edge Function `ai-proxy` 的所有调用，前端代码严禁出现任何模型 API Key。
 * 本文件假设全局已存在 window.SUPABASE_URL 与 window.SUPABASE_KEY（由 supabase-config.js 提供）。
 */

/**
 * 从 localStorage 提取用户登录态的 access_token。
 * Supabase 在 localStorage 中存储的 key 形如 "sb-<project-ref>-auth-token"，
 * 因此遍历所有 key，用通配匹配找出该 token；若用户未登录，则回退到匿名公钥，
 * 保证即使未登录也能触发部分允许匿名访问的 Edge Function。
 */
function getAuthToken() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && /^sb-.*-auth-token$/.test(key)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.access_token === 'string' && parsed.access_token.length > 0) {
            return parsed.access_token;
          }
        }
      }
    }
  } catch (err) {
    // localStorage 遍历或 JSON 解析失败时不应阻塞流程，静默降级即可
    console.warn('读取登录态 token 失败，将使用匿名密钥:', err);
  }
  return typeof window.SUPABASE_KEY === 'string' ? window.SUPABASE_KEY : '';
}

/**
 * 底层统一请求函数：所有 AI 能力均通过此函数转发到 Supabase Edge Function。
 * @param {string} service - 服务标识（chat / vision / tts / asr / embed / quota）
 * @param {object} payload - 业务载荷
 * @param {number} timeoutMs - 超时毫秒数
 * @returns {Promise<object>} 后端返回的 data 字段
 */
async function callAI(service, payload, timeoutMs) {
  // 校验前置依赖，防止因配置缺失导致白屏或空指针
  if (!window.SUPABASE_URL) {
    throw new Error('系统配置异常：SUPABASE_URL 未设置，请联系管理员。');
  }

  const url = `${window.SUPABASE_URL}/functions/v1/ai-proxy`;
  const token = getAuthToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ service, payload })
    });

    clearTimeout(timer);

    let result;
    try {
      result = await response.json();
    } catch (parseErr) {
      // 后端返回的不是合法 JSON，兜底提示避免白屏
      throw new Error('AI 服务返回数据异常，请稍后重试。');
    }

    if (!response.ok) {
      // 后端通常会返回 { error: '...' }，尤其是 429 额度用尽等场景，
      // 需要把原文抛给上层，让 UI 原样展示给用户，提升透明度。
      const message = result && typeof result.error === 'string'
        ? result.error
        : `AI 服务请求失败（状态码 ${response.status}），请稍后重试。`;
      throw new Error(message);
    }

    return result;
  } catch (err) {
    clearTimeout(timer);

    if (err.name === 'AbortError') {
      // AbortController 触发说明请求耗时超过 timeoutMs
      throw new Error('AI 服务响应超时，请检查网络后重试');
    }

    if (err.message && (
      err.message.includes('fetch') ||
      err.message.includes('network') ||
      err.message.includes('Failed to fetch') ||
      err.message.includes('NetworkError')
    )) {
      // 浏览器断网或 DNS 失败等网络层异常
      throw new Error('网络连接失败，请检查网络后重试');
    }

    // 其余错误（含后端明确返回的 error 字段）直接上抛，保持信息完整
    throw err;
  }
}

/**
 * 通用对话服务
 * @param {Array} messages - 消息数组，格式遵循 OpenAI Chat 标准
 * @param {object} [opts={}] - 可选参数
 * @param {string} [opts.mode] - 'fast' 表示使用快模型；不传或传其他值使用强模型
 * @returns {Promise<string>} AI 回复的文本内容
 */
async function chat(messages, opts = {}) {
  const payload = {
    messages,
    mode: opts.mode // 'fast' 或不传，由后端决定模型路由
  };
  const data = await callAI('chat', payload, 100000);
  return data.content;
}

/**
 * 多模态视觉对话服务（支持图片输入）
 * @param {Array} messages - 消息数组，其中可包含 { type: 'image_url', image_url: { url: base64DataURL } }
 * @returns {Promise<string>} AI 回复的文本内容
 */
async function vision(messages) {
  const payload = { messages };
  const data = await callAI('vision', payload, 100000);
  return data.content;
}

/**
 * 文本转语音服务（TTS）
 * @param {string} text - 要合成的文本
 * @param {string} [voice] - 音色名称，可选 Cherry / Serena / Ethan / Chelsie
 * @returns {Promise<string>} 合成后的音频 URL
 */
async function tts(text, voice) {
  const payload = { text, voice };
  const data = await callAI('tts', payload, 45000);
  return data.url;
}

/**
 * 语音识别服务（ASR）
 * @param {string} audioDataURL - base64 Data URL 格式的音频数据（建议 ≤ 10MB）
 * @param {string} [context] - 热词上下文文本，用于提升专业术语识别准确率
 * @returns {Promise<string>} 识别后的文本
 */
async function asr(audioDataURL, context) {
  const payload = { audio: audioDataURL, context };
  const data = await callAI('asr', payload, 60000);
  return data.text;
}

/**
 * 文本向量化服务（Embedding）
 * @param {string|string[]} texts - 单个文本或文本数组
 * @returns {Promise<number[][]>} 向量数组；若输入单条文本，返回结果也是二维数组中的一条
 */
async function embed(texts) {
  const payload = {
    texts: Array.isArray(texts) ? texts : [texts]
  };
  const data = await callAI('embed', payload, 30000);
  return data.embeddings;
}

/**
 * 查询当前用户 AI 额度使用情况
 * @returns {Promise<{used: number, limit: number}>}
 */
async function quota() {
  const payload = {};
  const data = await callAI('quota', payload, 15000);
  return { used: data.used, limit: data.limit };
}

// 挂载到全局，供各页面统一调用
window.AIProxy = { chat, vision, tts, asr, embed, quota };
