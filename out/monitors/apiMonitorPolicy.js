"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProviderApiKey = resolveProviderApiKey;
exports.isEntitlementPollingEnabled = isEntitlementPollingEnabled;
exports.isUsageApiPollingEnabled = isUsageApiPollingEnabled;
function resolveProviderApiKey(provider, globalApiKey) {
    const providerKey = (provider.apiKey || '').trim();
    if (providerKey) {
        return providerKey;
    }
    return provider.name === 'DeepSeek' ? globalApiKey.trim() : '';
}
function isEntitlementPollingEnabled(provider) {
    return provider.capabilities?.entitlement !== false;
}
function isUsageApiPollingEnabled(provider) {
    return provider.capabilities?.usageApi !== false;
}
//# sourceMappingURL=apiMonitorPolicy.js.map