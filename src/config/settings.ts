/**
 * 扩展配置管理 —— 封装 VSCode workspace configuration 读取。
 */

import * as vscode from 'vscode';
import type { ProviderConfig, ModelPricing } from '../providers/base';

const SECTION = 'tokenLens';

// ---- API & Provider ----
export function getApiKey(): string {
  return vscode.workspace.getConfiguration(SECTION).get<string>('apiKey', '').trim();
}

export function getApiBase(): string {
  const value = vscode.workspace.getConfiguration(SECTION).get<string>('apiBase', 'https://api.deepseek.com').trim();
  return value.replace(/\/+$/, '') || 'https://api.deepseek.com';
}

export function getProviders(): ProviderConfig[] {
  return vscode.workspace.getConfiguration(SECTION).get<ProviderConfig[]>('providers', []);
}

// ---- Intervals ----
export function getBalanceCheckInterval(): number {
  return vscode.workspace.getConfiguration(SECTION).get<number>('balanceCheckInterval', 5);
}

export function getUsagePollInterval(): number {
  return vscode.workspace.getConfiguration(SECTION).get<number>('usagePollInterval', 30);
}

// ---- Interceptor ----
export function getInterceptEnabled(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>('interceptEnabled', true);
}

export function getAutoStart(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>('autoStart', true);
}

// ---- Context Window ----
export function getContextWindowSizes(): Record<string, number> {
  return vscode.workspace.getConfiguration(SECTION).get<Record<string, number>>('contextWindowSizes', {});
}

export function getContextWarnThreshold(): number {
  return vscode.workspace.getConfiguration(SECTION).get<number>('contextWarnThreshold', 70);
}

export function getContextCriticalThreshold(): number {
  return vscode.workspace.getConfiguration(SECTION).get<number>('contextCriticalThreshold', 85);
}

// ---- Cost Alert ----
export function getCostAlertThreshold(): number {
  return vscode.workspace.getConfiguration(SECTION).get<number>('costAlertThreshold', 10);
}

export function getShowNotificationOnUpdate(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>('showNotificationOnUpdate', false);
}

export function getShowCacheHitRate(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>('showCacheHitRate', true);
}

export function getTheme(): 'auto' | 'dark' | 'light' {
  return vscode.workspace.getConfiguration(SECTION).get<'auto' | 'dark' | 'light'>('theme', 'auto');
}

// ---- Local Monitor ----
export function getLocalMonitorPaths(): string[] {
  return vscode.workspace.getConfiguration(SECTION).get<string[]>('localMonitorPaths', []);
}

// ---- Pricing ----
export function getPricing(): Record<string, { input: number; output: number; currency: string; cacheHitDiscount?: number }> {
  return vscode.workspace.getConfiguration(SECTION).get<Record<string, any>>('pricing', {});
}

export function getMaxLogEntries(): number {
  return vscode.workspace.getConfiguration(SECTION).get<number>('maxLogEntries', 500);
}

/** 将用户配置的定价注入到 provider */
export function applyPricing(pricingMap: Record<string, any>, setPricing: (model: string, p: ModelPricing) => void): void {
  for (const [model, p] of Object.entries(pricingMap)) {
    if (typeof p.input === 'number' && typeof p.output === 'number') {
      setPricing(model, {
        input: p.input,
        output: p.output,
        currency: p.currency ?? 'CNY',
        cacheHitDiscount: p.cacheHitDiscount,
      });
    }
  }
}
