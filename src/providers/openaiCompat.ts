/**
 * OpenAI 兼容提供商 —— 通用适配层，支持所有兼容 OpenAI API 的服务。
 * 适用于：硅基流动、智谱、百川、Moonshot、零一万物 等国产模型。
 * 通过配置自定义 apiBase 和 pricing 来适配不同平台。
 */

import * as https from 'https';
import { BaseProvider, BalanceInfo, UsageEntry, ProviderConfig } from './base';

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
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('请求超时')); });
    req.end();
  });
}

export class OpenAICompatProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  /**
   * 尝试多种已知的余额查询端点
   */
  async fetchBalance(apiKey: string): Promise<BalanceInfo | null> {
    const base = this.config.apiBase!;

    // 各平台余额端点不统一，尝试多个已知路径
    const endpoints = [
      '/v1/dashboard/billing/subscription',
      '/dashboard/billing/subscription',
      '/v1/billing/usage',
      '/user/balance',
      '/v1/balance',
    ];

    for (const ep of endpoints) {
      try {
        const data = await httpsGet(`${base}${ep}`, apiKey);
        if (!data) {continue;}

        // OpenAI billing 格式
        if (data.hard_limit_usd !== undefined) {
          return {
            totalCharged: data.hard_limit_usd,
            totalUsed: data.total_usage ?? data.total_used ?? 0,
            balance: (data.hard_limit_usd - (data.total_usage ?? 0)),
            currency: 'USD',
            fetchedAt: Date.now(),
          };
        }
        // DeepSeek 兼容格式
        if (data.balance_infos) {
          const info = data.balance_infos[0];
          return {
            totalCharged: info.topped_up_balance,
            totalUsed: info.topped_up_balance - info.total_balance + (info.granted_balance || 0),
            balance: info.total_balance,
            giftBalance: info.granted_balance || 0,
            currency: info.currency || 'CNY',
            fetchedAt: Date.now(),
          };
        }
        // 通用格式
        if (typeof data.total_balance === 'number') {
          return {
            totalCharged: data.total_top_up ?? data.total_balance + (data.total_usage ?? 0),
            totalUsed: data.total_usage ?? 0,
            balance: data.total_balance,
            currency: data.currency ?? 'CNY',
            fetchedAt: Date.now(),
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  async fetchRecentUsage(apiKey: string, days: number = 7): Promise<UsageEntry[]> {
    try {
      const endTime = Math.floor(Date.now() / 1000);
      const startTime = endTime - days * 86400;
      const base = this.config.apiBase!;

      const data = await httpsGet(
        `${base}/v1/usage?start_time=${startTime}&end_time=${endTime}&page_size=100`,
        apiKey
      );

      const items: any[] = data?.data ?? [];
      return items.map((item: any) => ({
        timestamp: (item.created_at ?? item.timestamp ?? 0) * 1000,
        provider: this.config.name,
        model: item.model ?? 'unknown',
        promptTokens: item.prompt_tokens ?? item.input_tokens ?? 0,
        completionTokens: item.completion_tokens ?? item.output_tokens ?? 0,
        cacheHitTokens: item.prompt_cache_hit_tokens ?? item.cache_hit_tokens ?? 0,
        cacheMissTokens: item.prompt_cache_miss_tokens ?? item.cache_miss_tokens ?? 0,
        cost: parseFloat(String(item.total_cost ?? item.cost ?? 0)) || 0,
        endpoint: '/v1/chat/completions',
      }));
    } catch (e) {
      console.error(`[DeepSeek Monitor] 获取 ${this.config.name} 用量失败:`, e);
      return [];
    }
  }

  async parseLocalUsage(_paths: string[]): Promise<UsageEntry[]> {
    return [];
  }
}
