"use strict";
/**
 * OpenAI 兼容提供商 —— 通用适配层，支持所有兼容 OpenAI API 的服务。
 * 适用于：硅基流动、智谱、百川、Moonshot、零一万物 等国产模型。
 * 通过配置自定义 apiBase 和 pricing 来适配不同平台。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAICompatProvider = void 0;
const https = __importStar(require("https"));
const base_1 = require("./base");
function httpsGet(url, apiKey) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk.toString()));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch {
                    resolve(null);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('请求超时')); });
        req.end();
    });
}
class OpenAICompatProvider extends base_1.BaseProvider {
    constructor(config) {
        super(config);
    }
    /**
     * 尝试多种已知的权益/账单查询端点
     */
    async fetchBalance(apiKey) {
        const base = this.config.apiBase;
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
                if (!data) {
                    continue;
                }
                // OpenAI billing 格式
                if (data.hard_limit_usd !== undefined) {
                    const used = data.total_usage ?? data.total_used ?? 0;
                    const limit = data.hard_limit_usd;
                    const remaining = limit - used;
                    return {
                        kind: 'billing',
                        label: '账单额度',
                        primaryLabel: '剩余额度',
                        primaryValue: remaining,
                        displayValue: this.formatMoney(remaining, 'USD'),
                        items: [
                            { label: '额度上限', value: this.formatMoney(limit, 'USD'), rawValue: limit, unit: 'USD' },
                            { label: '已用费用', value: this.formatMoney(used, 'USD'), rawValue: used, unit: 'USD' },
                        ],
                        totalCharged: limit,
                        totalUsed: used,
                        balance: remaining,
                        currency: 'USD',
                        source: ep,
                        confidence: 'official',
                        fetchedAt: Date.now(),
                    };
                }
                // DeepSeek 兼容格式
                if (data.balance_infos) {
                    const info = data.balance_infos[0];
                    const totalBalance = Number(info.total_balance) || 0;
                    const toppedUpBalance = Number(info.topped_up_balance) || 0;
                    const grantedBalance = Number(info.granted_balance) || 0;
                    const currency = info.currency || 'CNY';
                    const items = [
                        {
                            label: '充值余额',
                            value: this.formatMoney(toppedUpBalance, currency),
                            rawValue: toppedUpBalance,
                            unit: currency,
                        },
                    ];
                    if (grantedBalance > 0) {
                        items.push({
                            label: '赠送余额',
                            value: this.formatMoney(grantedBalance, currency),
                            rawValue: grantedBalance,
                            unit: currency,
                        });
                    }
                    return {
                        kind: 'balance',
                        label: '账户余额',
                        primaryLabel: '可用余额',
                        primaryValue: totalBalance,
                        displayValue: this.formatMoney(totalBalance, currency),
                        items,
                        balance: totalBalance,
                        giftBalance: grantedBalance,
                        currency,
                        source: ep,
                        confidence: 'official',
                        fetchedAt: Date.now(),
                    };
                }
                // 通用格式
                if (typeof data.total_balance === 'number') {
                    const balance = data.total_balance;
                    const currency = data.currency ?? 'CNY';
                    const used = data.total_usage ?? 0;
                    const topUp = data.total_top_up;
                    const items = [];
                    if (typeof topUp === 'number') {
                        items.push({ label: '充值余额', value: this.formatMoney(topUp, currency), rawValue: topUp, unit: currency });
                    }
                    if (typeof used === 'number' && used > 0) {
                        items.push({ label: '已用费用', value: this.formatMoney(used, currency), rawValue: used, unit: currency });
                    }
                    return {
                        kind: 'balance',
                        label: '账户余额',
                        primaryLabel: '可用余额',
                        primaryValue: balance,
                        displayValue: this.formatMoney(balance, currency),
                        items,
                        totalCharged: topUp,
                        totalUsed: used,
                        balance,
                        currency,
                        source: ep,
                        confidence: 'inferred',
                        fetchedAt: Date.now(),
                    };
                }
            }
            catch {
                continue;
            }
        }
        return null;
    }
    async fetchRecentUsage(apiKey, days = 7) {
        try {
            const endTime = Math.floor(Date.now() / 1000);
            const startTime = endTime - days * 86400;
            const base = this.config.apiBase;
            const data = await httpsGet(`${base}/v1/usage?start_time=${startTime}&end_time=${endTime}&page_size=100`, apiKey);
            const items = data?.data ?? [];
            return items.map((item) => ({
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
        }
        catch (e) {
            console.error(`[TokenLens] 获取 ${this.config.name} 用量失败:`, e);
            return [];
        }
    }
    async parseLocalUsage(_paths) {
        return [];
    }
    formatMoney(value, currency) {
        const symbol = currency === 'USD' ? '$' : '¥';
        if (value === 0) {
            return `${symbol}0`;
        }
        if (Math.abs(value) < 0.01) {
            return `${symbol}${value.toFixed(4)}`;
        }
        if (Math.abs(value) < 1) {
            return `${symbol}${value.toFixed(3)}`;
        }
        return `${symbol}${value.toFixed(2)}`;
    }
}
exports.OpenAICompatProvider = OpenAICompatProvider;
//# sourceMappingURL=openaiCompat.js.map