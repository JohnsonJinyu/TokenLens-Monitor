"use strict";
/**
 * DeepSeek 提供商 —— 通过 API 实时查询余额和用量
 * API 文档参考: https://platform.deepseek.com/api-docs
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
exports.DeepSeekProvider = void 0;
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
            },
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk.toString()));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch {
                    reject(new Error(`解析 DeepSeek 响应失败: ${body.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        req.end();
    });
}
class DeepSeekProvider extends base_1.BaseProvider {
    constructor(config) {
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
    async fetchBalance(apiKey) {
        try {
            const data = await httpsGet(`${this.config.apiBase}/user/balance`, apiKey);
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
        }
        catch (e) {
            console.error('[DeepSeek Monitor] 获取余额失败:', e);
            return null;
        }
    }
    async fetchRecentUsage(apiKey, days = 7) {
        try {
            const endTime = Math.floor(Date.now() / 1000);
            const startTime = endTime - days * 86400;
            const data = await httpsGet(`${this.config.apiBase}/v1/usage?start_time=${startTime}&end_time=${endTime}&page_size=100`, apiKey);
            const items = data.data ?? [];
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
        }
        catch (e) {
            console.error('[DeepSeek Monitor] 获取用量记录失败:', e);
            return [];
        }
    }
    /** DeepSeek 是纯 API 模式，不实现本地解析 */
    async parseLocalUsage(_paths) {
        return [];
    }
}
exports.DeepSeekProvider = DeepSeekProvider;
//# sourceMappingURL=deepseek.js.map