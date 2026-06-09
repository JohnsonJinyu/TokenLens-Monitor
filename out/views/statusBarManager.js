"use strict";
/**
 * 状态栏管理器 —— VSCode 右下角实时用量概览。
 *
 * 参考 DeepSeek Pilot 的设计：
 *  无数据:  "✨ DeepSeek Monitor · ¥0.00"
 *  有数据:  "✨ ¥0.15 · 1.2k tok · 85% cache · 16% ctx"
 *  上下文告警: 背景变黄 (>70%) / 变红 (>85%)
 *  费用告警: 弹出通知
 *
 * 悬停:  完整用量表格 + 余额
 * 点击:  打开仪表板
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
    constructor(tracker) {
        this._disposables = [];
        this.lastAlertedCost = 0;
        this.tracker = tracker;
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
        this.item.name = 'DeepSeek Monitor';
        this.item.command = 'deepseekMonitor.showDashboard';
        // 初始状态 — 直接显示费用，即使为 0
        this.item.text = '$(pulse) DeepSeek · ¥0';
        this.item.tooltip = this.buildNoDataTooltip();
        this.item.backgroundColor = undefined;
        this.item.show();
        // 监听更新
        this.tracker.onUpdate((stats) => this.refresh(stats));
        this._disposables.push(this.item);
    }
    // ============================================================
    // 主刷新
    // ============================================================
    refresh(stats) {
        const display = (0, settings_1.getStatusBarDisplay)();
        const { totalCost, totalTokens, totalRequests, globalCacheHitRate } = stats;
        // 获取最后一个请求的上下文窗口占比
        const ctxPct = stats.lastContextPercent ?? 0;
        const showCache = (0, settings_1.getShowCacheHitRate)() && (display.includes('cache') || display.includes('context'));
        const showContext = display.includes('context') && ctxPct > 0;
        // ---- 构建状态栏文本 ----
        const parts = [];
        const costStr = this.fmtCost(totalCost);
        if (totalRequests === 0) {
            // 无数据但显示费用为 ¥0
            parts.push(`$(pulse) ${costStr}`);
        }
        else {
            parts.push(`$(circuit-board) ${costStr}`);
            if (display !== 'cost-only') {
                parts.push(`$(symbol-keyword) ${this.fmtTokens(totalTokens)}`);
            }
            if (showCache && totalRequests > 0) {
                parts.push(`$(server) ${globalCacheHitRate.toFixed(0)}%`);
            }
            if (showContext) {
                const ctxIcon = ctxPct > (0, settings_1.getContextCriticalThreshold)() ? '$(error)'
                    : ctxPct > (0, settings_1.getContextWarnThreshold)() ? '$(warning)' : '$(info)';
                parts.push(`${ctxIcon} ${ctxPct}%`);
            }
        }
        this.item.text = parts.join('  ');
        // ---- 上下文窗口告警背景色 ----
        if (ctxPct > (0, settings_1.getContextCriticalThreshold)()) {
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        else if (ctxPct > (0, settings_1.getContextWarnThreshold)()) {
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else {
            this.item.backgroundColor = undefined;
        }
        // ---- 费用告警 ----
        const alertThreshold = (0, settings_1.getCostAlertThreshold)();
        if (alertThreshold > 0 && totalCost >= alertThreshold && totalCost > this.lastAlertedCost) {
            this.lastAlertedCost = totalCost;
            vscode.window.showWarningMessage(`⚠️ DeepSeek Monitor: 本次会话费用已达 ${costStr}，超过告警阈值 ${this.fmtCost(alertThreshold)}`, '打开面板', '重置会话').then((choice) => {
                if (choice === '打开面板') {
                    vscode.commands.executeCommand('deepseekMonitor.showDashboard');
                }
                else if (choice === '重置会话') {
                    vscode.commands.executeCommand('deepseekMonitor.resetSession');
                }
            });
        }
        // ---- Tooltip ----
        if (totalRequests === 0) {
            this.item.tooltip = this.buildNoDataTooltip();
        }
        else {
            this.item.tooltip = this.buildTooltip(stats);
        }
    }
    // ============================================================
    // Tooltip
    // ============================================================
    buildNoDataTooltip() {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;
        md.isTrusted = true;
        const hasApiKey = !!(0, settings_1.getApiKey)();
        const lines = [];
        lines.push('### 🛰️ DeepSeek Monitor');
        lines.push('');
        lines.push('> 🔍 **HTTP 拦截器已启动** — 自动捕获所有 LLM API 请求');
        lines.push('');
        if (!hasApiKey) {
            lines.push('💡 **建议配置 API Key** 以解锁以下功能：');
            lines.push('- 📊 查询平台余额和赠送额度');
            lines.push('- 📜 拉取近 7 天用量历史');
            lines.push('- ⚡ 更精确的费用计算');
            lines.push('');
            lines.push('[🔑 打开设置](command:workbench.action.openSettings?deepseekMonitor.apiKey)');
        }
        else {
            lines.push('✅ API Key 已配置，等待 API 请求...');
            lines.push('');
            lines.push('> 使用 Copilot / Continue / Cline 等工具');
            lines.push('> 发送请求后数据将实时显示。');
        }
        lines.push('');
        lines.push('---');
        lines.push(`| 功能 | 状态 |`);
        lines.push(`|------|------|`);
        lines.push(`| 🔍 HTTP 拦截 | ✅ 运行中 |`);
        lines.push(`| 🔑 API Key | ${hasApiKey ? '✅ 已配置' : '⏸ 未配置'} |`);
        lines.push(`| 📊 余额查询 | ${hasApiKey ? '✅ 可用' : '⏸ 需 API Key'} |`);
        md.appendMarkdown(lines.join('\n'));
        return md;
    }
    buildTooltip(stats) {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;
        md.isTrusted = true;
        const { totalCost, totalTokens, totalRequests, globalCacheHitRate, sessionDuration, byProvider, lastContextPercent } = stats;
        const lines = [];
        lines.push('### 🛰️ DeepSeek Monitor');
        lines.push('');
        // 上下文窗口
        if (lastContextPercent && lastContextPercent > 0) {
            const ctxEmoji = lastContextPercent > (0, settings_1.getContextCriticalThreshold)() ? '🔴'
                : lastContextPercent > (0, settings_1.getContextWarnThreshold)() ? '🟡' : '🟢';
            lines.push(`> ${ctxEmoji} **上下文窗口**: ${lastContextPercent}% 已使用`);
            if (lastContextPercent > (0, settings_1.getContextWarnThreshold)()) {
                lines.push('> ⚠️ _建议考虑压缩对话或开启新会话_');
            }
            lines.push('');
        }
        // 总览表
        lines.push('| 指标 | 值 |');
        lines.push('|------|----|');
        lines.push(`| 💰 总费用 | **${this.fmtCost(totalCost)}** |`);
        lines.push(`| 📝 总 Tokens | ${this.fmtTokens(totalTokens)} |`);
        lines.push(`| 📨 请求数 | ${totalRequests} |`);
        lines.push(`| 🎯 缓存命中率 | **${globalCacheHitRate.toFixed(1)}%** |`);
        lines.push(`| ⏱ 运行时长 | ${this.fmtDuration(sessionDuration)} |`);
        lines.push('');
        // 各 Provider
        for (const [, ps] of byProvider) {
            lines.push('---');
            lines.push(`#### 🔌 ${ps.provider}`);
            lines.push('');
            lines.push('| 模型 | 请求 | 输入 | 输出 | 费用 | 缓存命中 |');
            lines.push('|------|------|------|------|------|----------|');
            for (const [model, m] of ps.byModel) {
                const totalCache = m.cacheHitTokens + m.cacheMissTokens;
                const hitRateStr = totalCache > 0
                    ? `${((m.cacheHitTokens / totalCache) * 100).toFixed(1)}%`
                    : '-';
                lines.push(`| ${model} | ${m.requests} | ${this.fmtTokens(m.promptTokens)} | ${this.fmtTokens(m.completionTokens)} | ${this.fmtCost(m.cost)} | ${hitRateStr} |`);
            }
            lines.push('');
            if (ps.balance) {
                const b = ps.balance;
                lines.push(`💳 **余额**: ${this.fmtCost(b.balance)} ${b.currency}`);
                if (b.giftBalance) {
                    lines.push(`　🎁 赠送: ${this.fmtCost(b.giftBalance)} ${b.currency}`);
                }
                const ago = Math.max(0, Math.floor((Date.now() - b.fetchedAt) / 60000));
                lines.push(`　_${ago} 分钟前更新_`);
                lines.push('');
            }
        }
        lines.push('---');
        lines.push('💡 _点击打开仪表板_');
        md.appendMarkdown(lines.join('\n'));
        return md;
    }
    // ============================================================
    // 格式化
    // ============================================================
    fmtCost(cost) {
        if (cost < 0.01) {
            return `¥${cost.toFixed(4)}`;
        }
        if (cost < 1) {
            return `¥${cost.toFixed(3)}`;
        }
        return `¥${cost.toFixed(2)}`;
    }
    fmtTokens(n) {
        if (n >= 1000000) {
            return `${(n / 1000000).toFixed(2)}M`;
        }
        if (n >= 1000) {
            return `${(n / 1000).toFixed(1)}k`;
        }
        return String(n);
    }
    fmtDuration(ms) {
        const mins = Math.floor(ms / 60000);
        const hrs = Math.floor(mins / 60);
        if (hrs > 0) {
            return `${hrs}h ${mins % 60}m`;
        }
        return `${mins}m`;
    }
    dispose() {
        for (const d of this._disposables) {
            d.dispose();
        }
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusBarManager.js.map