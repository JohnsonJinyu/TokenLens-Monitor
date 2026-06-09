/**
 * DeepSeek Monitor — VSCode 扩展入口
 *
 * 三种数据来源（优先级从高到低）：
 *  1. HTTP 拦截 — Monkey-patch https.request，自动捕获所有 LLM API 请求
 *  2. API 模式 — 通过 DeepSeek/OpenAI 兼容 API 定时查询余额和用量
 *  3. Local 模式 — 扫描本地缓存/日志文件解析用量数据
 *
 * UI：
 *  - 状态栏 (StatusBar) 实时显示费用/Token，悬停查看详情
 *  - 侧栏 Webview 仪表板，展示图表和缓存命中率
 */

import * as vscode from 'vscode';
import { ProviderRegistry, registry } from './providers/registry';
import { UsageTracker } from './tracker/usageTracker';
import { StorageManager } from './tracker/storage';
import { ApiMonitor } from './monitors/apiMonitor';
import { LocalMonitor } from './monitors/localMonitor';
import { StatusBarManager } from './views/statusBarManager';
import { DashboardPanel } from './views/dashboardPanel';
import * as interceptor from './interceptor/httpInterceptor';
import {
  getApiKey, getProviders, getAutoStart,
  getLocalMonitorPaths, getPricing, getMaxLogEntries,
  getInterceptEnabled,
  applyPricing,
} from './config/settings';

let tracker: UsageTracker;
let storage: StorageManager;
let apiMonitor: ApiMonitor;
let localMonitor: LocalMonitor;
let statusBar: StatusBarManager;
let dashboardProvider: DashboardPanel;

export function activate(context: vscode.ExtensionContext) {
  console.log('[DeepSeek Monitor] 🚀 正在启动...');

  // ---- Storage ----
  storage = new StorageManager(context, getMaxLogEntries());

  // ---- Tracker ----
  tracker = new UsageTracker(storage);

  // ---- Provider Registry ----
  initProviders();

  // ---- HTTP 拦截器（优先级最高：实时捕获所有 LLM API 请求）----
  if (getInterceptEnabled()) {
    interceptor.startInterception({
      onUsage: (entry) => {
        tracker.recordUsage([entry]);
      },
    });
  }

  // ---- Monitors (API 轮询 + 本地扫描作为补充) ----
  apiMonitor = new ApiMonitor(tracker);
  localMonitor = new LocalMonitor(tracker);

  // ---- StatusBar ----
  statusBar = new StatusBarManager(tracker);

  // ---- Dashboard Webview ----
  dashboardProvider = new DashboardPanel(tracker, context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'deepseekMonitor.dashboard',
      dashboardProvider
    )
  );

  // ---- Commands ----
  context.subscriptions.push(
    vscode.commands.registerCommand('deepseekMonitor.showDashboard', () => {
      vscode.commands.executeCommand(
        'workbench.view.extension.deepseek-monitor-sidebar'
      );
    }),
    vscode.commands.registerCommand('deepseekMonitor.refreshBalance', async () => {
      const providers = registry.getApiProviders();
      if (providers.length === 0) {
        vscode.window.showWarningMessage('没有配置 API 提供商');
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在刷新余额...' },
        async () => {
          await apiMonitor.refreshAll(providers);
          await localMonitor.forceScanAll(registry.getLocalProviders());
        }
      );
      vscode.window.showInformationMessage('✅ 余额和用量已刷新');
    }),
    vscode.commands.registerCommand('deepseekMonitor.toggleMonitor', () => {
      if (apiMonitor.isRunning) {
        stopAllMonitors();
        vscode.window.showInformationMessage('⏸ DeepSeek Monitor 已暂停');
      } else {
        startAllMonitors();
        vscode.window.showInformationMessage('▶ DeepSeek Monitor 已恢复');
      }
    }),
    vscode.commands.registerCommand('deepseekMonitor.resetSession', () => {
      tracker.resetSession();
      vscode.window.showInformationMessage('🗑 会话统计已重置');
    }),
    vscode.commands.registerCommand('deepseekMonitor.exportReport', async () => {
      await exportReport();
    })
  );

  // ---- 自动启动 ----
  if (getAutoStart()) {
    startAllMonitors();
  }

  // ---- 监听配置变更 ----
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('deepseekMonitor')) {
        console.log('[DeepSeek Monitor] 配置变更，重新初始化...');
        initProviders();
        // 重启监控
        stopAllMonitors();
        if (getAutoStart()) {
          startAllMonitors();
        }
        // 更新拦截器开关
        if (getInterceptEnabled() && !interceptor.isIntercepting()) {
          interceptor.startInterception({
            onUsage: (entry) => {
              tracker.recordUsage([entry]);
            },
          });
        } else if (!getInterceptEnabled() && interceptor.isIntercepting()) {
          interceptor.stopInterception();
        }
      }
    })
  );

  console.log('[DeepSeek Monitor] ✅ 启动完成');
}

export function deactivate() {
  stopAllMonitors();
  interceptor.stopInterception();
  console.log('[DeepSeek Monitor] 👋 已停止');
}

// ---- 内部函数 ----

function initProviders(): void {
  registry.clear();

  const apiKey = getApiKey();
  const providers = getProviders();
  const pricing = getPricing();
  const localPaths = getLocalMonitorPaths();

  // 注册用户配置的提供商
  for (const config of providers) {
    if (config.type === 'api' && apiKey && !config.apiKey) {
      config.apiKey = apiKey;
    }
    if (config.type === 'local' && localPaths.length > 0) {
      config.localPaths = [...(config.localPaths ?? []), ...localPaths];
    }

    const provider = registry.register(config);
    applyPricing(pricing, (model, p) => provider.setPricing(model, p));
  }

  // 无配置时使用默认值
  if (registry.count === 0) {
    registry.initDefaults(apiKey);

    for (const provider of registry.getAll()) {
      applyPricing(pricing, (model, p) => provider.setPricing(model, p));
    }
  }

  // 将定价同步到 HTTP 拦截器
  const pricingForInterceptor: Record<string, { input: number; output: number; currency: string; cacheHitDiscount?: number }> = {};
  for (const [model, p] of Object.entries(pricing)) {
    if (typeof p.input === 'number' && typeof p.output === 'number') {
      pricingForInterceptor[model] = {
        input: p.input,
        output: p.output,
        currency: (p as any).currency ?? 'CNY',
        cacheHitDiscount: (p as any).cacheHitDiscount,
      };
    }
  }
  interceptor.updatePricing(pricingForInterceptor);
}

function startAllMonitors(): void {
  apiMonitor.start(registry.getApiProviders());
  localMonitor.start(registry.getLocalProviders());
}

function stopAllMonitors(): void {
  apiMonitor.stop();
  localMonitor.stop();
}

async function exportReport(): Promise<void> {
  const stats = tracker.getStats();
  const history = storage.getUsageHistory();

  const lines: string[] = [];
  lines.push('# DeepSeek Monitor — 用量报告');
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
    defaultUri: vscode.Uri.file('deepseek-monitor-report.md'),
    filters: { 'Markdown': ['md'], 'CSV': ['csv'], 'All Files': ['*'] },
  });

  if (uri) {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
    vscode.window.showInformationMessage(`📥 报告已导出到: ${uri.fsPath}`);
  }
}
