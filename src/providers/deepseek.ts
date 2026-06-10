/**
 * DeepSeek 提供商 —— 通过官方 API 查询账户权益和模型列表
 * API 文档参考: https://platform.deepseek.com/api-docs
 */

import * as https from 'https';
import { BaseProvider, BalanceInfo, UsageEntry, ProviderConfig } from './base';

/** balance API 返回的 data 是数组，取第一项 */
interface DeepSeekBalanceResponse {
  is_available: boolean;
  balance_infos: Array<{
    currency: string;
    total_balance: number | string;
    granted_balance: number | string;
    topped_up_balance: number | string;
  }>;
}

interface DeepSeekUsageItem {
  request_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens: number;
  prompt_cache_miss_tokens: number;
  total_cost: number;
  created_at: number;
  is_cache_hit: boolean;
}

interface DeepSeekModelsResponse {
  data?: Array<{
    id: string;
    object?: string;
    owned_by?: string;
  }>;
}

export function mapDeepSeekBalanceResponse(data: DeepSeekBalanceResponse, fetchedAt: number = Date.now()): BalanceInfo | null {
  if (!data.is_available || !data.balance_infos?.length) {
    return null;
  }

  const info = data.balance_infos[0];
  const toppedUpBalance = Number(info.topped_up_balance) || 0;
  const totalBalance = Number(info.total_balance) || 0;
  const grantedBalance = Number(info.granted_balance) || 0;
  const currency = info.currency || 'CNY';
  const items = [
    {
      label: '充值余额',
      value: formatMoney(toppedUpBalance, currency),
      rawValue: toppedUpBalance,
      unit: currency,
    },
  ];
  if (grantedBalance > 0) {
    items.push({
      label: '赠送余额',
      value: formatMoney(grantedBalance, currency),
      rawValue: grantedBalance,
      unit: currency,
    });
  }

  return {
    kind: 'balance',
    label: '账户余额',
    primaryLabel: '可用余额',
    primaryValue: totalBalance,
    displayValue: formatMoney(totalBalance, currency),
    items,
    source: '/user/balance',
    confidence: 'official',
    balance: totalBalance,
    giftBalance: grantedBalance,
    currency,
    fetchedAt,
  };
}

function httpsGet(url: string, apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`DeepSeek API 返回 ${res.statusCode ?? '未知状态'}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`解析 DeepSeek 响应失败: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.end();
  });
}

export class DeepSeekProvider extends BaseProvider {
  constructor(config?: Partial<ProviderConfig>) {
    super({
      id: 'deepseek',
      name: 'DeepSeek',
      displayName: 'DeepSeek',
      type: 'api',
      apiBase: 'https://api.deepseek.com',
      entitlementKind: 'balance',
      capabilities: {
        entitlement: true,
        usageApi: false,
        interceptParser: 'openai',
        cacheMetrics: true,
        pricing: true,
      },
      models: ['deepseek-chat', 'deepseek-reasoner'],
      ...config,
    });

    // 默认定价 (deepseek-chat 缓存命中 ¥0.1/M)
    this.setPricing('deepseek-chat', {
      input: 1.0,
      output: 2.0,
      currency: 'CNY',
      cacheHitDiscount: 0.1,
    });
    this.setPricing('deepseek-reasoner', {
      input: 4.0,
      output: 16.0,
      currency: 'CNY',
    });
  }

  async fetchBalance(apiKey: string): Promise<BalanceInfo | null> {
    try {
      const data = await httpsGet(
        `${this.config.apiBase}/user/balance`,
        apiKey
      ) as DeepSeekBalanceResponse;
      return mapDeepSeekBalanceResponse(data);
    } catch (e) {
      console.error('[TokenLens] 获取余额失败:', e);
      throw e;
    }
  }

  async fetchModels(apiKey: string): Promise<Array<{ id: string; ownedBy?: string }>> {
    const data = await httpsGet(
      `${this.config.apiBase}/models`,
      apiKey
    ) as DeepSeekModelsResponse;

    return (data.data ?? []).map((model) => ({
      id: model.id,
      ownedBy: model.owned_by,
    }));
  }

  async fetchRecentUsage(apiKey: string, days: number = 7): Promise<UsageEntry[]> {
    // DeepSeek 官方 API 目前只公开账户权益查询，没有近期用量查询端点。
    // 用量数据依赖 HTTP 拦截或本地日志解析，避免轮询不存在的 /v1/usage 导致 404 误报。
    return [];
  }

  /** DeepSeek 是纯 API 模式，不实现本地解析 */
  async parseLocalUsage(_paths: string[]): Promise<UsageEntry[]> {
    return [];
  }

}

function formatMoney(value: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : '¥';
  if (value === 0) { return `${symbol}0`; }
  if (Math.abs(value) < 0.01) { return `${symbol}${value.toFixed(4)}`; }
  if (Math.abs(value) < 1) { return `${symbol}${value.toFixed(3)}`; }
  return `${symbol}${value.toFixed(2)}`;
}
