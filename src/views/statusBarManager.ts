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
    providers?: unknown[];
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
  private getMonitorStatus: () => MonitorStatusSummary;
  private lastAlertedCost: number = 0;

  constructor(
    tracker: UsageTracker,
    _storage: StorageManager,
    getMonitorStatus: () => MonitorStatusSummary,
  ) {
    this.tracker = tracker;
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

    this.item.text = primaryBalance
      ? `$(pulse) ${this.formatEntitlement(primaryBalance)}`
      : '$(pulse) 未查询';
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
    const primaryBalance = stats ? this.getPrimaryBalance(stats) : undefined;
    const balanceText = primaryBalance
      ? `${this.formatEntitlement(primaryBalance)} (${primaryBalance.provider})`
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

  private formatEntitlement(info: BalanceInfo): string {
    if (info.displayValue) { return info.displayValue; }
    if (typeof info.primaryValue === 'number' && info.currency) {
      return this.fmtMoney(info.primaryValue, info.currency);
    }
    if (info.primaryValue !== undefined && info.primaryValue !== null) {
      return `${info.primaryValue}${info.primaryUnit ? ` ${info.primaryUnit}` : ''}`;
    }
    return this.fmtMoney(info.balance, info.currency);
  }

  private safeMonitorStatus(): MonitorStatusSummary {
    try {
      return this.getMonitorStatus();
    } catch {
      return {
        http: { running: false, lastRequestAt: 0, lastUsageAt: 0, seenRequests: 0, parsedUsages: 0, missingUsageResponses: 0 },
        api: { running: false, configured: false, lastBalanceAt: 0, lastUsageAt: 0, lastError: '状态不可用', lastEntryCount: 0, providers: [] },
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
