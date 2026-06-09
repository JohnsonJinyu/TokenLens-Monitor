/**
 * 持久化存储 —— 基于 VSCode globalState，支持用量历史保留。
 */

import * as vscode from 'vscode';
import type { UsageEntry, BalanceInfo } from '../providers/base';

const KEY_USAGE_HISTORY = 'deepseekMonitor.usageHistory';
const KEY_SESSION_STATS = 'deepseekMonitor.sessionStats';
const KEY_BALANCE_CACHE = 'deepseekMonitor.balanceCache';

export interface SessionStats {
  startTime: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  totalRequests: number;
  /** 按模型分组 */
  byModel: Record<string, {
    provider?: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    requests: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    cacheHitRate?: number;
  }>;
}

export interface StoredBalanceCache {
  [provider: string]: {
    info: BalanceInfo;
    storedAt: number;
  };
}

export class StorageManager {
  private ctx: vscode.ExtensionContext;
  private maxEntries: number;

  constructor(ctx: vscode.ExtensionContext, maxEntries: number = 500) {
    this.ctx = ctx;
    this.maxEntries = maxEntries;
  }

  /** 获取用量历史 */
  getUsageHistory(): UsageEntry[] {
    return this.ctx.globalState.get<UsageEntry[]>(KEY_USAGE_HISTORY, []);
  }

  /** 追加用量记录（自动截断） */
  appendUsage(entries: UsageEntry[]): void {
    const history = this.getUsageHistory();
    history.push(...entries);
    if (history.length > this.maxEntries) {
      history.splice(0, history.length - this.maxEntries);
    }
    this.ctx.globalState.update(KEY_USAGE_HISTORY, history);
  }

  /** 清除全部用量历史 */
  clearHistory(): void {
    this.ctx.globalState.update(KEY_USAGE_HISTORY, []);
  }

  /** 获取本次会话统计 */
  getSessionStats(): SessionStats {
    const defaults: SessionStats = {
      startTime: Date.now(),
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      totalRequests: 0,
      byModel: {},
    };
    return this.ctx.globalState.get<SessionStats>(KEY_SESSION_STATS, defaults);
  }

  /** 更新会话统计 */
  updateSessionStats(stats: SessionStats): void {
    this.ctx.globalState.update(KEY_SESSION_STATS, stats);
  }

  /** 重置会话统计 */
  resetSession(): SessionStats {
    const fresh: SessionStats = {
      startTime: Date.now(),
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      totalRequests: 0,
      byModel: {},
    };
    this.ctx.globalState.update(KEY_SESSION_STATS, fresh);
    return fresh;
  }

  /** 获取缓存的余额信息 */
  getBalanceCache(): StoredBalanceCache {
    return this.ctx.globalState.get<StoredBalanceCache>(KEY_BALANCE_CACHE, {});
  }

  /** 更新余额缓存 */
  updateBalanceCache(provider: string, info: BalanceInfo): void {
    const cache = this.getBalanceCache();
    cache[provider] = { info, storedAt: Date.now() };
    this.ctx.globalState.update(KEY_BALANCE_CACHE, cache);
  }
}
