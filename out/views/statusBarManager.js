"use strict";
/**
 * 状态栏管理器。
 * 本体保持紧凑，tooltip 只展示关键摘要，详细信息放到面板里。
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
    constructor(tracker, _storage, getMonitorStatus) {
        this.lastAlertedCost = 0;
        this.tracker = tracker;
        this.getMonitorStatus = getMonitorStatus;
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
        this.item.name = 'TokenLens';
        this.item.command = 'tokenLens.showDashboard';
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
        this.item.text = primaryBalance
            ? `$(pulse) ${this.formatEntitlement(primaryBalance)}`
            : '$(pulse) 未查询';
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
                    vscode.commands.executeCommand('tokenLens.showDashboard');
                }
                else if (choice === '重置会话') {
                    vscode.commands.executeCommand('tokenLens.resetSession');
                }
            });
        }
    }
    buildTooltip(stats) {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        const status = this.safeMonitorStatus();
        const primaryBalance = stats ? this.getPrimaryBalance(stats) : undefined;
        const balanceText = primaryBalance
            ? `${this.formatEntitlement(primaryBalance)} (${primaryBalance.provider})`
            : ((0, settings_1.getApiKey)() ? '等待接口返回' : '未配置 API Key');
        const apiState = status.api.configured
            ? (status.api.lastError ? `异常：${this.compactText(status.api.lastError)}` : '可用')
            : '未配置';
        const httpState = status.http.running
            ? (status.http.parsedUsages > 0 ? `已捕获 ${status.http.parsedUsages} 条` : '监听中')
            : '已关闭';
        const lines = [];
        lines.push('### TokenLens');
        lines.push('');
        lines.push(`**账户权益**  ${balanceText}`);
        if (primaryBalance?.fetchedAt) {
            lines.push(`更新时间：${this.fmtTime(primaryBalance.fetchedAt)}`);
        }
        lines.push('');
        lines.push('**状态**');
        lines.push(`权益查询：${apiState}`);
        lines.push(`HTTP 拦截：${httpState}`);
        lines.push('');
        lines.push('费用、Token、缓存命中和趋势详情请打开左侧用量面板查看。');
        lines.push('');
        lines.push('[打开用量面板](command:tokenLens.showDashboard)');
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
    formatEntitlement(info) {
        if (info.displayValue) {
            return info.displayValue;
        }
        if (typeof info.primaryValue === 'number' && info.currency) {
            return this.fmtMoney(info.primaryValue, info.currency);
        }
        if (info.primaryValue !== undefined && info.primaryValue !== null) {
            return `${info.primaryValue}${info.primaryUnit ? ` ${info.primaryUnit}` : ''}`;
        }
        return this.fmtMoney(info.balance, info.currency);
    }
    safeMonitorStatus() {
        try {
            return this.getMonitorStatus();
        }
        catch {
            return {
                http: { running: false, lastRequestAt: 0, lastUsageAt: 0, seenRequests: 0, parsedUsages: 0, missingUsageResponses: 0 },
                api: { running: false, configured: false, lastBalanceAt: 0, lastUsageAt: 0, lastError: '状态不可用', lastEntryCount: 0, providers: [] },
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
    fmtTime(ts) {
        if (!ts) {
            return '从未';
        }
        return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    compactText(value) {
        const text = value.replace(/\s+/g, ' ').trim();
        return text.length > 80 ? `${text.slice(0, 77)}...` : text;
    }
    dispose() {
        this.item.dispose();
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusBarManager.js.map