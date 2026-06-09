"use strict";
/**
 * 提供商抽象基类 —— 定义统一的监控接口。
 * 支持两种模式：
 *  - "api"   → 通过 HTTP API 实时查询余额/用量
 *  - "local" → 解析本地缓存/日志文件
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseProvider = void 0;
class BaseProvider {
    constructor(config) {
        this.pricing = new Map();
        this.config = config;
    }
    /** 提供商唯一标识 */
    get id() {
        return this.config.name;
    }
    /** 设置模型定价 */
    setPricing(model, pricing) {
        this.pricing.set(model, pricing);
    }
    /** 获取模型定价 */
    getPricing(model) {
        return this.pricing.get(model);
    }
    /** 计算费用 */
    calculateCost(model, promptTokens, completionTokens, cacheHitTokens) {
        const pricing = this.pricing.get(model);
        if (!pricing) {
            return 0;
        }
        let inputCost = (promptTokens / 1000000) * pricing.input;
        // 缓存命中部分享受折扣
        if (cacheHitTokens && pricing.cacheHitDiscount) {
            const hitTokens = cacheHitTokens;
            const missTokens = promptTokens - hitTokens;
            inputCost = (hitTokens / 1000000) * pricing.input * pricing.cacheHitDiscount
                + (missTokens / 1000000) * pricing.input;
        }
        const outputCost = (completionTokens / 1000000) * pricing.output;
        return inputCost + outputCost;
    }
}
exports.BaseProvider = BaseProvider;
//# sourceMappingURL=base.js.map