/**
 * 提供商注册中心 —— 管理所有活跃的提供商实例。
 */

import { BaseProvider, ProviderConfig } from './base';
import { DeepSeekProvider } from './deepseek';
import { OpenAICompatProvider } from './openaiCompat';
import { LocalProvider } from './localProvider';

export class ProviderRegistry {
  private providers: Map<string, BaseProvider> = new Map();
  private _onChange: Array<() => void> = [];

  /** 注册变更回调 */
  onChange(cb: () => void): void {
    this._onChange.push(cb);
  }

  private notify(): void {
    for (const cb of this._onChange) {
      try { cb(); } catch { /* swallow */ }
    }
  }

  /** 注册/更新提供商 */
  register(config: ProviderConfig): BaseProvider {
    let provider: BaseProvider;

    if (config.name === 'DeepSeek') {
      provider = new DeepSeekProvider(config);
    } else if (config.type === 'local') {
      provider = new LocalProvider(config);
    } else {
      provider = new OpenAICompatProvider(config);
    }

    this.providers.set(config.name, provider);
    this.notify();
    return provider;
  }

  /** 移除提供商 */
  unregister(name: string): void {
    this.providers.delete(name);
    this.notify();
  }

  /** 获取提供商 */
  get(name: string): BaseProvider | undefined {
    return this.providers.get(name);
  }

  /** 获取全部提供商 */
  getAll(): BaseProvider[] {
    return Array.from(this.providers.values());
  }

  /** 获取 api 类型的提供商 */
  getApiProviders(): BaseProvider[] {
    return this.getAll().filter((p) => p.config.type === 'api');
  }

  /** 获取 local 类型的提供商 */
  getLocalProviders(): BaseProvider[] {
    return this.getAll().filter((p) => p.config.type === 'local');
  }

  /** 总数 */
  get count(): number {
    return this.providers.size;
  }

  /** 清空 */
  clear(): void {
    this.providers.clear();
    this.notify();
  }

  /** 初始化默认识别 DeepSeek */
  initDefaults(apiKey?: string): void {
    // DeepSeek API 提供
    this.register({
      name: 'DeepSeek',
      type: 'api',
      apiBase: 'https://api.deepseek.com',
      apiKey,
      models: ['deepseek-chat', 'deepseek-reasoner'],
    });

    // 自动发现本地数据
    const localPaths = LocalProvider.discoverKnownPaths();
    if (localPaths.length > 0) {
      this.register({
        name: 'Local Cache',
        type: 'local',
        models: [],
        localPaths,
      });
    }
  }
}

/** 全局单例 */
export const registry = new ProviderRegistry();
