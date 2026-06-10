/**
 * Kimi / Moonshot provider.
 * Official balance endpoint: GET /v1/users/me/balance
 */

import * as https from 'https';
import { BaseProvider, BalanceInfo, ProviderConfig, UsageEntry } from './base';

interface KimiBalanceResponse {
  code?: number;
  status?: boolean;
  message?: string;
  data?: {
    available_balance?: number | string;
    voucher_balance?: number | string;
    cash_balance?: number | string;
  };
  available_balance?: number | string;
  voucher_balance?: number | string;
  cash_balance?: number | string;
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
            reject(new Error(`Kimi API 返回 ${res.statusCode ?? '未知状态'}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`解析 Kimi 响应失败: ${body.slice(0, 200)}`));
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

export function mapKimiBalanceResponse(data: KimiBalanceResponse, fetchedAt: number = Date.now()): BalanceInfo | null {
  const source = data.data ?? data;
  const availableBalance = Number(source.available_balance) || 0;
  const cashBalance = Number(source.cash_balance) || 0;
  const voucherBalance = Number(source.voucher_balance) || 0;
  const currency = 'CNY';

  if (
    source.available_balance == null &&
    source.cash_balance == null &&
    source.voucher_balance == null
  ) {
    return null;
  }

  return {
    kind: 'balance',
    label: 'Kimi 账户余额',
    primaryLabel: '可用余额',
    primaryValue: availableBalance,
    displayValue: formatMoney(availableBalance, currency),
    items: [
      {
        label: '现金余额',
        value: formatMoney(cashBalance, currency),
        rawValue: cashBalance,
        unit: currency,
      },
      {
        label: '代金券余额',
        value: formatMoney(voucherBalance, currency),
        rawValue: voucherBalance,
        unit: currency,
      },
    ],
    source: '/v1/users/me/balance',
    confidence: 'official',
    balance: availableBalance,
    giftBalance: voucherBalance,
    currency,
    fetchedAt,
  };
}

export class KimiProvider extends BaseProvider {
  constructor(config?: Partial<ProviderConfig>) {
    super({
      id: 'kimi',
      name: 'Kimi',
      displayName: 'Kimi / Moonshot',
      type: 'api',
      apiBase: 'https://api.moonshot.cn',
      entitlementKind: 'balance',
      capabilities: {
        entitlement: true,
        usageApi: false,
        interceptParser: 'openai',
        cacheMetrics: false,
        pricing: false,
      },
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
      ...config,
    });
  }

  async fetchBalance(apiKey: string): Promise<BalanceInfo | null> {
    const base = (this.config.apiBase || 'https://api.moonshot.cn').replace(/\/+$/, '');
    const data = await httpsGet(`${base}/v1/users/me/balance`, apiKey) as KimiBalanceResponse;
    return mapKimiBalanceResponse(data);
  }

  async fetchRecentUsage(_apiKey: string, _days: number = 7): Promise<UsageEntry[]> {
    return [];
  }

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
