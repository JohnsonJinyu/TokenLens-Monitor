"use strict";
/**
 * API 模式监控器 —— 通过定时轮询各提供商的 API 来获取账户权益和用量。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiMonitor = void 0;
const settings_1 = require("../config/settings");
const apiMonitorPolicy_1 = require("./apiMonitorPolicy");
class ApiMonitor {
    constructor(tracker) {
        this.balanceInterval = null;
        this.usageInterval = null;
        this.running = false;
        this.apiKey = '';
        this.hasAnyApiKey = false;
        this.lastBalanceAt = 0;
        this.lastUsageAt = 0;
        this.lastError = '';
        this.lastEntryCount = 0;
        this.providerStatus = new Map();
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
        this.syncProviderStatuses(providers);
        this.hasAnyApiKey = this.hasConfiguredProvider(providers);
        this.lastError = '';
        if (!this.hasAnyApiKey) {
            console.log('[TokenLens] API 监控未启动：缺少 API Key 或没有 API 提供商');
            this.lastError = providers.length === 0 ? '没有 API 提供商' : 'API Key 未配置';
            return;
        }
        this.running = true;
        const intervalMinutes = (0, settings_1.getBalanceCheckInterval)();
        const intervalMs = intervalMinutes * 60 * 1000;
        // 立即执行一次
        this.pollBalance(providers);
        this.pollUsage(providers);
        // 定时账户权益
        this.balanceInterval = setInterval(() => {
            this.pollBalance(providers);
        }, intervalMs);
        // 定时用量 — 频率快一些（30秒）
        this.usageInterval = setInterval(() => {
            this.pollUsage(providers);
        }, 30000);
        console.log(`[TokenLens] API 监控已启动，权益刷新间隔: ${intervalMinutes} 分钟`);
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
    /** 轮询账户权益 */
    async pollBalance(providers) {
        this.syncApiKey();
        for (const provider of providers) {
            const status = this.ensureProviderStatus(provider);
            if (!(0, apiMonitorPolicy_1.isEntitlementPollingEnabled)(provider.config)) {
                status.capabilitySkippedReason = '权益查询待适配';
                status.entitlementEnabled = false;
                continue;
            }
            const apiKey = this.getProviderApiKey(provider);
            status.hasApiKey = !!apiKey;
            if (!apiKey) {
                status.lastError = 'API Key 未配置';
                this.lastError = `${provider.id} API Key 未配置`;
                continue;
            }
            try {
                const balance = await provider.fetchBalance(apiKey);
                if (balance) {
                    this.tracker.updateBalance(provider.id, balance);
                    this.lastBalanceAt = Date.now();
                    status.lastEntitlementAt = this.lastBalanceAt;
                    status.lastError = '';
                    status.capabilitySkippedReason = '';
                    this.lastError = '';
                }
                else {
                    status.lastError = '权益接口未返回可用数据';
                    this.lastError = '权益接口未返回可用数据';
                }
            }
            catch (e) {
                status.lastError = e instanceof Error ? e.message : String(e);
                this.lastError = status.lastError;
                console.error(`[TokenLens] ${provider.id} 权益查询失败:`, e);
            }
        }
    }
    /** 轮询用量 */
    async pollUsage(providers) {
        this.syncApiKey();
        for (const provider of providers) {
            const status = this.ensureProviderStatus(provider);
            if (!(0, apiMonitorPolicy_1.isUsageApiPollingEnabled)(provider.config)) {
                status.usageApiEnabled = false;
                continue;
            }
            const apiKey = this.getProviderApiKey(provider);
            status.hasApiKey = !!apiKey;
            if (!apiKey) {
                status.lastError = 'API Key 未配置';
                this.lastError = `${provider.id} API Key 未配置`;
                continue;
            }
            try {
                const entries = await provider.fetchRecentUsage(apiKey, 1);
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
                status.lastUsageAt = this.lastUsageAt;
                status.lastError = '';
                this.lastEntryCount = newEntries.length;
                this.lastError = '';
            }
            catch (e) {
                status.lastError = e instanceof Error ? e.message : String(e);
                this.lastError = status.lastError;
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
        this.syncProviderStatuses(providers);
        this.hasAnyApiKey = this.hasConfiguredProvider(providers);
        await Promise.all([
            this.pollBalance(providers),
            this.pollUsage(providers),
        ]);
    }
    async refreshEntitlements(providers) {
        this.syncApiKey();
        this.syncProviderStatuses(providers);
        const entitlementProviders = providers.filter((provider) => (0, apiMonitorPolicy_1.isEntitlementPollingEnabled)(provider.config));
        this.hasAnyApiKey = this.hasConfiguredProvider(providers);
        if (entitlementProviders.length === 0) {
            return 0;
        }
        await this.pollBalance(entitlementProviders);
        return entitlementProviders.length;
    }
    get isRunning() {
        return this.running;
    }
    getStatus() {
        return {
            running: this.running,
            configured: this.hasAnyApiKey || !!this.apiKey,
            lastBalanceAt: this.lastBalanceAt,
            lastUsageAt: this.lastUsageAt,
            lastError: this.lastError,
            lastEntryCount: this.lastEntryCount,
            providers: Array.from(this.providerStatus.values()),
        };
    }
    syncApiKey() {
        this.apiKey = (0, settings_1.getApiKey)();
    }
    getProviderApiKey(provider) {
        return (0, apiMonitorPolicy_1.resolveProviderApiKey)(provider.config, this.apiKey);
    }
    hasConfiguredProvider(providers) {
        return providers.some((provider) => !!this.getProviderApiKey(provider));
    }
    syncProviderStatuses(providers) {
        const active = new Set(providers.map((provider) => provider.id));
        for (const key of Array.from(this.providerStatus.keys())) {
            if (!active.has(key)) {
                this.providerStatus.delete(key);
            }
        }
        providers.forEach((provider) => this.ensureProviderStatus(provider));
    }
    ensureProviderStatus(provider) {
        let status = this.providerStatus.get(provider.id);
        if (!status) {
            status = {
                provider: provider.id,
                displayName: provider.config.displayName || provider.id,
                lastEntitlementAt: 0,
                lastUsageAt: 0,
                lastError: '',
                capabilitySkippedReason: '',
                entitlementEnabled: (0, apiMonitorPolicy_1.isEntitlementPollingEnabled)(provider.config),
                usageApiEnabled: (0, apiMonitorPolicy_1.isUsageApiPollingEnabled)(provider.config),
                hasApiKey: !!this.getProviderApiKey(provider),
            };
            this.providerStatus.set(provider.id, status);
        }
        status.displayName = provider.config.displayName || provider.id;
        status.entitlementEnabled = (0, apiMonitorPolicy_1.isEntitlementPollingEnabled)(provider.config);
        status.usageApiEnabled = (0, apiMonitorPolicy_1.isUsageApiPollingEnabled)(provider.config);
        status.hasApiKey = !!this.getProviderApiKey(provider);
        if (!status.entitlementEnabled && !status.capabilitySkippedReason) {
            status.capabilitySkippedReason = '模板配置，未启用权益查询';
        }
        else if (status.entitlementEnabled && status.capabilitySkippedReason === '模板配置，未启用权益查询') {
            status.capabilitySkippedReason = '';
        }
        return status;
    }
}
exports.ApiMonitor = ApiMonitor;
//# sourceMappingURL=apiMonitor.js.map