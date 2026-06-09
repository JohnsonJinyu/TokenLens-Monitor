/**
 * 状态栏管理器 —— 右下角纯数据展示，无功能描述文字。
 *
 * 格式参考 DeepSeek Pilot：
 *  无数据:  "✨ ¥0"
 *  有数据:  "✨ ¥0.15 · 1.2k t · 85% ⇢ · 52% ctx"
 *  上下文告警: 背景变色
 *
 * 悬停: 完整用量 + 余额表格
 * 点击: 打开仪表板
 */

import * as vscode from 'vscode';
import { UsageTracker, GlobalStats } from '../tracker/usageTracker';
import {
  getStatusBarDisplay,
  getContextWarnThreshold,
  getContextCriticalThreshold,
  getCostAlertThreshold,
  getShowCacheHitRate,
  getApiKey,
} from '../config/settings';

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private tracker: UsageTracker;
  private lastAlertedCost: number = 0;

  constructor(tracker: UsageTracker) {
    this.tracker = tracker;

    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1000
    );
    this.item.name = 'DeepSeek Monitor';
    this.item.command = 'deepseekMonitor.showDashboard';

    // 初始：纯数据，¥0
    this.item.text = '$(pulse) ¥0';
    this.item.tooltip = this.buildTooltip(null);
    this.item.backgroundColor = undefined;
    this.item.show();

    this.tracker.onUpdate((stats) => this.refresh(stats));
  }

  /** 供外部调用（extension.ts 启动通知） */
  fmtCostStr(cost: number): string {
    return this.fmtCost(cost);
  }

  // ============================================================
  // 主刷新
  // ============================================================

  refresh(stats: GlobalStats): void {
    const display = getStatusBarDisplay();
    const { totalCost, totalTokens, totalRequests, globalCacheHitRate } = stats;
    const ctxPct = stats.lastContextPercent ?? 0;
    const showCache = getShowCacheHitRate() && display !== 'cost-only';
    const showCtx = display.includes('context') && ctxPct > 0;
    const showTokens = display !== 'cost-only';

    // ---- 构建文本 ----
    const parts: string[] = [];
    const icon = totalRequests === 0 ? '$(pulse)' : '$(circuit-board)';
    parts.push(`${icon} ${this.fmtCost(totalCost)}`);

    if (showTokens) {
      parts.push(`${this.fmtTokens(totalTokens)} t`);
    }

    if (showCache && totalRequests > 0) {
      parts.push(`${globalCacheHitRate.toFixed(0)}% ⇢`);
    }

    if (showCtx) {
      const ctxIcon = ctxPct > getContextCriticalThreshold() ? '$(error)'
        : ctxPct > getContextWarnThreshold() ? '$(warning)' : '';
      parts.push(`${ctxIcon} ${ctxPct}% ctx`.trim());
    }

    this.item.text = parts.join(' · ');

    // ---- 告警背景 ----
    if (ctxPct > getContextCriticalThreshold()) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (ctxPct > getContextWarnThreshold()) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.backgroundColor = undefined;
    }

    // ---- 费用告警 ----
    const alertThreshold = getCostAlertThreshold();
    if (alertThreshold > 0 && totalCost >= alertThreshold && totalCost > this.lastAlertedCost) {
      this.lastAlertedCost = totalCost;
      vscode.window.showWarningMessage(
        `⚠️ 会话费用已达 ${this.fmtCost(totalCost)}`,
        '打开面板', '重置会话'
      ).then((choice) => {
        if (choice === '打开面板') {
          vscode.commands.executeCommand('deepseekMonitor.showDashboard');
        } else if (choice === '重置会话') {
          vscode.commands.executeCommand('deepseekMonitor.resetSession');
        }
      });
    }

    // ---- Tooltip ----
    this.item.tooltip = this.buildTooltip(stats);
  }

  // ============================================================
  // Tooltip（统一，数据放在这里）
  // ============================================================

  private buildTooltip(stats: GlobalStats | null): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = true;

    const lines: string[] = [];
    lines.push('### ✨ DeepSeek Monitor');
    lines.push('');

    if (!stats || stats.totalRequests === 0) {
      const hasApiKey = !!getApiKey();
      lines.push('| 功能 | 状态 |');
      lines.push('|------|------|');
      lines.push('| 🔍 请求拦截 | ✅ 运行中 |');
      lines.push('| 📂 本地扫描 | ✅ 运行中 |');
      lines.push(`| 🔑 API Key | ${hasApiKey ? '✅ 已配置' : '⏸ 未配置'} |`);
      lines.push(`| 📊 余额查询 | ${hasApiKey ? '✅ 可用' : '⏸ 需 API Key'} |`);
      lines.push('');
      if (!hasApiKey) {
        lines.push('💡 [设置 API Key](command:workbench.action.openSettings?deepseekMonitor.apiKey) 后可查余额');
      }
      lines.push('');
      lines.push('_使用 AI 编程工具后，数据实时显示在这里_');
    } else {
      const ctxPct = stats.lastContextPercent ?? 0;
      if (ctxPct > 0) {
        const ctxEmoji = ctxPct > getContextCriticalThreshold() ? '🔴'
          : ctxPct > getContextWarnThreshold() ? '🟡' : '🟢';
        lines.push(`> ${ctxEmoji} 上下文窗口 **${ctxPct}%** 已使用`);
        if (ctxPct > getContextWarnThreshold()) {
          lines.push('> ⚠️ 建议压缩对话或开启新会话');
        }
        lines.push('');
      }

      lines.push('| 指标 | 值 |');
      lines.push('|------|----|');
      lines.push(`| 💰 总费用 | **${this.fmtCost(stats.totalCost)}** |`);
      lines.push(`| 📝 总 Tokens | ${this.fmtTokens(stats.totalTokens)} |`);
      lines.push(`| 📨 请求数 | ${stats.totalRequests} |`);
      lines.push(`| 🎯 缓存命中 | **${stats.globalCacheHitRate.toFixed(1)}%** |`);
      lines.push(`| ⏱ 运行时长 | ${this.fmtDuration(stats.sessionDuration)} |`);
      lines.push('');

      for (const [, ps] of stats.byProvider) {
        lines.push('---');
        lines.push(`### 🔌 ${ps.provider}`);
        lines.push('');
        lines.push('| 模型 | 请求 | 输入 | 输出 | 费用 | 缓存 |');
        lines.push('|------|------|------|------|------|------|');
        for (const [model, m] of ps.byModel) {
          const totalCache = m.cacheHitTokens + m.cacheMissTokens;
          const hitStr = totalCache > 0 ? `${((m.cacheHitTokens / totalCache) * 100).toFixed(0)}%` : '-';
          lines.push(
            `| ${model} | ${m.requests} | ${this.fmtTokens(m.promptTokens)} | ${this.fmtTokens(m.completionTokens)} | ${this.fmtCost(m.cost)} | ${hitStr} |`
          );
        }
        if (ps.balance) {
          const b = ps.balance;
          lines.push('');
          lines.push(`💳 余额: **${this.fmtCost(b.balance)}** ${b.currency}`);
          if (b.giftBalance) {
            lines.push(`　🎁 赠送: ${this.fmtCost(b.giftBalance)} ${b.currency}`);
          }
        }
        lines.push('');
      }
    }

    md.appendMarkdown(lines.join('\n'));
    return md;
  }

  // ============================================================
  // 格式化
  // ============================================================

  private fmtCost(cost: number): string {
    if (cost < 0.01) { return `¥${cost.toFixed(4)}`; }
    if (cost < 1) { return `¥${cost.toFixed(3)}`; }
    return `¥${cost.toFixed(2)}`;
  }

  private fmtTokens(n: number): string {
    if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(2)}M`; }
    if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}k`; }
    return String(n);
  }

  private fmtDuration(ms: number): string {
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) { return `${hrs}h ${mins % 60}m`; }
    return `${mins}m`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
