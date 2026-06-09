"use strict";
/**
 * 仪表板 Webview Provider。
 * 负责把统计、历史、趋势和监控健康状态合并为一个 DashboardSnapshot。
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
exports.DashboardPanel = void 0;
const vscode = __importStar(require("vscode"));
const settings_1 = require("../config/settings");
const SECTION = 'tokenLens';
class DashboardPanel {
    constructor(tracker, storage, extensionUri, getMonitorStatus) {
        this.tracker = tracker;
        this.storage = storage;
        this._extensionUri = extensionUri;
        this.getMonitorStatus = getMonitorStatus;
        this.tracker.onUpdate((stats) => this.postSnapshot(stats));
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'node_modules'),
            ],
        };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg.type) {
                case 'ready':
                    this.postSnapshot(this.tracker.getStats());
                    this.postSettings();
                    break;
                case 'refresh':
                    vscode.commands.executeCommand('tokenLens.refreshBalance');
                    break;
                case 'reset':
                    vscode.commands.executeCommand('tokenLens.resetSession');
                    break;
                case 'export':
                    vscode.commands.executeCommand('tokenLens.exportReport');
                    break;
                case 'saveSetting':
                    this.saveSetting(msg.key, msg.value);
                    break;
                case 'getSettings':
                    this.postSettings();
                    break;
            }
        });
    }
    saveSetting(key, value) {
        const config = vscode.workspace.getConfiguration(SECTION);
        config.update(key, value, vscode.ConfigurationTarget.Global).then(() => {
            this._view?.webview.postMessage({ type: 'settingSaved', key, success: true });
            this.postSettings();
            this.postSnapshot(this.tracker.getStats());
        }, (err) => {
            this._view?.webview.postMessage({ type: 'settingSaved', key, success: false, error: String(err) });
            vscode.window.showErrorMessage(`TokenLens 设置保存失败: ${err}`);
        });
    }
    postSettings() {
        if (!this._view) {
            return;
        }
        const config = vscode.workspace.getConfiguration(SECTION);
        const keys = [
            'apiKey', 'apiBase', 'balanceCheckInterval', 'interceptEnabled',
            'autoStart', 'showCacheHitRate', 'statusBarDisplay',
            'contextWarnThreshold', 'contextCriticalThreshold',
            'costAlertThreshold', 'showNotificationOnUpdate', 'theme',
        ];
        const settings = {};
        for (const k of keys) {
            settings[k] = config.get(k);
        }
        if (settings.apiKey && typeof settings.apiKey === 'string' && settings.apiKey.length > 8) {
            settings.apiKeyMasked = settings.apiKey.slice(0, 4) + '...' + settings.apiKey.slice(-4);
        }
        else if (settings.apiKey) {
            settings.apiKeyMasked = 'configured';
        }
        else {
            settings.apiKeyMasked = '';
        }
        this._view.webview.postMessage({ type: 'settings', data: settings });
    }
    postSnapshot(stats) {
        if (!this._view) {
            return;
        }
        this._view.webview.postMessage({ type: 'snapshot', data: this.buildSnapshot(stats) });
    }
    buildSnapshot(stats) {
        const history = this.storage.getUsageHistory();
        const now = Date.now();
        const dayAgo = now - 24 * 60 * 60 * 1000;
        const recentHistory = history.slice(-80).reverse().map((entry) => ({
            ...entry,
            totalTokens: entry.promptTokens + entry.completionTokens,
            source: entry.endpoint || 'captured',
        }));
        const providerRows = Array.from(stats.byProvider.entries()).map(([name, ps]) => ({
            name,
            requests: ps.totalRequests,
            promptTokens: ps.totalPromptTokens,
            completionTokens: ps.totalCompletionTokens,
            totalTokens: ps.totalPromptTokens + ps.totalCompletionTokens,
            cost: ps.totalCost,
            cacheHitRate: ps.cacheHitRate,
            cacheHitTokens: Array.from(ps.byModel.values()).reduce((sum, m) => sum + m.cacheHitTokens, 0),
            cacheMissTokens: Array.from(ps.byModel.values()).reduce((sum, m) => sum + m.cacheMissTokens, 0),
            balance: ps.balance,
        })).sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens);
        const modelRows = Array.from(stats.byProvider.entries()).flatMap(([provider, ps]) => Array.from(ps.byModel.entries()).map(([model, m]) => {
            const cacheTotal = m.cacheHitTokens + m.cacheMissTokens;
            return {
                provider,
                model,
                requests: m.requests,
                promptTokens: m.promptTokens,
                completionTokens: m.completionTokens,
                totalTokens: m.promptTokens + m.completionTokens,
                cost: m.cost,
                cacheHitRate: cacheTotal > 0 ? (m.cacheHitTokens / cacheTotal) * 100 : 0,
                cacheHitTokens: m.cacheHitTokens,
                cacheMissTokens: m.cacheMissTokens,
            };
        })).sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens);
        const recent24h = history.filter((entry) => entry.timestamp >= dayAgo);
        const last24h = recent24h.reduce((acc, entry) => {
            acc.requests += 1;
            acc.tokens += entry.promptTokens + entry.completionTokens;
            acc.cost += entry.cost;
            acc.cacheHitTokens += entry.cacheHitTokens ?? 0;
            acc.cacheMissTokens += entry.cacheMissTokens ?? 0;
            return acc;
        }, { requests: 0, tokens: 0, cost: 0, cacheHitTokens: 0, cacheMissTokens: 0 });
        const balanceSummary = this.buildBalanceSummary(providerRows);
        const cacheSummary = this.buildCacheSummary(modelRows);
        const rangeTrends = this.buildRangeTrends(history, now);
        return {
            generatedAt: now,
            stats: this.serializeStats(stats),
            recentHistory,
            providerRows,
            modelRows,
            trend: rangeTrends['24h'],
            rangeTrends,
            dailyHeatmap: this.buildDailyHeatmap(history, now),
            last24h,
            balanceSummary,
            cacheSummary,
            statusBarSummary: {
                balanceText: balanceSummary.primary ? this.formatMoney(balanceSummary.primary.balance, balanceSummary.primary.currency) : '未查询',
                costText: this.formatMoney(stats.totalCost),
                tokenText: this.formatTokens(stats.totalTokens),
                contextText: stats.lastContextPercent ? `${stats.lastContextPercent}%` : '未捕获',
            },
            monitorStatus: this.getMonitorStatus(),
        };
    }
    serializeStats(stats) {
        return {
            totalCost: stats.totalCost,
            totalTokens: stats.totalTokens,
            totalRequests: stats.totalRequests,
            globalCacheHitRate: stats.globalCacheHitRate,
            sessionDuration: stats.sessionDuration,
            lastContextPercent: stats.lastContextPercent || 0,
            lastModel: stats.lastModel || '',
        };
    }
    buildRangeTrends(history, now) {
        return {
            '5h': this.buildTrend(history, now, 5, 'hour'),
            '24h': this.buildTrend(history, now, 24, 'hour'),
            '7d': this.buildTrend(history, now, 7, 'day'),
        };
    }
    buildTrend(history, now, count, unit) {
        const step = unit === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const start = now - (count - 1) * step;
        const buckets = new Map();
        for (let i = 0; i < count; i++) {
            const d = new Date(start + i * step);
            if (unit === 'hour') {
                d.setMinutes(0, 0, 0);
            }
            else {
                d.setHours(0, 0, 0, 0);
            }
            buckets.set(d.getTime(), { cost: 0, tokens: 0, requests: 0 });
        }
        for (const entry of history) {
            if (entry.timestamp < start || entry.timestamp > now) {
                continue;
            }
            const d = new Date(entry.timestamp);
            if (unit === 'hour') {
                d.setMinutes(0, 0, 0);
            }
            else {
                d.setHours(0, 0, 0, 0);
            }
            const bucket = buckets.get(d.getTime());
            if (!bucket) {
                continue;
            }
            bucket.cost += entry.cost;
            bucket.tokens += entry.promptTokens + entry.completionTokens;
            bucket.requests += 1;
        }
        return Array.from(buckets.entries()).map(([time, value]) => ({
            label: unit === 'hour'
                ? new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', hour12: false })
                : new Date(time).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
            ...value,
        }));
    }
    buildDailyHeatmap(history, now) {
        const days = [];
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
            days.push({ date: d, cost: 0, tokens: 0, requests: 0 });
        }
        const byDate = new Map(days.map((d) => [d.date.toISOString().slice(0, 10), d]));
        for (const entry of history) {
            const d = new Date(entry.timestamp);
            d.setHours(0, 0, 0, 0);
            const key = d.toISOString().slice(0, 10);
            const bucket = byDate.get(key);
            if (!bucket) {
                continue;
            }
            bucket.cost += entry.cost;
            bucket.tokens += entry.promptTokens + entry.completionTokens;
            bucket.requests += 1;
        }
        const maxCost = Math.max(...days.map((d) => d.cost), 0);
        const maxTokens = Math.max(...days.map((d) => d.tokens), 0);
        return days.map((d) => {
            const intensity = maxCost > 0 ? d.cost / maxCost : (maxTokens > 0 ? d.tokens / maxTokens : 0);
            return {
                date: d.date.toISOString().slice(0, 10),
                label: d.date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
                cost: d.cost,
                tokens: d.tokens,
                requests: d.requests,
                level: d.requests === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(intensity * 4))),
            };
        });
    }
    buildBalanceSummary(providerRows) {
        const providers = [];
        for (const row of providerRows) {
            if (row.balance) {
                providers.push({ ...row.balance, provider: row.name });
            }
        }
        return {
            primary: providers[0],
            providers,
        };
    }
    buildCacheSummary(modelRows) {
        const hitTokens = modelRows.reduce((sum, row) => sum + row.cacheHitTokens, 0);
        const missTokens = modelRows.reduce((sum, row) => sum + row.cacheMissTokens, 0);
        const totalTokens = hitTokens + missTokens;
        const pricing = (0, settings_1.getPricing)();
        let estimatedSavings = 0;
        let hasSavingsEstimate = false;
        for (const row of modelRows) {
            const p = pricing[row.model];
            if (!p || !p.cacheHitDiscount || row.cacheHitTokens <= 0) {
                continue;
            }
            estimatedSavings += (row.cacheHitTokens / 1000000) * p.input * (1 - p.cacheHitDiscount);
            hasSavingsEstimate = true;
        }
        return {
            hitTokens,
            missTokens,
            totalTokens,
            hitRate: totalTokens > 0 ? (hitTokens / totalTokens) * 100 : null,
            estimatedSavings: hasSavingsEstimate ? estimatedSavings : null,
        };
    }
    formatMoney(value, currency = 'CNY') {
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
    formatTokens(value) {
        if (value >= 1000000) {
            return `${(value / 1000000).toFixed(2)}M`;
        }
        if (value >= 1000) {
            return `${(value / 1000).toFixed(1)}k`;
        }
        return String(Math.round(value));
    }
    getHtml() {
        const mediaUri = vscode.Uri.joinPath(this._extensionUri, 'media');
        const assetVersion = Date.now();
        const dashboardJsUri = this._view.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'dashboard.js'));
        const chartJsUri = this._view.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'chart.min.js'));
        const csp = this._view.webview.cspSource;
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src 'unsafe-inline' ${csp};
                 script-src 'unsafe-inline' ${csp};
                 font-src ${csp};
                 img-src ${csp} data:;">
  <title>TokenLens</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #111318);
      --surface: var(--vscode-sideBar-background, #181b21);
      --panel: var(--vscode-editorWidget-background, #20242c);
      --panel-2: var(--vscode-input-background, #252a33);
      --border: var(--vscode-panel-border, #363b46);
      --fg: var(--vscode-editor-foreground, #e7eaf0);
      --muted: var(--vscode-descriptionForeground, #98a2b3);
      --accent: var(--vscode-focusBorder, #4f8cff);
      --good: #35c46a;
      --warn: #d9a441;
      --bad: #ef5f6b;
      --chart-a: #4f8cff;
      --chart-b: #35c46a;
      --chart-c: #d9a441;
      --chart-d: #a78bfa;
      --radius: 8px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: 12px;
      line-height: 1.45;
    }
    button, input, select {
      font: inherit;
    }
    .hidden { display: none !important; }
    .shell { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .title { min-width: 0; }
    .title h1 { margin: 0; font-size: 16px; line-height: 1.2; font-weight: 700; letter-spacing: 0; }
    .subtitle { color: var(--muted); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      background: var(--surface);
      white-space: nowrap;
      font-size: 11px;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: 0 0 auto; }
    .dot.good { background: var(--good); }
    .dot.warn { background: var(--warn); }
    .dot.bad { background: var(--bad); }
    .toolbar {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .btn {
      min-height: 30px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel);
      color: var(--fg);
      cursor: pointer;
      padding: 6px 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .btn:hover { border-color: var(--accent); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tab {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--muted);
      border-radius: 7px;
      padding: 7px 10px;
      cursor: pointer;
    }
    .tab.active { background: var(--panel); color: var(--fg); border-color: var(--accent); }
    .grid { display: grid; gap: 10px; }
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .card, .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      min-width: 0;
    }
    .card { padding: 12px; min-height: 84px; }
    .label { color: var(--muted); font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
    .kpi-icon { font-size: 15px; line-height: 1; }
    .value {
      font-size: 19px;
      font-weight: 700;
      letter-spacing: 0;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub { color: var(--muted); margin-top: 6px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meter {
      height: 5px;
      margin-top: 10px;
      border-radius: 999px;
      background: rgba(130, 140, 160, 0.18);
      overflow: hidden;
    }
    .meter-fill {
      height: 100%;
      width: 0;
      border-radius: 999px;
      background: var(--accent);
      transition: width 0.25s ease;
    }
    .meter-fill.good { background: var(--good); }
    .meter-fill.warn { background: var(--warn); }
    .meter-fill.bad { background: var(--bad); }
    .metric-line {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
      font-size: 11px;
      margin-top: 6px;
    }
    .metric-line span:last-child { color: var(--fg); font-variant-numeric: tabular-nums; }
    .panel { padding: 12px; }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }
    .panel-head-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .panel-title { font-size: 13px; font-weight: 700; }
    .panel-meta { color: var(--muted); font-size: 11px; }
    .chart-wrap { height: 180px; position: relative; }
    .segmented {
      display: inline-grid;
      grid-auto-flow: column;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--surface);
    }
    .segmented button {
      min-width: 34px;
      border: 0;
      border-radius: 5px;
      padding: 3px 7px;
      color: var(--muted);
      background: transparent;
      cursor: pointer;
      font-size: 11px;
    }
    .segmented button.active {
      color: var(--fg);
      background: var(--panel-2);
    }
    .heatmap {
      display: grid;
      grid-template-columns: repeat(10, minmax(0, 1fr));
      gap: 5px;
      align-items: center;
    }
    .heat-cell {
      aspect-ratio: 1;
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: rgba(130, 140, 160, 0.12);
    }
    .heat-cell.l1 { background: rgba(53, 196, 106, 0.22); border-color: rgba(53, 196, 106, 0.24); }
    .heat-cell.l2 { background: rgba(53, 196, 106, 0.38); border-color: rgba(53, 196, 106, 0.32); }
    .heat-cell.l3 { background: rgba(53, 196, 106, 0.58); border-color: rgba(53, 196, 106, 0.42); }
    .heat-cell.l4 { background: rgba(53, 196, 106, 0.82); border-color: rgba(53, 196, 106, 0.58); }
    .compact-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 10px;
      align-items: center;
      padding: 9px 10px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--surface);
      min-width: 0;
    }
    .compact-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .compact-meta { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .empty {
      min-height: 86px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--border);
      border-radius: 7px;
      padding: 14px;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 7px 6px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
    th { color: var(--muted); font-weight: 600; font-size: 11px; }
    td { font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    tr:last-child td { border-bottom: 0; }
    .status-list { display: grid; gap: 8px; }
    .health-row {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 9px 10px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--surface);
      min-width: 0;
    }
    .health-main { min-width: 0; }
    .health-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .health-detail { color: var(--muted); font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .health-state { color: var(--muted); font-size: 11px; white-space: nowrap; }
    .settings-panel { display: grid; gap: 10px; }
    .settings-group { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; }
    .settings-group h2 { font-size: 13px; margin: 0 0 10px; }
    .form-row { margin-bottom: 10px; }
    .form-row:last-child { margin-bottom: 0; }
    .form-label { display: block; color: var(--muted); margin-bottom: 5px; font-size: 11px; }
    .form-input, .form-select {
      width: 100%;
      background: var(--panel-2);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 7px 8px;
      min-width: 0;
    }
    .form-inline { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
    .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; }
    .toggle-row input { width: 16px; height: 16px; }
    .hint { color: var(--muted); font-size: 11px; margin-top: 4px; }
    @media (max-width: 320px) {
      body { padding: 10px; }
      .toolbar { grid-template-columns: 1fr; }
      .kpis { grid-template-columns: 1fr; }
      .value { font-size: 17px; }
      .panel-head { align-items: flex-start; flex-direction: column; }
      .panel-head-actions { width: 100%; justify-content: space-between; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="topbar">
      <div class="title">
        <h1>TokenLens</h1>
        <div class="subtitle" id="last-updated">等待快照</div>
      </div>
      <div class="status-pill" id="overall-status"><span class="dot"></span><span>初始化</span></div>
    </section>

    <nav class="tabs">
      <button class="tab active" id="tab-monitor" onclick="switchTab('monitor')">监控</button>
      <button class="tab" id="tab-settings" onclick="switchTab('settings')">设置</button>
    </nav>

    <section id="panel-monitor" class="shell">
      <div class="toolbar">
        <button class="btn primary" onclick="postMsg('refresh')">刷新余额</button>
        <button class="btn" onclick="postMsg('reset')">重置会话</button>
        <button class="btn" onclick="postMsg('export')">导出报告</button>
      </div>

      <section class="grid kpis" id="kpi-grid"></section>

      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">监控健康</div>
          <div class="panel-meta" id="health-meta"></div>
        </div>
        <div class="status-list" id="health-list"></div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">用量趋势</div>
          <div class="panel-head-actions">
            <div class="segmented" aria-label="趋势范围">
              <button id="range-5h" onclick="setTrendRange('5h')">5h</button>
              <button id="range-24h" class="active" onclick="setTrendRange('24h')">24h</button>
              <button id="range-7d" onclick="setTrendRange('7d')">7d</button>
            </div>
            <div class="panel-meta" id="trend-meta"></div>
          </div>
        </div>
        <div class="chart-wrap" id="trend-wrap"><canvas id="trendChart"></canvas></div>
        <div class="empty hidden" id="trend-empty">暂无请求数据。使用 AI 编程工具后，这里会显示费用、Token 和请求趋势。</div>
      </section>

      <section class="panel" id="heatmap-section">
        <div class="panel-head">
          <div class="panel-title">使用历史</div>
          <div class="panel-meta" id="heatmap-meta"></div>
        </div>
        <div class="heatmap" id="usage-heatmap"></div>
      </section>

      <section class="panel" id="model-chart-section">
        <div class="panel-head">
          <div class="panel-title">模型费用分布</div>
          <div class="panel-meta" id="model-chart-meta"></div>
        </div>
        <div class="chart-wrap" id="model-chart-wrap"><canvas id="modelCostChart"></canvas></div>
        <div class="empty hidden" id="model-chart-empty">暂无模型费用数据。</div>
      </section>

      <section class="panel" id="provider-section">
        <div class="panel-head">
          <div class="panel-title">服务商概览</div>
          <div class="panel-meta" id="provider-meta"></div>
        </div>
        <div id="provider-table"></div>
      </section>

      <section class="panel" id="model-section">
        <div class="panel-head">
          <div class="panel-title">模型排行</div>
          <div class="panel-meta" id="model-meta"></div>
        </div>
        <div id="model-table"></div>
      </section>

      <section class="panel" id="history-section">
        <div class="panel-head">
          <div class="panel-title">最近请求</div>
          <div class="panel-meta" id="history-meta"></div>
        </div>
        <div id="history-table"></div>
      </section>
    </section>

    <section id="panel-settings" class="hidden settings-panel">
      <div class="settings-group">
        <h2>API 配置</h2>
        <div class="form-row">
          <label class="form-label">DeepSeek API Key（余额查询）</label>
          <div class="form-inline">
            <input class="form-input" type="password" id="setting-apiKey" placeholder="sk-...">
            <button class="btn" onclick="saveApiKey()">保存</button>
          </div>
          <div class="hint" id="api-key-status"></div>
        </div>
        <div class="form-row">
          <label class="form-label">API Base URL</label>
          <input class="form-input" id="setting-apiBase" placeholder="https://api.deepseek.com" onchange="saveSetting('apiBase', this.value)">
        </div>
        <div class="form-row">
          <label class="form-label">余额查询间隔（分钟）</label>
          <input class="form-input" type="number" id="setting-balanceCheckInterval" min="1" max="60" onchange="saveSetting('balanceCheckInterval', parseInt(this.value, 10))">
        </div>
      </div>

      <div class="settings-group">
        <h2>监控选项</h2>
        <label class="toggle-row"><span>Agent/API 请求拦截</span><input type="checkbox" id="setting-interceptEnabled" onchange="saveSetting('interceptEnabled', this.checked)"></label>
        <label class="toggle-row"><span>VS Code 启动时自动监控</span><input type="checkbox" id="setting-autoStart" onchange="saveSetting('autoStart', this.checked)"></label>
        <label class="toggle-row"><span>显示缓存命中率</span><input type="checkbox" id="setting-showCacheHitRate" onchange="saveSetting('showCacheHitRate', this.checked)"></label>
        <label class="toggle-row"><span>用量更新通知</span><input type="checkbox" id="setting-showNotificationOnUpdate" onchange="saveSetting('showNotificationOnUpdate', this.checked)"></label>
        <div class="form-row">
          <label class="form-label">状态栏显示内容</label>
          <select class="form-select" id="setting-statusBarDisplay" onchange="saveSetting('statusBarDisplay', this.value)">
            <option value="cost-only">仅费用</option>
            <option value="cost-tokens">费用 + Token</option>
            <option value="cost-tokens-cache">费用 + Token + 缓存命中</option>
            <option value="cost-tokens-cache-context">全部（含上下文占比）</option>
          </select>
        </div>
      </div>

      <div class="settings-group">
        <h2>告警和外观</h2>
        <div class="form-row">
          <label class="form-label">上下文窗口告警阈值（%）</label>
          <input class="form-input" type="number" id="setting-contextWarnThreshold" min="0" max="100" onchange="saveSetting('contextWarnThreshold', parseInt(this.value, 10))">
        </div>
        <div class="form-row">
          <label class="form-label">上下文窗口严重告警（%）</label>
          <input class="form-input" type="number" id="setting-contextCriticalThreshold" min="0" max="100" onchange="saveSetting('contextCriticalThreshold', parseInt(this.value, 10))">
        </div>
        <div class="form-row">
          <label class="form-label">费用告警阈值（元）</label>
          <input class="form-input" type="number" id="setting-costAlertThreshold" min="0" step="1" onchange="saveSetting('costAlertThreshold', parseFloat(this.value))">
        </div>
        <div class="form-row">
          <label class="form-label">面板主题</label>
          <select class="form-select" id="setting-theme" onchange="saveSetting('theme', this.value)">
            <option value="auto">跟随 VS Code</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </div>
      </div>
    </section>
  </main>

  <script src="${chartJsUri}?v=${assetVersion}"></script>
  <script src="${dashboardJsUri}?v=${assetVersion}"></script>
</body>
</html>`;
    }
}
exports.DashboardPanel = DashboardPanel;
//# sourceMappingURL=dashboardPanel.js.map