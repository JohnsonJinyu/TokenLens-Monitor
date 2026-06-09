"use strict";
/**
 * 状态栏管理器。
 * 本体保持紧凑，tooltip 展示余额、Token、缓存、上下文和数据源健康。
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
exports.StatusBarManager = void 0;
const vscode = __importStar(require("vscode"));
const settings_1 = require("../config/settings");
class StatusBarManager {
    constructor(tracker, storage, getMonitorStatus) {
        this.lastAlertedCost = 0;
        this.tracker = tracker;
        this.storage = storage;
        this.getMonitorStatus = getMonitorStatus;
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
        this.item.name = 'DeepSeek Monitor';
        this.item.command = 'deepseekMonitor.showDashboard';
        this.item.text = '$(pulse) ¥0';
        this.item.tooltip = this.buildTooltip(null);
        this.item.backgroundColor = undefined;
        this.item.show();
        this.tracker.onUpdate((stats) => this.refresh(stats));
        this.refresh(this.tracker.getStats());
    }
    fmtCostStr(cost) {
        return this.fmtMoney(cost);
    }
    refresh(stats) {
        const primaryBalance = this.getPrimaryBalance(stats);
        const ctxPct = stats.lastContextPercent ?? 0;
        const parts = ['$(pulse)'];
        if (primaryBalance) {
            parts.push(this.fmtMoney(primaryBalance.balance, primaryBalance.currency));
            if (ctxPct > 0) {
                parts.push(`${ctxPct}% ctx`);
            }
            else {
                parts.push(this.fmtMoney(stats.totalCost));
            }
        }
        else {
            parts.push(this.fmtMoney(stats.totalCost));
            parts.push(`${this.fmtTokens(stats.totalTokens)} t`);
        }
        this.item.text = parts.join(' · ');
        this.applyContextBackground(ctxPct);
        this.maybeShowCostAlert(stats.totalCost);
        this.item.tooltip = this.buildTooltip(stats);
    }
    applyContextBackground(ctxPct) {
        if (ctxPct > (0, settings_1.getContextCriticalThreshold)()) {
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        else if (ctxPct > (0, settings_1.getContextWarnThreshold)()) {
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else {
            this.item.backgroundColor = undefined;
        }
    }
    maybeShowCostAlert(totalCost) {
        const alertThreshold = (0, settings_1.getCostAlertThreshold)();
        if (alertThreshold > 0 && totalCost >= alertThreshold && totalCost > this.lastAlertedCost) {
            this.lastAlertedCost = totalCost;
            vscode.window.showWarningMessage(`会话费用已达 ${this.fmtMoney(totalCost)}`, '打开面板', '重置会话').then((choice) => {
                if (choice === '打开面板') {
                    vscode.commands.executeCommand('deepseekMonitor.showDashboard');
                }
                else if (choice === '重置会话') {
                    vscode.commands.executeCommand('deepseekMonitor.resetSession');
                }
            });
        }
    }
    buildTooltip(stats) {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        const status = this.safeMonitorStatus();
        const history = this.storage.getUsageHistory();
        const last24h = this.buildLast24h(history);
        const cache = stats ? this.buildCacheSummary(stats) : { hitTokens: 0, missTokens: 0, hitRate: null };
        const primaryBalance = stats ? this.getPrimaryBalance(stats) : undefined;
        const lines = [];
        lines.push('### DeepSeek Monitor');
        lines.push('');
        lines.push('| 指标 | 当前值 |');
        lines.push('|------|--------|');
        lines.push(`| 账户余额 | ${primaryBalance ? `**${this.fmtMoney(primaryBalance.balance, primaryBalance.currency)}** ${primaryBalance.provider}` : '未查询'} |`);
        lines.push(`| 会话费用 | ${stats ? `**${this.fmtMoney(stats.totalCost)}**` : this.fmtMoney(0)} |`);
        lines.push(`| 近 24h 费用 | ${this.fmtMoney(last24h.cost)} |`);
        lines.push(`| Token | ${stats ? this.fmtTokens(stats.totalTokens) : '0'} |`);
        lines.push(`| 请求数 | ${stats ? stats.totalRequests : 0} |`);
        lines.push(`| 缓存命中率 | ${cache.hitRate == null ? '暂无缓存明细' : `${cache.hitRate.toFixed(1)}%`} |`);
        lines.push(`| 上下文占比 | ${stats?.lastContextPercent ? `${stats.lastContextPercent}% ${stats.lastModel}` : '未捕获'} |`);
        lines.push('');
        lines.push('### 余额明细');
        const balances = stats ? this.getBalances(stats) : [];
        if (balances.length === 0) {
            lines.push((0, settings_1.getApiKey)() ? '已配置 API Key，等待余额接口返回。' : '未配置 API Key，无法查询平台余额。');
        }
        else {
            lines.push('| 服务商 | 剩余 | 已用 | 充值 | 赠送 | 更新时间 |');
            lines.push('|--------|------|------|------|------|----------|');
            for (const b of balances) {
                lines.push(`| ${b.provider} | ${this.fmtMoney(b.balance, b.currency)} | ${this.fmtMoney(b.totalUsed, b.currency)} | ${this.fmtMoney(b.totalCharged, b.currency)} | ${b.giftBalance == null ? '-' : this.fmtMoney(b.giftBalance, b.currency)} | ${this.fmtTime(b.fetchedAt)} |`);
            }
        }
        lines.push('');
        lines.push('### 缓存与近 24h');
        lines.push('| 指标 | 值 |');
        lines.push('|------|----|');
        lines.push(`| 缓存命中 Token | ${this.fmtTokens(cache.hitTokens)} |`);
        lines.push(`| 缓存未命中 Token | ${this.fmtTokens(cache.missTokens)} |`);
        lines.push(`| 近 24h Token | ${this.fmtTokens(last24h.tokens)} |`);
        lines.push(`| 近 24h 请求 | ${last24h.requests} |`);
        lines.push('');
        lines.push('### 数据源健康');
        lines.push('| 数据源 | 状态 | 最近信息 |');
        lines.push('|--------|------|----------|');
        lines.push(`| HTTP 拦截 | ${status.http.running ? '运行中' : '已关闭'} | 目标请求 ${status.http.seenRequests}，已解析 ${status.http.parsedUsages}，无 usage ${status.http.missingUsageResponses} |`);
        lines.push(`| API 查询 | ${status.api.configured ? (status.api.lastError ? '异常' : '可用') : '未配置'} | ${status.api.lastError || `余额 ${this.fmtTime(status.api.lastBalanceAt)}，用量新增 ${status.api.lastEntryCount}`} |`);
        lines.push(`| 本地扫描 | ${status.local.configured ? (status.local.lastError ? '异常' : '运行中') : '未配置'} | ${status.local.lastError || `扫描 ${this.fmtTime(status.local.lastScanAt)}，新增 ${status.local.lastEntryCount}`} |`);
        md.appendMarkdown(lines.join('\n'));
        return md;
    }
    getPrimaryBalance(stats) {
        return this.getBalances(stats)[0];
    }
    getBalances(stats) {
        const rows = [];
        for (const [provider, ps] of stats.byProvider) {
            if (ps.balance) {
                rows.push({ ...ps.balance, provider });
            }
        }
        return rows.sort((a, b) => b.balance - a.balance);
    }
    buildCacheSummary(stats) {
        let hitTokens = 0;
        let missTokens = 0;
        for (const [, ps] of stats.byProvider) {
            for (const [, model] of ps.byModel) {
                hitTokens += model.cacheHitTokens;
                missTokens += model.cacheMissTokens;
            }
        }
        const total = hitTokens + missTokens;
        return {
            hitTokens,
            missTokens,
            hitRate: total > 0 ? (hitTokens / total) * 100 : null,
        };
    }
    buildLast24h(history) {
        const since = Date.now() - 24 * 60 * 60 * 1000;
        return history.filter((entry) => entry.timestamp >= since).reduce((acc, entry) => {
            acc.requests += 1;
            acc.tokens += entry.promptTokens + entry.completionTokens;
            acc.cost += entry.cost;
            return acc;
        }, { requests: 0, tokens: 0, cost: 0 });
    }
    safeMonitorStatus() {
        try {
            return this.getMonitorStatus();
        }
        catch {
            return {
                http: { running: false, lastRequestAt: 0, lastUsageAt: 0, seenRequests: 0, parsedUsages: 0, missingUsageResponses: 0 },
                api: { running: false, configured: false, lastBalanceAt: 0, lastUsageAt: 0, lastError: '状态不可用', lastEntryCount: 0 },
                local: { running: false, configured: false, lastScanAt: 0, lastError: '状态不可用', lastEntryCount: 0 },
            };
        }
    }
    fmtMoney(value, currency = 'CNY') {
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
    fmtTokens(n) {
        if (n >= 1000000) {
            return `${(n / 1000000).toFixed(2)}M`;
        }
        if (n >= 1000) {
            return `${(n / 1000).toFixed(1)}k`;
        }
        return String(Math.round(n));
    }
    fmtTime(ts) {
        if (!ts) {
            return '从未';
        }
        return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    dispose() {
        this.item.dispose();
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusBarManager.js.map