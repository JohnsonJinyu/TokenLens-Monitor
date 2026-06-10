"use strict";
/**
 * Kimi / Moonshot provider.
 * Official balance endpoint: GET /v1/users/me/balance
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
exports.KimiProvider = void 0;
exports.mapKimiBalanceResponse = mapKimiBalanceResponse;
const https = __importStar(require("https"));
const base_1 = require("./base");
function httpsGet(url, apiKey) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            port: u.port || undefined,
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
                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`Kimi API 返回 ${res.statusCode ?? '未知状态'}: ${body.slice(0, 200)}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                }
                catch {
                    reject(new Error(`解析 Kimi 响应失败: ${body.slice(0, 200)}`));
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
function mapKimiBalanceResponse(data, fetchedAt = Date.now()) {
    const source = data.data ?? data;
    const availableBalance = Number(source.available_balance) || 0;
    const cashBalance = Number(source.cash_balance) || 0;
    const voucherBalance = Number(source.voucher_balance) || 0;
    const currency = 'CNY';
    if (source.available_balance == null &&
        source.cash_balance == null &&
        source.voucher_balance == null) {
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
class KimiProvider extends base_1.BaseProvider {
    constructor(config) {
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
    async fetchBalance(apiKey) {
        const base = (this.config.apiBase || 'https://api.moonshot.cn').replace(/\/+$/, '');
        const data = await httpsGet(`${base}/v1/users/me/balance`, apiKey);
        return mapKimiBalanceResponse(data);
    }
    async fetchRecentUsage(_apiKey, _days = 7) {
        return [];
    }
    async parseLocalUsage(_paths) {
        return [];
    }
}
exports.KimiProvider = KimiProvider;
function formatMoney(value, currency) {
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
//# sourceMappingURL=kimi.js.map