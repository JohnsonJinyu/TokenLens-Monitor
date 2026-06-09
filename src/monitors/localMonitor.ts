/**
 * 本地模式监控器 —— 定时扫描本地缓存/日志文件来统计用量。
 * 适用于不支持 API 查询余额的平台，或作为辅助数据源。
 */

import * as fs from 'fs';
import { BaseProvider } from '../providers/base';
import { UsageTracker } from '../tracker/usageTracker';
import { LocalProvider } from '../providers/localProvider';

export class LocalMonitor {
  private tracker: UsageTracker;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private running: boolean = false;

  /** 已扫描文件的 mtime 缓存，用于增量扫描 */
  private fileMTimes: Map<string, number> = new Map();

  constructor(tracker: UsageTracker) {
    this.tracker = tracker;
  }

  /** 启动本地监控（定时扫描） */
  start(providers: BaseProvider[]): void {
    if (this.running) {return;}
    this.running = true;

    const localProviders = providers.filter((p) => p.config.type === 'local');
    if (localProviders.length === 0) {
      console.log('[DeepSeek Monitor] 本地监控未启动：没有本地提供商');
      return;
    }

    // 立即扫描一次
    this.scanAll(localProviders);

    // 每 60 秒增量扫描
    this.scanInterval = setInterval(() => {
      this.scanAll(localProviders);
    }, 60000);

    console.log('[DeepSeek Monitor] 本地监控已启动，扫描间隔: 60 秒');
  }

  /** 停止本地监控 */
  stop(): void {
    this.running = false;
    if (this.scanInterval) {clearInterval(this.scanInterval); this.scanInterval = null;}
    console.log('[DeepSeek Monitor] 本地监控已停止');
  }

  /** 扫描所有本地提供商 */
  private async scanAll(providers: BaseProvider[]): Promise<void> {
    for (const provider of providers) {
      try {
        const paths = provider.config.localPaths ?? [];
        if (paths.length === 0) {continue;}

        // 只扫描有变更的文件
        const changedPaths = paths.filter((p) => this.hasChanged(p));
        if (changedPaths.length === 0) {continue;}

        const entries = await provider.parseLocalUsage(changedPaths);
        if (entries.length > 0) {
          this.tracker.recordUsage(entries);
        }
      } catch (e) {
        console.error(`[DeepSeek Monitor] ${provider.id} 本地扫描失败:`, e);
      }
    }
  }

  /** 检查文件/目录是否有变更 */
  private hasChanged(p: string): boolean {
    try {
      const stat = fs.statSync(p);
      const prev = this.fileMTimes.get(p);
      const current = stat.mtimeMs;

      if (stat.isDirectory()) {
        // 目录：递归检查子文件 mtime
        const files = this.listFiles(p);
        let changed = false;
        for (const f of files) {
          try {
            const fsStat = fs.statSync(f);
            const prevM = this.fileMTimes.get(f);
            if (!prevM || fsStat.mtimeMs > prevM) {
              this.fileMTimes.set(f, fsStat.mtimeMs);
              changed = true;
            }
          } catch { /* skip */ }
        }
        return changed;
      }

      // 文件：直接比较 mtime
      this.fileMTimes.set(p, current);
      return !prev || current > prev;
    } catch {
      return false;
    }
  }

  private listFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const fp = `${dir}/${e.name}`;
        if (e.isDirectory() && !e.name.startsWith('.')) {
          results.push(...this.listFiles(fp));
        } else if (e.isFile()) {
          results.push(fp);
        }
      }
    } catch { /* skip */ }
    return results;
  }

  /** 手动强制扫描全部 */
  async forceScanAll(providers: BaseProvider[]): Promise<void> {
    this.fileMTimes.clear();
    await this.scanAll(providers);
  }

  get isRunning(): boolean {
    return this.running;
  }
}
