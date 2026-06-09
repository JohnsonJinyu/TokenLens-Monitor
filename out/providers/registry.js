"use strict";
/**
 * 提供商注册中心 —— 管理所有活跃的提供商实例。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registry = exports.ProviderRegistry = void 0;
const deepseek_1 = require("./deepseek");
const openaiCompat_1 = require("./openaiCompat");
const localProvider_1 = require("./localProvider");
class ProviderRegistry {
    constructor() {
        this.providers = new Map();
        this._onChange = [];
    }
    /** 注册变更回调 */
    onChange(cb) {
        this._onChange.push(cb);
    }
    notify() {
        for (const cb of this._onChange) {
            try {
                cb();
            }
            catch { /* swallow */ }
        }
    }
    /** 注册/更新提供商 */
    register(config) {
        let provider;
        if (config.name === 'DeepSeek') {
            provider = new deepseek_1.DeepSeekProvider(config);
        }
        else if (config.type === 'local') {
            provider = new localProvider_1.LocalProvider(config);
        }
        else {
            provider = new openaiCompat_1.OpenAICompatProvider(config);
        }
        this.providers.set(config.name, provider);
        this.notify();
        return provider;
    }
    /** 移除提供商 */
    unregister(name) {
        this.providers.delete(name);
        this.notify();
    }
    /** 获取提供商 */
    get(name) {
        return this.providers.get(name);
    }
    /** 获取全部提供商 */
    getAll() {
        return Array.from(this.providers.values());
    }
    /** 获取 api 类型的提供商 */
    getApiProviders() {
        return this.getAll().filter((p) => p.config.type === 'api');
    }
    /** 获取 local 类型的提供商 */
    getLocalProviders() {
        return this.getAll().filter((p) => p.config.type === 'local');
    }
    /** 总数 */
    get count() {
        return this.providers.size;
    }
    /** 清空 */
    clear() {
        this.providers.clear();
        this.notify();
    }
    /** 初始化默认识别 DeepSeek */
    initDefaults(apiKey) {
        // DeepSeek API 提供
        this.register({
            name: 'DeepSeek',
            type: 'api',
            apiBase: 'https://api.deepseek.com',
            apiKey,
            models: ['deepseek-chat', 'deepseek-reasoner'],
        });
        // 自动发现本地数据
        const localPaths = localProvider_1.LocalProvider.discoverKnownPaths();
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
exports.ProviderRegistry = ProviderRegistry;
/** 全局单例 */
exports.registry = new ProviderRegistry();
//# sourceMappingURL=registry.js.map