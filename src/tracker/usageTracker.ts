/**
 * 用量追踪器 —— 核心统计引擎。
 * 聚合来自 API 监控和本地解析的用量数据，计算费用和缓存命中率。
 */

import type { UsageEntry, BalanceInfo, ProviderStats } from '../providers/base';
import { StorageManager, SessionStats } from './storage';
import { getContextWindowSizes } from '../config/settings';

export interface GlobalStats {
  /** 各 provider 的统计 */
  byProvider: Map<string, ProviderStats>;
  /** 总计 */
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  /** 全局缓存命中率 */
  globalCacheHitRate: number;
  /** 会话运行时长 (ms) */
  sessionDuration: number;
  /** 最近一次请求的上下文窗口占比 (0-100)，无数据时为 0 */
  lastContextPercent: number;
  /** 最近一次请求的模型名 */
  lastModel: string;
}

export class UsageTracker {
  private storage: StorageManager;
  private listeners: Array<(stats: GlobalStats) => void> = [];
  private _lastUpdate: number = 0;
  /** 最近一次记录的 usage entry（用于计算上下文窗口占比） */
  private lastEntry: UsageEntry | null = null;

  constructor(storage: StorageManager) {
    this.storage = storage;
  }

  /** 监听统计更新 */
  onUpdate(cb: (stats: GlobalStats) => void): void {
    this.listeners.push(cb);
  }

  /** 通知所有监听者 */
  private notify(stats: GlobalStats): void {
    for (const cb of this.listeners) {
      try { cb(stats); } catch { /* swallow */ }
    }
  }

  /**
   * 记录用量条目 —— 聚合到会话统计
   */
  recordUsage(entries: UsageEntry[]): void {
    if (entries.length === 0) {return;}

    // 记录最后一个 entry（用于上下文窗口占比计算）
    this.lastEntry = entries[entries.length - 1];

    const session = this.storage.getSessionStats();

    for (const entry of entries) {
      session.totalPromptTokens += entry.promptTokens;
      session.totalCompletionTokens += entry.completionTokens;
      session.totalCost += entry.cost;
      session.totalRequests += 1;

      // 按模型统计
      if (!session.byModel[entry.model]) {
        session.byModel[entry.model] = {
          provider: entry.provider,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          requests: 0,
          cacheHitTokens: 0,
          cacheMissTokens: 0,
        };
      }
      const m = session.byModel[entry.model];
      m.provider = entry.provider;
      m.promptTokens += entry.promptTokens;
      m.completionTokens += entry.completionTokens;
      m.cost += entry.cost;
      m.requests += 1;
      m.cacheHitTokens += (entry.cacheHitTokens ?? 0);
      m.cacheMissTokens += (entry.cacheMissTokens ?? 0);
    }

    this.storage.updateSessionStats(session);
    this.storage.appendUsage(entries);

    this._lastUpdate = Date.now();

    // 通知监听者
    this.notify(this.getStats());
  }

  /**
   * 获取全局统计
   */
  getStats(): GlobalStats {
    const session = this.storage.getSessionStats();
    const balanceCache = this.storage.getBalanceCache();

    // 构建 ProviderStats
    const byProvider = new Map<string, ProviderStats>();
    const makeProviderStats = (provider: string): ProviderStats => ({
      provider,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      totalRequests: 0,
      cacheHitRate: 0,
      byModel: new Map(),
      balance: balanceCache[provider]?.info,
    });

    for (const [model, m] of Object.entries(session.byModel)) {
      // 旧版本持久化数据没有 provider 字段，保留模型名推断作为兼容兜底。
      const provider = m.provider ?? (model.includes('deepseek') ? 'DeepSeek' : 'Other');

      if (!byProvider.has(provider)) {
        byProvider.set(provider, makeProviderStats(provider));
      }

      const ps = byProvider.get(provider)!;
      ps.totalPromptTokens += m.promptTokens;
      ps.totalCompletionTokens += m.completionTokens;
      ps.totalCost += m.cost;
      ps.totalRequests += m.requests;

      ps.byModel.set(model, { ...m });

      // 计算缓存命中率
      const totalCache = m.cacheHitTokens + m.cacheMissTokens;
      if (totalCache > 0) {
        m.cacheHitRate = (m.cacheHitTokens / totalCache) * 100;
      }
      // 收归到 provider 级别的缓存命中率
      const providerTotal = ps.byModel.size > 0
        ? Array.from(ps.byModel.values()).reduce(
            (a, v) => a + v.cacheHitTokens + v.cacheMissTokens, 0
          )
        : 0;
      if (providerTotal > 0) {
        const providerHit = Array.from(ps.byModel.values()).reduce(
          (a, v) => a + v.cacheHitTokens, 0
        );
        ps.cacheHitRate = (providerHit / providerTotal) * 100;
      }
    }

    // 权益查询可能先于任何请求完成。不要因为暂无用量就丢掉 provider，
    // 否则面板会一直停留在引导态，看不到账户权益和运行状态。
    for (const [provider] of Object.entries(balanceCache)) {
      if (!byProvider.has(provider)) {
        byProvider.set(provider, makeProviderStats(provider));
      }
    }

    // 全局缓存命中率
    let allCacheHits = 0;
    let allCacheTotal = 0;
    for (const [, m] of Object.entries(session.byModel)) {
      allCacheHits += m.cacheHitTokens;
      allCacheTotal += m.cacheHitTokens + m.cacheMissTokens;
    }
    const globalCacheHitRate = allCacheTotal > 0 ? (allCacheHits / allCacheTotal) * 100 : 0;

    // 计算上下文窗口占比
    let lastContextPercent = 0;
    let lastModel = '';
    if (this.lastEntry) {
      lastModel = this.lastEntry.model;
      const contextSizes = getContextWindowSizes();
      const maxContext = contextSizes[lastModel] || 131072; // 默认 128k
      const totalPrompt = this.lastEntry.promptTokens;
      if (maxContext > 0 && totalPrompt > 0) {
        lastContextPercent = Math.round((totalPrompt / maxContext) * 100);
      }
    }

    return {
      byProvider,
      totalCost: session.totalCost,
      totalTokens: session.totalPromptTokens + session.totalCompletionTokens,
      totalRequests: session.totalRequests,
      globalCacheHitRate,
      sessionDuration: Date.now() - session.startTime,
      lastContextPercent,
      lastModel,
    };
  }

  /**
   * 更新余额缓存
   */
  updateBalance(provider: string, info: BalanceInfo): void {
    this.storage.updateBalanceCache(provider, info);
    this.notify(this.getStats());
  }

  /**
   * 重置会话
   */
  resetSession(): void {
    this.storage.resetSession();
    this.notify(this.getStats());
  }

  get lastUpdate(): number {
    return this._lastUpdate;
  }
}
