/**
 * 提供商抽象基类 —— 定义统一的监控接口。
 * 支持两种模式：
 *  - "api"   → 通过 HTTP API 实时查询余额/用量
 *  - "local" → 解析本地缓存/日志文件
 */

export interface ProviderConfig {
  name: string;
  type: 'api' | 'local';
  apiBase?: string;
  apiKey?: string;
  models: string[];
  /** 本地监控模式下的文件路径（glob patterns） */
  localPaths?: string[];
}

export interface BalanceInfo {
  /** 总充值金额 */
  totalCharged: number;
  /** 已消费金额 */
  totalUsed: number;
  /** 剩余余额 */
  balance: number;
  /** 赠送余额 */
  giftBalance?: number;
  /** 货币单位 */
  currency: string;
  /** 数据获取时间 */
  fetchedAt: number;
}

export interface ModelPricing {
  input: number;   // 每百万 token 价格
  output: number;
  currency: string;
  /** 缓存命中时的折扣比例 (0-1)，如 0.5 表示半价 */
  cacheHitDiscount?: number;
}

export interface UsageEntry {
  timestamp: number;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** 缓存命中 tokens */
  cacheHitTokens?: number;
  /** 缓存未命中 tokens */
  cacheMissTokens?: number;
  cost: number;
  endpoint: string;
}

export interface ProviderStats {
  provider: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  totalRequests: number;
  /** 缓存命中率 (0-100) */
  cacheHitRate: number;
  /** 按模型分组统计 */
  byModel: Map<string, {
    promptTokens: number;
    completionTokens: number;
    cost: number;
    requests: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
  }>;
  balance?: BalanceInfo;
}

export abstract class BaseProvider {
  public readonly config: ProviderConfig;
  protected pricing: Map<string, ModelPricing> = new Map();

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /** 提供商唯一标识 */
  get id(): string {
    return this.config.name;
  }

  /** 设置模型定价 */
  setPricing(model: string, pricing: ModelPricing): void {
    this.pricing.set(model, pricing);
  }

  /** 获取模型定价 */
  getPricing(model: string): ModelPricing | undefined {
    return this.pricing.get(model);
  }

  /** 计算费用 */
  calculateCost(model: string, promptTokens: number, completionTokens: number, cacheHitTokens?: number): number {
    const pricing = this.pricing.get(model);
    if (!pricing) {return 0;}

    let inputCost = (promptTokens / 1_000_000) * pricing.input;

    // 缓存命中部分享受折扣
    if (cacheHitTokens && pricing.cacheHitDiscount) {
      const hitTokens = cacheHitTokens;
      const missTokens = promptTokens - hitTokens;
      inputCost = (hitTokens / 1_000_000) * pricing.input * pricing.cacheHitDiscount
                + (missTokens / 1_000_000) * pricing.input;
    }

    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  /** 查询余额 —— api 模式子类实现 */
  abstract fetchBalance(apiKey: string): Promise<BalanceInfo | null>;

  /** 查询近期用量 —— api 模式子类实现 */
  abstract fetchRecentUsage(apiKey: string, days?: number): Promise<UsageEntry[]>;

  /** 解析本地文件 —— local 模式子类实现 */
  abstract parseLocalUsage(paths: string[]): Promise<UsageEntry[]>;
}
