"use strict";
/**
 * API 模式监控器 —— 通过定时轮询各提供商的 API 来获取余额和用量。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiMonitor = void 0;
const settings_1 = require("../config/settings");
class ApiMonitor {
    constructor(tracker) {
        this.balanceInterval = null;
        this.usageInterval = null;
        this.running = false;
        this.apiKey = '';
        this.lastBalanceAt = 0;
        this.lastUsageAt = 0;
        this.lastError = '';
        this.lastEntryCount = 0;
        /** 上次请求 ID 去重 */
        this.seenRequestIds = new Set();
        this.tracker = tracker;
    }
    /** 启动 API 监控（定时轮询） */
    start(providers) {
        if (this.running) {
            return;
        }
        this.syncApiKey();
        this.lastError = '';
        if (!this.apiKey || providers.length === 0) {
            console.log('[TokenLens] API 监控未启动：缺少 API Key 或没有 API 提供商');
            this.lastError = !this.apiKey ? 'API Key 未配置' : '没有 API 提供商';
            return;
        }
        this.running = true;
        const intervalMinutes = (0, settings_1.getBalanceCheckInterval)();
        const intervalMs = intervalMinutes * 60 * 1000;
        // 立即执行一次
        this.pollBalance(providers);
        this.pollUsage(providers);
        // 定时余额
        this.balanceInterval = setInterval(() => {
            this.pollBalance(providers);
        }, intervalMs);
        // 定时用量 — 频率快一些（30秒）
        this.usageInterval = setInterval(() => {
            this.pollUsage(providers);
        }, 30000);
        console.log(`[TokenLens] API 监控已启动，余额查询间隔: ${intervalMinutes} 分钟`);
    }
    /** 停止 API 监控 */
    stop() {
        this.running = false;
        if (this.balanceInterval) {
            clearInterval(this.balanceInterval);
            this.balanceInterval = null;
        }
        if (this.usageInterval) {
            clearInterval(this.usageInterval);
            this.usageInterval = null;
        }
        console.log('[TokenLens] API 监控已停止');
    }
    /** 轮询余额 */
    async pollBalance(providers) {
        this.syncApiKey();
        if (!this.apiKey) {
            this.lastError = 'API Key 未配置';
            return;
        }
        for (const provider of providers) {
            try {
                const balance = await provider.fetchBalance(this.apiKey);
                if (balance) {
                    this.tracker.updateBalance(provider.id, balance);
                    this.lastBalanceAt = Date.now();
                    this.lastError = '';
                }
                else {
                    this.lastError = '余额接口未返回可用余额';
                }
            }
            catch (e) {
                this.lastError = e instanceof Error ? e.message : String(e);
                console.error(`[TokenLens] ${provider.id} 余额查询失败:`, e);
            }
        }
    }
    /** 轮询用量 */
    async pollUsage(providers) {
        this.syncApiKey();
        if (!this.apiKey) {
            this.lastError = 'API Key 未配置';
            return;
        }
        for (const provider of providers) {
            try {
                const entries = await provider.fetchRecentUsage(this.apiKey, 1);
                // 去重
                const newEntries = entries.filter((e) => {
                    const id = `${e.provider}-${e.model}-${e.timestamp}-${e.promptTokens}-${e.completionTokens}`;
                    if (this.seenRequestIds.has(id)) {
                        return false;
                    }
                    this.seenRequestIds.add(id);
                    return true;
                });
                if (newEntries.length > 0) {
                    this.tracker.recordUsage(newEntries);
                }
                this.lastUsageAt = Date.now();
                this.lastEntryCount = newEntries.length;
                this.lastError = '';
            }
            catch (e) {
                this.lastError = e instanceof Error ? e.message : String(e);
                console.error(`[TokenLens] ${provider.id} 用量查询失败:`, e);
            }
        }
        // 限制去重集合大小
        if (this.seenRequestIds.size > 10000) {
            const arr = Array.from(this.seenRequestIds).slice(-5000);
            this.seenRequestIds = new Set(arr);
        }
    }
    /** 手动刷新全部 */
    async refreshAll(providers) {
        this.syncApiKey();
        await Promise.all([
            this.pollBalance(providers),
            this.pollUsage(providers),
        ]);
    }
    get isRunning() {
        return this.running;
    }
    getStatus() {
        return {
            running: this.running,
            configured: !!(0, settings_1.getApiKey)(),
            lastBalanceAt: this.lastBalanceAt,
            lastUsageAt: this.lastUsageAt,
            lastError: this.lastError,
            lastEntryCount: this.lastEntryCount,
        };
    }
    syncApiKey() {
        this.apiKey = (0, settings_1.getApiKey)();
    }
}
exports.ApiMonitor = ApiMonitor;
//# sourceMappingURL=apiMonitor.js.map