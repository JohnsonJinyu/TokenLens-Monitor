"use strict";
/**
 * 扩展配置管理 —— 封装 VSCode workspace configuration 读取。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiKey = getApiKey;
exports.getApiBase = getApiBase;
exports.getProviders = getProviders;
exports.getBalanceCheckInterval = getBalanceCheckInterval;
exports.getUsagePollInterval = getUsagePollInterval;
exports.getInterceptEnabled = getInterceptEnabled;
exports.getAutoStart = getAutoStart;
exports.getContextWindowSizes = getContextWindowSizes;
exports.getContextWarnThreshold = getContextWarnThreshold;
exports.getContextCriticalThreshold = getContextCriticalThreshold;
exports.getCostAlertThreshold = getCostAlertThreshold;
exports.getStatusBarDisplay = getStatusBarDisplay;
exports.getShowNotificationOnUpdate = getShowNotificationOnUpdate;
exports.getShowCacheHitRate = getShowCacheHitRate;
exports.getTheme = getTheme;
exports.getLocalMonitorPaths = getLocalMonitorPaths;
exports.getPricing = getPricing;
exports.getMaxLogEntries = getMaxLogEntries;
exports.applyPricing = applyPricing;
const vscode = __importStar(require("vscode"));
const SECTION = 'tokenLens';
// ---- API & Provider ----
function getApiKey() {
    return vscode.workspace.getConfiguration(SECTION).get('apiKey', '').trim();
}
function getApiBase() {
    const value = vscode.workspace.getConfiguration(SECTION).get('apiBase', 'https://api.deepseek.com').trim();
    return value.replace(/\/+$/, '') || 'https://api.deepseek.com';
}
function getProviders() {
    return vscode.workspace.getConfiguration(SECTION).get('providers', []);
}
// ---- Intervals ----
function getBalanceCheckInterval() {
    return vscode.workspace.getConfiguration(SECTION).get('balanceCheckInterval', 5);
}
function getUsagePollInterval() {
    return vscode.workspace.getConfiguration(SECTION).get('usagePollInterval', 30);
}
// ---- Interceptor ----
function getInterceptEnabled() {
    return vscode.workspace.getConfiguration(SECTION).get('interceptEnabled', true);
}
function getAutoStart() {
    return vscode.workspace.getConfiguration(SECTION).get('autoStart', true);
}
// ---- Context Window ----
function getContextWindowSizes() {
    return vscode.workspace.getConfiguration(SECTION).get('contextWindowSizes', {});
}
function getContextWarnThreshold() {
    return vscode.workspace.getConfiguration(SECTION).get('contextWarnThreshold', 70);
}
function getContextCriticalThreshold() {
    return vscode.workspace.getConfiguration(SECTION).get('contextCriticalThreshold', 85);
}
// ---- Cost Alert ----
function getCostAlertThreshold() {
    return vscode.workspace.getConfiguration(SECTION).get('costAlertThreshold', 10);
}
// ---- Display ----
function getStatusBarDisplay() {
    return vscode.workspace.getConfiguration(SECTION).get('statusBarDisplay', 'cost-tokens-cache');
}
function getShowNotificationOnUpdate() {
    return vscode.workspace.getConfiguration(SECTION).get('showNotificationOnUpdate', false);
}
function getShowCacheHitRate() {
    return vscode.workspace.getConfiguration(SECTION).get('showCacheHitRate', true);
}
function getTheme() {
    return vscode.workspace.getConfiguration(SECTION).get('theme', 'auto');
}
// ---- Local Monitor ----
function getLocalMonitorPaths() {
    return vscode.workspace.getConfiguration(SECTION).get('localMonitorPaths', []);
}
// ---- Pricing ----
function getPricing() {
    return vscode.workspace.getConfiguration(SECTION).get('pricing', {});
}
function getMaxLogEntries() {
    return vscode.workspace.getConfiguration(SECTION).get('maxLogEntries', 500);
}
/** 将用户配置的定价注入到 provider */
function applyPricing(pricingMap, setPricing) {
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
//# sourceMappingURL=settings.js.map