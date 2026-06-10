"use strict";
/**
 * TokenLens — VSCode 扩展入口
 *
 * 三种数据来源（优先级从高到低）：
 *  1. HTTP 拦截 — Monkey-patch https.request，自动捕获所有 LLM API 请求
 *  2. API 模式 — 通过 DeepSeek/OpenAI 兼容 API 定时查询账户权益和用量
 *  3. Local 模式 — 扫描本地缓存/日志文件解析用量数据
 *
 * UI：
 *  - 状态栏 (StatusBar) 实时显示主账户权益，悬停查看详情
 *  - 侧栏 Webview 仪表板，展示图表和缓存命中率
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const registry_1 = require("./providers/registry");
const usageTracker_1 = require("./tracker/usageTracker");
const storage_1 = require("./tracker/storage");
const apiMonitor_1 = require("./monitors/apiMonitor");
const localMonitor_1 = require("./monitors/localMonitor");
const statusBarManager_1 = require("./views/statusBarManager");
const dashboardPanel_1 = require("./views/dashboardPanel");
const interceptor = __importStar(require("./interceptor/httpInterceptor"));
const settings_1 = require("./config/settings");
let tracker;
let storage;
let apiMonitor;
let localMonitor;
let statusBar;
let dashboardProvider;
function activate(context) {
    console.log('[TokenLens] 🚀 正在启动...');
    // ---- 🔥 状态栏最先创建（确保无论如何都显示）----
    try {
        storage = new storage_1.StorageManager(context, (0, settings_1.getMaxLogEntries)());
        tracker = new usageTracker_1.UsageTracker(storage);
        statusBar = new statusBarManager_1.StatusBarManager(tracker, storage, () => ({
            http: interceptor.getInterceptionStatus(),
            api: apiMonitor?.getStatus() ?? {
                running: false,
                configured: !!(0, settings_1.getApiKey)(),
                lastBalanceAt: 0,
                lastUsageAt: 0,
                lastError: '',
                lastEntryCount: 0,
                providers: [],
            },
            local: localMonitor?.getStatus() ?? {
                running: false,
                configured: false,
                lastScanAt: 0,
                lastError: '',
                lastEntryCount: 0,
            },
        }));
        context.subscriptions.push(statusBar);
        console.log('[TokenLens] ✅ StatusBar 已创建');
    }
    catch (e) {
        console.error('[TokenLens] ❌ StatusBar 创建失败:', e);
        // 兜底：创建一个极简状态栏
        try {
            const fallback = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
            fallback.text = '$(pulse) ¥0';
            fallback.tooltip = 'TokenLens';
            fallback.command = 'tokenLens.showDashboard';
            fallback.show();
            statusBar = fallback;
            context.subscriptions.push(statusBar);
        }
        catch { /* 彻底放弃 */ }
    }
    // ---- Provider Registry（包裹 try/catch）----
    try {
        initProviders();
    }
    catch (e) {
        console.error('[TokenLens] ❌ Provider 初始化失败:', e);
    }
    // ---- HTTP 拦截器 ----
    try {
        if ((0, settings_1.getInterceptEnabled)()) {
            interceptor.startInterception({
                onUsage: (entry) => {
                    tracker.recordUsage([entry]);
                },
            });
            console.log('[TokenLens] ✅ HTTP 拦截器已启动');
        }
    }
    catch (e) {
        console.error('[TokenLens] ❌ 拦截器启动失败:', e);
    }
    // ---- Monitors ----
    try {
        apiMonitor = new apiMonitor_1.ApiMonitor(tracker);
        localMonitor = new localMonitor_1.LocalMonitor(tracker);
        // 立即扫描本地历史
        const localProviders = registry_1.registry.getLocalProviders();
        if (localProviders.length > 0) {
            console.log(`[TokenLens] 发现 ${localProviders.length} 个本地数据源，立即扫描...`);
            localMonitor.forceScanAll(localProviders).catch((e) => {
                console.error('[TokenLens] 初始扫描失败:', e);
            });
        }
        // 🔥 有 API Key 时立即拉取账户权益和近期用量
        const apiProviders = registry_1.registry.getApiProviders();
        const apiKey = (0, settings_1.getApiKey)();
        const hasApiKey = apiProviders.some((provider) => provider.config.apiKey || (provider.config.name === 'DeepSeek' && apiKey));
        if (hasApiKey && apiProviders.length > 0) {
            console.log('[TokenLens] 检测到 API Key，立即拉取账户权益...');
            apiMonitor.refreshAll(apiProviders).then(() => {
                const stats = tracker.getStats();
                console.log(`[TokenLens] 初始拉取完成: ${stats.totalRequests} 条记录`);
                // 检查账户权益
                for (const [, ps] of stats.byProvider) {
                    if (ps.balance) {
                        console.log(`[TokenLens] ${ps.provider} 权益: ${ps.balance.displayValue ?? `${ps.balance.balance} ${ps.balance.currency}`}`);
                    }
                }
            }).catch((e) => {
                console.error('[TokenLens] 初始 API 拉取失败:', e);
                vscode.window.showWarningMessage('⚠️ TokenLens: API 权益查询失败，请检查 API Key 和网络');
            });
        }
    }
    catch (e) {
        console.error('[TokenLens] ❌ 监控器初始化失败:', e);
    }
    // ---- Dashboard Webview ----
    dashboardProvider = new dashboardPanel_1.DashboardPanel(tracker, storage, context.extensionUri, () => ({
        http: interceptor.getInterceptionStatus(),
        api: apiMonitor?.getStatus() ?? {
            running: false,
            configured: false,
            lastBalanceAt: 0,
            lastUsageAt: 0,
            lastError: 'API 监控器未初始化',
            lastEntryCount: 0,
            providers: [],
        },
        local: localMonitor?.getStatus() ?? {
            running: false,
            configured: false,
            lastScanAt: 0,
            lastError: '本地扫描器未初始化',
            lastEntryCount: 0,
        },
    }));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('tokenLens.dashboard', dashboardProvider));
    // ---- Commands ----
    context.subscriptions.push(vscode.commands.registerCommand('tokenLens.showDashboard', () => {
        vscode.commands.executeCommand('workbench.view.extension.tokenlens-monitor-sidebar');
    }), vscode.commands.registerCommand('tokenLens.refreshBalance', async () => {
        const providers = registry_1.registry.getApiProviders().filter((provider) => provider.config.capabilities?.entitlement !== false);
        if (providers.length === 0) {
            vscode.window.showInformationMessage('当前没有已支持权益查询的 API 服务商；模板服务商会先通过请求拦截统计用量。');
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在刷新权益...' }, async () => {
            await apiMonitor.refreshEntitlements(providers);
            await localMonitor.forceScanAll(registry_1.registry.getLocalProviders());
        });
        vscode.window.showInformationMessage('✅ 权益和用量已刷新');
    }), vscode.commands.registerCommand('tokenLens.toggleMonitor', () => {
        if (apiMonitor.isRunning) {
            stopAllMonitors();
            vscode.window.showInformationMessage('⏸ TokenLens 已暂停');
        }
        else {
            startAllMonitors();
            vscode.window.showInformationMessage('▶ TokenLens 已恢复');
        }
    }), vscode.commands.registerCommand('tokenLens.resetSession', () => {
        tracker.resetSession();
        vscode.window.showInformationMessage('🗑 会话统计已重置');
    }), vscode.commands.registerCommand('tokenLens.exportReport', async () => {
        await exportReport();
    }));
    // ---- 自动启动 ----
    if ((0, settings_1.getAutoStart)()) {
        startAllMonitors();
    }
    // ---- 监听配置变更 ----
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tokenLens')) {
            console.log('[TokenLens] 配置变更，重新初始化...');
            initProviders();
            // 重启监控
            stopAllMonitors();
            if ((0, settings_1.getAutoStart)()) {
                startAllMonitors();
            }
            // 更新拦截器开关
            if ((0, settings_1.getInterceptEnabled)() && !interceptor.isIntercepting()) {
                interceptor.startInterception({
                    onUsage: (entry) => {
                        tracker.recordUsage([entry]);
                    },
                });
            }
            else if (!(0, settings_1.getInterceptEnabled)() && interceptor.isIntercepting()) {
                interceptor.stopInterception();
            }
        }
    }));
    console.log('[TokenLens] ✅ 启动完成');
}
function deactivate() {
    stopAllMonitors();
    interceptor.stopInterception();
    statusBar?.dispose();
    statusBar = undefined;
    console.log('[TokenLens] 👋 已停止');
}
// ---- 内部函数 ----
function initProviders() {
    registry_1.registry.clear();
    const apiKey = (0, settings_1.getApiKey)();
    const apiBase = (0, settings_1.getApiBase)();
    const providers = (0, settings_1.getProviders)();
    const pricing = (0, settings_1.getPricing)();
    const localPaths = (0, settings_1.getLocalMonitorPaths)();
    // 注册用户配置的提供商
    for (const config of providers) {
        const nextConfig = { ...config };
        if (nextConfig.name === 'DeepSeek') {
            const hasCustomProviderBase = nextConfig.apiBase && nextConfig.apiBase !== 'https://api.deepseek.com';
            nextConfig.apiBase = hasCustomProviderBase ? nextConfig.apiBase : apiBase;
        }
        if (nextConfig.type === 'api' && nextConfig.name === 'DeepSeek' && apiKey && !nextConfig.apiKey) {
            nextConfig.apiKey = apiKey;
        }
        if (nextConfig.type === 'local' && localPaths.length > 0) {
            nextConfig.localPaths = [...(nextConfig.localPaths ?? []), ...localPaths];
        }
        const provider = registry_1.registry.register(nextConfig);
        (0, settings_1.applyPricing)(pricing, (model, p) => provider.setPricing(model, p));
    }
    // 无配置时使用默认值
    if (registry_1.registry.count === 0) {
        registry_1.registry.initDefaults(apiKey, apiBase);
        for (const provider of registry_1.registry.getAll()) {
            (0, settings_1.applyPricing)(pricing, (model, p) => provider.setPricing(model, p));
        }
    }
    // 将定价同步到 HTTP 拦截器
    const pricingForInterceptor = {};
    for (const [model, p] of Object.entries(pricing)) {
        if (typeof p.input === 'number' && typeof p.output === 'number') {
            pricingForInterceptor[model] = {
                input: p.input,
                output: p.output,
                currency: p.currency ?? 'CNY',
                cacheHitDiscount: p.cacheHitDiscount,
            };
        }
    }
    interceptor.updatePricing(pricingForInterceptor);
}
function startAllMonitors() {
    apiMonitor.start(registry_1.registry.getApiProviders());
    localMonitor.start(registry_1.registry.getLocalProviders());
}
function stopAllMonitors() {
    apiMonitor?.stop();
    localMonitor?.stop();
}
async function exportReport() {
    const stats = tracker.getStats();
    const history = storage.getUsageHistory();
    const lines = [];
    lines.push('# TokenLens — 用量报告');
    lines.push(`> 导出时间: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## 概览');
    lines.push(`- 总费用: ¥${stats.totalCost.toFixed(4)}`);
    lines.push(`- 总 Tokens: ${stats.totalTokens}`);
    lines.push(`- 总请求: ${stats.totalRequests}`);
    lines.push(`- 缓存命中率: ${stats.globalCacheHitRate.toFixed(1)}%`);
    lines.push('');
    lines.push('## 按模型统计');
    lines.push('| 模型 | 请求 | 输入 Token | 输出 Token | 费用 | 缓存命中 | 缓存未命中 |');
    lines.push('|------|------|-----------|-----------|------|---------|-----------|');
    for (const [, ps] of stats.byProvider) {
        for (const [model, m] of ps.byModel) {
            lines.push(`| ${model} | ${m.requests} | ${m.promptTokens} | ${m.completionTokens} | ${m.cost.toFixed(4)} | ${m.cacheHitTokens} | ${m.cacheMissTokens} |`);
        }
    }
    lines.push('');
    lines.push('## 最近 50 条记录');
    lines.push('| 时间 | 模型 | 输入 | 输出 | 费用 |');
    lines.push('|------|------|------|------|------|');
    for (const entry of history.slice(-50).reverse()) {
        const ts = new Date(entry.timestamp).toLocaleString('zh-CN');
        lines.push(`| ${ts} | ${entry.model} | ${entry.promptTokens} | ${entry.completionTokens} | ${entry.cost.toFixed(4)} |`);
    }
    const content = lines.join('\n');
    // 保存到文件
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('tokenlens-report.md'),
        filters: { 'Markdown': ['md'], 'CSV': ['csv'], 'All Files': ['*'] },
    });
    if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
        vscode.window.showInformationMessage(`📥 报告已导出到: ${uri.fsPath}`);
    }
}
//# sourceMappingURL=extension.js.map