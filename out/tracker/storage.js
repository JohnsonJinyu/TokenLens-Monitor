"use strict";
/**
 * 持久化存储 —— 基于 VSCode globalState，支持用量历史保留。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageManager = void 0;
const KEY_USAGE_HISTORY = 'tokenLens.usageHistory';
const KEY_SESSION_STATS = 'tokenLens.sessionStats';
const KEY_BALANCE_CACHE = 'tokenLens.balanceCache';
class StorageManager {
    constructor(ctx, maxEntries = 500) {
        this.ctx = ctx;
        this.maxEntries = maxEntries;
    }
    /** 获取用量历史 */
    getUsageHistory() {
        return this.ctx.globalState.get(KEY_USAGE_HISTORY, []);
    }
    /** 追加用量记录（自动截断） */
    appendUsage(entries) {
        const history = this.getUsageHistory();
        history.push(...entries);
        if (history.length > this.maxEntries) {
            history.splice(0, history.length - this.maxEntries);
        }
        this.ctx.globalState.update(KEY_USAGE_HISTORY, history);
    }
    /** 清除全部用量历史 */
    clearHistory() {
        this.ctx.globalState.update(KEY_USAGE_HISTORY, []);
    }
    /** 获取本次会话统计 */
    getSessionStats() {
        const defaults = {
            startTime: Date.now(),
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalCost: 0,
            totalRequests: 0,
            byModel: {},
        };
        return this.ctx.globalState.get(KEY_SESSION_STATS, defaults);
    }
    /** 更新会话统计 */
    updateSessionStats(stats) {
        this.ctx.globalState.update(KEY_SESSION_STATS, stats);
    }
    /** 重置会话统计 */
    resetSession() {
        const fresh = {
            startTime: Date.now(),
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalCost: 0,
            totalRequests: 0,
            byModel: {},
        };
        this.ctx.globalState.update(KEY_SESSION_STATS, fresh);
        return fresh;
    }
    /** 获取缓存的余额信息 */
    getBalanceCache() {
        return this.ctx.globalState.get(KEY_BALANCE_CACHE, {});
    }
    /** 更新余额缓存 */
    updateBalanceCache(provider, info) {
        const cache = this.getBalanceCache();
        cache[provider] = { info, storedAt: Date.now() };
        this.ctx.globalState.update(KEY_BALANCE_CACHE, cache);
    }
}
exports.StorageManager = StorageManager;
//# sourceMappingURL=storage.js.map