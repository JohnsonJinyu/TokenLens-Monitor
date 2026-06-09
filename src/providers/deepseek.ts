/**
 * DeepSeek 提供商 —— 通过 API 实时查询余额和用量
 * API 文档参考: https://platform.deepseek.com/api-docs
 */

import * as https from 'https';
import { BaseProvider, BalanceInfo, UsageEntry, ProviderConfig } from './base';

/** balance API 返回的 data 是数组，取第一项 */
interface DeepSeekBalanceResponse {
  is_available: boolean;
  balance_infos: Array<{
    currency: string;
    total_balance: number;
    granted_balance: number;
    topped_up_balance: number;
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

function httpsGet(url: string, apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
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
      name: 'DeepSeek',
      type: 'api',
      apiBase: 'https://api.deepseek.com',
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

      if (!data.is_available || !data.balance_infos?.length) {
        return null;
      }

      const info = data.balance_infos[0];
      return {
        totalCharged: info.topped_up_balance,
        totalUsed: info.topped_up_balance - info.total_balance + info.granted_balance,
        balance: info.total_balance,
        giftBalance: info.granted_balance,
        currency: info.currency,
        fetchedAt: Date.now(),
      };
    } catch (e) {
      console.error('[DeepSeek Monitor] 获取余额失败:', e);
      return null;
    }
  }

  async fetchRecentUsage(apiKey: string, days: number = 7): Promise<UsageEntry[]> {
    try {
      const endTime = Math.floor(Date.now() / 1000);
      const startTime = endTime - days * 86400;

      const data = await httpsGet(
        `${this.config.apiBase}/v1/usage?start_time=${startTime}&end_time=${endTime}&page_size=100`,
        apiKey
      );

      const items: DeepSeekUsageItem[] = data.data ?? [];
      return items.map((item) => ({
        timestamp: item.created_at * 1000,
        provider: this.config.name,
        model: item.model,
        promptTokens: item.prompt_tokens,
        completionTokens: item.completion_tokens,
        cacheHitTokens: item.prompt_cache_hit_tokens,
        cacheMissTokens: item.prompt_cache_miss_tokens,
        cost: parseFloat(String(item.total_cost)) || 0,
        endpoint: '/v1/chat/completions',
      }));
    } catch (e) {
      console.error('[DeepSeek Monitor] 获取用量记录失败:', e);
      return [];
    }
  }

  /** DeepSeek 是纯 API 模式，不实现本地解析 */
  async parseLocalUsage(_paths: string[]): Promise<UsageEntry[]> {
    return [];
  }
}
