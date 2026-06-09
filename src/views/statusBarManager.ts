/**
 * 状态栏管理器。
 * 本体保持紧凑，tooltip 只展示关键摘要，详细信息放到面板里。
 */

import * as vscode from 'vscode';
import type { BalanceInfo } from '../providers/base';
import { UsageTracker, GlobalStats } from '../tracker/usageTracker';
import { StorageManager } from '../tracker/storage';
import {
  getContextWarnThreshold,
  getContextCriticalThreshold,
  getCostAlertThreshold,
  getApiKey,
} from '../config/settings';

interface MonitorStatusSummary {
  http: {
    running: boolean;
    lastRequestAt: number;
    lastUsageAt: number;
    seenRequests: number;
    parsedUsages: number;
    missingUsageResponses: number;
  };
  api: {
    running: boolean;
    configured: boolean;
    lastBalanceAt: number;
    lastUsageAt: number;
    lastError: string;
    lastEntryCount: number;
  };
  local: {
    running: boolean;
    configured: boolean;
    lastScanAt: number;
    lastError: string;
    lastEntryCount: number;
  };
}

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private tracker: UsageTracker;
  private storage: StorageManager;
  private getMonitorStatus: () => MonitorStatusSummary;
  private lastAlertedCost: number = 0;

  constructor(
    tracker: UsageTracker,
    storage: StorageManager,
    getMonitorStatus: () => MonitorStatusSummary,
  ) {
    this.tracker = tracker;
    this.storage = storage;
    this.getMonitorStatus = getMonitorStatus;

    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1000
    );
    this.item.name = 'TokenLens';
    this.item.command = 'tokenLens.showDashboard';
    this.item.text = '$(pulse) ¥0';
    this.item.tooltip = this.buildTooltip(null);
    this.item.backgroundColor = undefined;
    this.item.show();

    this.tracker.onUpdate((stats) => this.refresh(stats));
    this.refresh(this.tracker.getStats());
  }

  fmtCostStr(cost: number): string {
    return this.fmtMoney(cost);
  }

  refresh(stats: GlobalStats): void {
    const primaryBalance = this.getPrimaryBalance(stats);
    const ctxPct = stats.lastContextPercent ?? 0;
    const parts: string[] = ['$(pulse)'];

    if (primaryBalance) {
      parts.push(this.fmtMoney(primaryBalance.balance, primaryBalance.currency));
      if (ctxPct > 0) {
        parts.push(`${ctxPct}% ctx`);
      } else {
        parts.push(this.fmtMoney(stats.totalCost));
      }
    } else {
      parts.push(this.fmtMoney(stats.totalCost));
      parts.push(`${this.fmtTokens(stats.totalTokens)} t`);
    }

    this.item.text = parts.join(' · ');
    this.applyContextBackground(ctxPct);
    this.maybeShowCostAlert(stats.totalCost);
    this.item.tooltip = this.buildTooltip(stats);
  }

  private applyContextBackground(ctxPct: number): void {
    if (ctxPct > getContextCriticalThreshold()) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (ctxPct > getContextWarnThreshold()) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.backgroundColor = undefined;
    }
  }

  private maybeShowCostAlert(totalCost: number): void {
    const alertThreshold = getCostAlertThreshold();
    if (alertThreshold > 0 && totalCost >= alertThreshold && totalCost > this.lastAlertedCost) {
      this.lastAlertedCost = totalCost;
      vscode.window.showWarningMessage(
        `会话费用已达 ${this.fmtMoney(totalCost)}`,
        '打开面板', '重置会话'
      ).then((choice) => {
        if (choice === '打开面板') {
          vscode.commands.executeCommand('tokenLens.showDashboard');
        } else if (choice === '重置会话') {
          vscode.commands.executeCommand('tokenLens.resetSession');
        }
      });
    }
  }

  private buildTooltip(stats: GlobalStats | null): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const status = this.safeMonitorStatus();
    const history = this.storage.getUsageHistory();
    const last24h = this.buildLast24h(history);
    const cache = stats ? this.buildCacheSummary(stats) : { hitTokens: 0, missTokens: 0, hitRate: null };
    const primaryBalance = stats ? this.getPrimaryBalance(stats) : undefined;
    const balanceText = primaryBalance
      ? `${this.fmtMoney(primaryBalance.balance, primaryBalance.currency)} (${primaryBalance.provider})`
      : (getApiKey() ? '等待接口返回' : '未配置 API Key');
    const apiState = status.api.configured
      ? (status.api.lastError ? `异常：${this.compactText(status.api.lastError)}` : '可用')
      : '未配置';
    const httpState = status.http.running
      ? (status.http.parsedUsages > 0 ? `已捕获 ${status.http.parsedUsages} 条` : '监听中')
      : '已关闭';
    const lines: string[] = [];

    lines.push('### TokenLens');
    lines.push('');
    lines.push(`**余额**  ${balanceText}`);
    lines.push('');
    lines.push('**本次会话**');
    lines.push(`费用：${stats ? this.fmtMoney(stats.totalCost) : this.fmtMoney(0)}`);
    lines.push(`Token：${stats ? this.fmtTokens(stats.totalTokens) : '0'}　请求：${stats ? stats.totalRequests : 0} 次`);
    lines.push('');
    lines.push('**近 24 小时**');
    lines.push(`费用：${this.fmtMoney(last24h.cost)}`);
    lines.push(`Token：${this.fmtTokens(last24h.tokens)}　请求：${last24h.requests} 次`);
    lines.push('');
    lines.push('**状态**');
    lines.push(`API 查询：${apiState}`);
    lines.push(`HTTP 拦截：${httpState}`);

    if (cache.hitRate != null || stats?.lastContextPercent) {
      lines.push('');
      lines.push('**补充**');
      if (cache.hitRate != null) {
        lines.push(`缓存命中：${cache.hitRate.toFixed(1)}%`);
      }
      if (stats?.lastContextPercent) {
        lines.push(`上下文：${stats.lastContextPercent}% ${stats.lastModel}`);
      }
    }

    lines.push('');
    lines.push('[打开用量面板](command:tokenLens.showDashboard)');

    md.appendMarkdown(lines.join('\n'));
    return md;
  }

  private getPrimaryBalance(stats: GlobalStats): (BalanceInfo & { provider: string }) | undefined {
    return this.getBalances(stats)[0];
  }

  private getBalances(stats: GlobalStats): Array<BalanceInfo & { provider: string }> {
    const rows: Array<BalanceInfo & { provider: string }> = [];
    for (const [provider, ps] of stats.byProvider) {
      if (ps.balance) {
        rows.push({ ...ps.balance, provider });
      }
    }
    return rows.sort((a, b) => b.balance - a.balance);
  }

  private buildCacheSummary(stats: GlobalStats): { hitTokens: number; missTokens: number; hitRate: number | null } {
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

  private buildLast24h(history: ReturnType<StorageManager['getUsageHistory']>): { requests: number; tokens: number; cost: number } {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return history.filter((entry) => entry.timestamp >= since).reduce((acc, entry) => {
      acc.requests += 1;
      acc.tokens += entry.promptTokens + entry.completionTokens;
      acc.cost += entry.cost;
      return acc;
    }, { requests: 0, tokens: 0, cost: 0 });
  }

  private safeMonitorStatus(): MonitorStatusSummary {
    try {
      return this.getMonitorStatus();
    } catch {
      return {
        http: { running: false, lastRequestAt: 0, lastUsageAt: 0, seenRequests: 0, parsedUsages: 0, missingUsageResponses: 0 },
        api: { running: false, configured: false, lastBalanceAt: 0, lastUsageAt: 0, lastError: '状态不可用', lastEntryCount: 0 },
        local: { running: false, configured: false, lastScanAt: 0, lastError: '状态不可用', lastEntryCount: 0 },
      };
    }
  }

  private fmtMoney(value: number, currency: string = 'CNY'): string {
    const symbol = currency === 'USD' ? '$' : '¥';
    if (value === 0) { return `${symbol}0`; }
    if (Math.abs(value) < 0.01) { return `${symbol}${value.toFixed(4)}`; }
    if (Math.abs(value) < 1) { return `${symbol}${value.toFixed(3)}`; }
    return `${symbol}${value.toFixed(2)}`;
  }

  private fmtTokens(n: number): string {
    if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(2)}M`; }
    if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}k`; }
    return String(Math.round(n));
  }

  private fmtTime(ts: number): string {
    if (!ts) { return '从未'; }
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  private compactText(value: string): string {
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }

  dispose(): void {
    this.item.dispose();
  }
}
