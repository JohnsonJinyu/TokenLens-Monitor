import type { ProviderConfig } from '../providers/base';

export function resolveProviderApiKey(provider: Pick<ProviderConfig, 'name' | 'apiKey'>, globalApiKey: string): string {
  const providerKey = (provider.apiKey || '').trim();
  if (providerKey) {
    return providerKey;
  }
  return provider.name === 'DeepSeek' ? globalApiKey.trim() : '';
}

export function isEntitlementPollingEnabled(provider: Pick<ProviderConfig, 'capabilities'>): boolean {
  return provider.capabilities?.entitlement !== false;
}

export function isUsageApiPollingEnabled(provider: Pick<ProviderConfig, 'capabilities'>): boolean {
  return provider.capabilities?.usageApi !== false;
}
