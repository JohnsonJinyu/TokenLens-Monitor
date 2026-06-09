/**
 * HTTP 请求拦截器 —— Monkey-patch https.request 来捕获所有 LLM API 调用。
 *
 * VSCode 所有扩展共享同一 Node.js 进程，我们可以拦截其他扩展（Continue、Cline、
 * Copilot Chat 等）发送给 DeepSeek/OpenAI 等 LLM API 的 HTTPS 请求，
 * 从中提取 token 用量数据，无需用户提供 API Key。
 *
 * 技术要点：
 *  - 使用 require 直接操作 Node.js 模块缓存（不能用 import * as，那是本地副本）
 *  - 只拦截已知 LLM API endpoint 的 /chat/completions /messages 路径
 *  - 支持流式 (SSE) 和非流式响应
 *  - 透明转发 —— 拦截器内的错误绝不影响原始请求
 *  - 扩展停用时恢复原始 https.request / https.get
 */

import type { UsageEntry } from '../providers/base';

// 使用 require 直接访问 Node.js 模块缓存（确保 patch 对所有扩展生效）
const httpsModule = require('https') as typeof import('https');

// ============================================================
// 已知 LLM API 主机名
// ============================================================
const KNOWN_LLM_HOSTS = [
  'api.deepseek.com',
  'api.openai.com',
  'api.anthropic.com',
  'api.moonshot.cn',
  'api.baichuan-ai.com',
  'open.bigmodel.cn',
  'api.siliconflow.cn',
  'dashscope.aliyuncs.com',
  'api.minimax.chat',
  'api.zhipuai.cn',
  'ark.cn-beijing.volces.com',   // 火山引擎 (豆包)
  'api.stepfun.com',              // 阶跃星辰
  'api.lingyiwanwu.com',          // 零一万物
  'generativelanguage.googleapis.com', // Gemini
];

// 拦截的 API 路径关键词
const LLM_PATH_KEYWORDS = ['/chat/completions', '/messages', '/v1/completions'];

// ============================================================
// 默认定价表（每百万 token 价格）
// ============================================================
interface PricingEntry {
  input: number;
  output: number;
  currency: string;
  cacheHitDiscount?: number;
}

const DEFAULT_PRICING: Record<string, PricingEntry> = {
  'deepseek-chat':     { input: 1.0,  output: 2.0,  currency: 'CNY', cacheHitDiscount: 0.1 },
  'deepseek-reasoner': { input: 4.0,  output: 16.0, currency: 'CNY' },
  'deepseek-v3':       { input: 1.0,  output: 2.0,  currency: 'CNY', cacheHitDiscount: 0.1 },
  'deepseek-r1':       { input: 4.0,  output: 16.0, currency: 'CNY' },
  'gpt-4o':            { input: 2.5,  output: 10.0, currency: 'USD' },
  'gpt-4o-mini':       { input: 0.15, output: 0.6,  currency: 'USD' },
  'gpt-4-turbo':       { input: 10.0, output: 30.0, currency: 'USD' },
  'claude-3-opus':     { input: 15.0, output: 75.0, currency: 'USD' },
  'claude-3.5-sonnet': { input: 3.0,  output: 15.0, currency: 'USD' },
  'claude-3.5-haiku':  { input: 0.8,  output: 4.0,  currency: 'USD' },
};

// ============================================================
// 全局状态
// ============================================================
let originalHttpsRequest: typeof httpsModule.request;
let interceptEnabled = false;
let onUsageDetected: ((entry: UsageEntry) => void) | null = null;

/** 去重 —— 防止同一个请求被记录多次 */
const seenFingerprints = new Set<string>();
const MAX_FINGERPRINTS = 5000;

/** 用户自定义定价（从配置注入） */
let customPricing: Record<string, PricingEntry> = {};

// ============================================================
// 公开 API
// ============================================================

export function startInterception(opts: {
  onUsage: (entry: UsageEntry) => void;
  pricing?: Record<string, PricingEntry>;
}): void {
  if (interceptEnabled) { return; }

  onUsageDetected = opts.onUsage;
  if (opts.pricing) {
    customPricing = opts.pricing;
  }

  // 保存原始函数引用
  originalHttpsRequest = httpsModule.request;

  // 替换 https.request（直接操作 require 缓存，对所有扩展生效）
  const interceptor = createInterceptor();
  (httpsModule as any).request = interceptor;
  // 同时替换 https.get（以防某些库直接调用 get）
  (httpsModule as any).get = function (this: any, ...args: any[]): any {
    const req = (interceptor as any).apply(this, args);
    req.end();
    return req;
  };

  interceptEnabled = true;
  console.log('[DeepSeek Monitor] 🔍 HTTP 拦截器已启动');
}

export function stopInterception(): void {
  if (!interceptEnabled) { return; }

  (httpsModule as any).request = originalHttpsRequest;
  // 恢复 https.get（让它重新使用原始的 request）
  (httpsModule as any).get = function (this: any, ...args: any[]): any {
    const req = (originalHttpsRequest as any).apply(this, args);
    req.end();
    return req;
  };
  interceptEnabled = false;
  onUsageDetected = null;
  seenFingerprints.clear();
  console.log('[DeepSeek Monitor] 🔍 HTTP 拦截器已停止');
}

export function isIntercepting(): boolean {
  return interceptEnabled;
}

export function updatePricing(pricing: Record<string, PricingEntry>): void {
  customPricing = { ...pricing };
}

// ============================================================
// 拦截器实现
// ============================================================

function createInterceptor(): typeof httpsModule.request {
  return function (this: any, ...args: any[]): any {
    // ---- 解析参数（兼容多种调用签名）----
    let urlOrOpts: any;
    let callback: ((res: any) => void) | undefined;

    if (typeof args[0] === 'string') {
      urlOrOpts = new URL(args[0]);
      callback = args[1];
    } else {
      urlOrOpts = args[0];
      callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    }

    const hostname: string = urlOrOpts.hostname || urlOrOpts.host || '';
    const pathname: string = urlOrOpts.pathname || urlOrOpts.path || '';

    // ---- 检查是否是需要拦截的请求 ----
    const isLLMHost = KNOWN_LLM_HOSTS.some((h) => hostname.includes(h) || h.includes(hostname));
    const isLLMPath = LLM_PATH_KEYWORDS.some((k) => pathname.includes(k));

    if (!isLLMHost || !isLLMPath) {
      // 非目标请求 → 透明转发
      return (originalHttpsRequest as any).apply(this, args);
    }

    // ---- 拦截目标请求 ----
    let requestBody = '';
    let model = 'unknown';

    // 创建请求
    const req = (originalHttpsRequest as any).apply(this, args);

    // ---- 拦截 req.write 以捕获请求体 ----
    const origWrite = req.write.bind(req);
    const origEnd = req.end.bind(req);

    (req as any).write = function (this: any, chunk: any, encoding?: any, cb?: any): boolean {
      if (chunk) {
        const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
        requestBody += str;
      }
      return origWrite(chunk, encoding, cb);
    };

    (req as any).end = function (this: any, chunk?: any, encoding?: any, cb?: any): any {
      if (chunk) {
        const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
        requestBody += str;
      }
      return origEnd(chunk, encoding, cb);
    };

    // ---- 拦截响应以捕获 usage ----
    req.on('response', (res: any) => {
      let responseBody = '';

      res.on('data', (chunk: Buffer) => {
        responseBody += chunk.toString('utf-8');
      });

      res.on('end', () => {
        // 尝试解析请求体中的 model
        try {
          const reqJson = JSON.parse(requestBody);
          if (reqJson.model) {
            model = reqJson.model;
          }
        } catch {
          // 忽略 JSON 解析错误
        }

        // 尝试提取 usage 数据
        const entry = extractUsage(responseBody, model, hostname, pathname);
        if (entry) {
          processEntry(entry);
        }
      });

      res.on('error', () => {
        // 忽略响应错误
      });
    });

    req.on('error', () => {
      // 忽略请求错误
    });

    return req;
  };
}

// ============================================================
// Usage 提取逻辑（支持流式 SSE & 非流式 JSON）
// ============================================================

function extractUsage(
  body: string,
  model: string,
  hostname: string,
  pathname: string,
): UsageEntry | null {
  try {
    // 尝试直接 JSON 解析（非流式响应）
    if (body.trim().startsWith('{')) {
      const json = JSON.parse(body);
      if (json.usage) {
        return buildEntry(json, model, hostname, pathname);
      }
    }

    // 尝试 SSE 流式解析
    if (body.includes('data:')) {
      return extractStreamUsage(body, model, hostname, pathname);
    }
  } catch {
    // 解析失败
  }
  return null;
}

function extractStreamUsage(
  body: string,
  model: string,
  hostname: string,
  pathname: string,
): UsageEntry | null {
  const lines = body.split('\n');
  let usageData: any = null;

  // 遍历所有 SSE 事件，找到包含 usage 的最后一个
  for (const line of lines) {
    if (!line.startsWith('data:')) { continue; }

    const jsonStr = line.slice(5).trim();
    if (!jsonStr || jsonStr === '[DONE]') { continue; }

    try {
      const event = JSON.parse(jsonStr);
      if (event.usage) {
        usageData = event.usage;
      }
      // DeepSeek 流式: choices[0].delta 或 choices[0].message 中没有 usage
      // OpenAI 流式: usage 在单独的 chunk 中
      // 所以继续解析后续行
    } catch {
      // skip malformed JSON
    }
  }

  if (usageData) {
    return buildEntry({ usage: usageData }, model, hostname, pathname);
  }

  return null;
}

function buildEntry(
  response: any,
  model: string,
  hostname: string,
  pathname: string,
): UsageEntry {
  const usage = response.usage || {};
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;

  // 缓存 hit/miss tokens
  const details = usage.prompt_tokens_details || usage.completion_tokens_details || {};
  let cacheHitTokens = details.cached_tokens || 0;
  // 某些 API 使用 prompt_cache_hit_tokens / prompt_cache_miss_tokens
  if (!cacheHitTokens && usage.prompt_cache_hit_tokens) {
    cacheHitTokens = usage.prompt_cache_hit_tokens;
  }
  const cacheMissTokens = usage.prompt_cache_miss_tokens || (promptTokens - cacheHitTokens);

  // 推断 provider 名称
  let provider = hostname;
  if (hostname.includes('deepseek')) { provider = 'DeepSeek'; }
  else if (hostname.includes('openai')) { provider = 'OpenAI'; }
  else if (hostname.includes('anthropic')) { provider = 'Anthropic'; }
  else if (hostname.includes('siliconflow')) { provider = 'SiliconFlow'; }
  else if (hostname.includes('moonshot')) { provider = 'Moonshot'; }
  else if (hostname.includes('bigmodel')) { provider = 'Zhipu'; }
  else if (hostname.includes('dashscope')) { provider = 'Qwen'; }

  // 计算费用
  const cost = calculateCost(model, promptTokens, completionTokens, cacheHitTokens);

  return {
    timestamp: Date.now(),
    provider,
    model,
    promptTokens,
    completionTokens,
    cacheHitTokens,
    cacheMissTokens,
    cost,
    endpoint: pathname,
  };
}

// ============================================================
// 费用计算
// ============================================================

function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheHitTokens: number,
): number {
  // 先查用户自定义定价，再查默认定价
  let pricing: PricingEntry | undefined = customPricing[model];
  if (!pricing) {
    pricing = DEFAULT_PRICING[model];
  }

  if (!pricing) {
    // 未知模型 → 根据 hostname 使用粗略估算
    // 默认: 输入 $0.5/M, 输出 $2/M
    const inputCost = (promptTokens / 1_000_000) * 0.5;
    const outputCost = (completionTokens / 1_000_000) * 2;
    return inputCost + outputCost;
  }

  let inputCost = (promptTokens / 1_000_000) * pricing.input;

  // 缓存命中折扣
  if (cacheHitTokens > 0 && pricing.cacheHitDiscount) {
    const hitCost = (cacheHitTokens / 1_000_000) * pricing.input * pricing.cacheHitDiscount;
    const missCost = ((promptTokens - cacheHitTokens) / 1_000_000) * pricing.input;
    inputCost = hitCost + missCost;
  }

  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// ============================================================
// 去重 & 投递
// ============================================================

function processEntry(entry: UsageEntry): void {
  if (!onUsageDetected) { return; }

  // 生成去重指纹
  const fp = `${entry.provider}-${entry.model}-${entry.promptTokens}-${entry.completionTokens}-${Math.floor(entry.timestamp / 1000)}`;
  if (seenFingerprints.has(fp)) { return; }
  seenFingerprints.add(fp);

  // 限制去重集大小
  if (seenFingerprints.size > MAX_FINGERPRINTS) {
    const arr = Array.from(seenFingerprints).slice(-MAX_FINGERPRINTS / 2);
    seenFingerprints.clear();
    arr.forEach((f) => seenFingerprints.add(f));
  }

  try {
    onUsageDetected(entry);
  } catch (e) {
    console.error('[DeepSeek Monitor] 用量回调异常:', e);
  }
}
