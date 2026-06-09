/**
 * API 模式监控器 —— 通过定时轮询各提供商的 API 来获取余额和用量。
 */

import { BaseProvider, BalanceInfo, UsageEntry } from '../providers/base';
import { UsageTracker } from '../tracker/usageTracker';
import { getApiKey, getBalanceCheckInterval } from '../config/settings';

export class ApiMonitor {
  private tracker: UsageTracker;
  private balanceInterval: ReturnType<typeof setInterval> | null = null;
  private usageInterval: ReturnType<typeof setInterval> | null = null;
  private running: boolean = false;
  private apiKey: string = '';
  private lastBalanceAt: number = 0;
  private lastUsageAt: number = 0;
  private lastError: string = '';
  private lastEntryCount: number = 0;

  /** 上次请求 ID 去重 */
  private seenRequestIds: Set<string> = new Set();

  constructor(tracker: UsageTracker) {
    this.tracker = tracker;
  }

  /** 启动 API 监控（定时轮询） */
  start(providers: BaseProvider[]): void {
    if (this.running) {return;}
    this.running = true;
    this.apiKey = getApiKey();
    this.lastError = '';

    if (!this.apiKey || providers.length === 0) {
      console.log('[DeepSeek Monitor] API 监控未启动：缺少 API Key 或没有 API 提供商');
      return;
    }

    const intervalMinutes = getBalanceCheckInterval();
    const intervalMs = intervalMinutes * 60 * 1000;

    // 立即执行一次
    this.pollBalance(providers);
    this.pollUsage(providers);

    // 定时余额
    this.balanceInterval = setInterval(() => {
      this.pollBalance(providers);
    }, intervalMs);

    // 定时用量 — 频率快一些（30秒）
    this.usageInterval = setInterval(() => {
      this.pollUsage(providers);
    }, 30000);

    console.log(`[DeepSeek Monitor] API 监控已启动，余额查询间隔: ${intervalMinutes} 分钟`);
  }

  /** 停止 API 监控 */
  stop(): void {
    this.running = false;
    if (this.balanceInterval) {clearInterval(this.balanceInterval); this.balanceInterval = null;}
    if (this.usageInterval) {clearInterval(this.usageInterval); this.usageInterval = null;}
    console.log('[DeepSeek Monitor] API 监控已停止');
  }

  /** 轮询余额 */
  private async pollBalance(providers: BaseProvider[]): Promise<void> {
    for (const provider of providers) {
      try {
        const balance = await provider.fetchBalance(this.apiKey);
        if (balance) {
          this.tracker.updateBalance(provider.id, balance);
          this.lastBalanceAt = Date.now();
        }
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        console.error(`[DeepSeek Monitor] ${provider.id} 余额查询失败:`, e);
      }
    }
  }

  /** 轮询用量 */
  private async pollUsage(providers: BaseProvider[]): Promise<void> {
    for (const provider of providers) {
      try {
        const entries = await provider.fetchRecentUsage(this.apiKey, 1);
        // 去重
        const newEntries = entries.filter((e) => {
          const id = `${e.provider}-${e.model}-${e.timestamp}-${e.promptTokens}-${e.completionTokens}`;
          if (this.seenRequestIds.has(id)) {return false;}
          this.seenRequestIds.add(id);
          return true;
        });

        if (newEntries.length > 0) {
          this.tracker.recordUsage(newEntries);
        }
        this.lastUsageAt = Date.now();
        this.lastEntryCount = newEntries.length;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        console.error(`[DeepSeek Monitor] ${provider.id} 用量查询失败:`, e);
      }
    }

    // 限制去重集合大小
    if (this.seenRequestIds.size > 10000) {
      const arr = Array.from(this.seenRequestIds).slice(-5000);
      this.seenRequestIds = new Set(arr);
    }
  }

  /** 手动刷新全部 */
  async refreshAll(providers: BaseProvider[]): Promise<void> {
    await Promise.all([
      this.pollBalance(providers),
      this.pollUsage(providers),
    ]);
  }

  get isRunning(): boolean {
    return this.running;
  }

  getStatus(): {
    running: boolean;
    configured: boolean;
    lastBalanceAt: number;
    lastUsageAt: number;
    lastError: string;
    lastEntryCount: number;
  } {
    return {
      running: this.running,
      configured: !!this.apiKey,
      lastBalanceAt: this.lastBalanceAt,
      lastUsageAt: this.lastUsageAt,
      lastError: this.lastError,
      lastEntryCount: this.lastEntryCount,
    };
  }
}
