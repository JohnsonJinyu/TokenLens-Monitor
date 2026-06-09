"use strict";
/**
 * 本地模式监控器 —— 定时扫描本地缓存/日志文件来统计用量。
 * 适用于不支持 API 查询余额的平台，或作为辅助数据源。
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
exports.LocalMonitor = void 0;
const fs = __importStar(require("fs"));
class LocalMonitor {
    constructor(tracker) {
        this.scanInterval = null;
        this.running = false;
        this.configured = false;
        this.lastScanAt = 0;
        this.lastError = '';
        this.lastEntryCount = 0;
        /** 已扫描文件的 mtime 缓存，用于增量扫描 */
        this.fileMTimes = new Map();
        this.tracker = tracker;
    }
    /** 启动本地监控（定时扫描） */
    start(providers) {
        if (this.running) {
            return;
        }
        this.running = true;
        const localProviders = providers.filter((p) => p.config.type === 'local');
        this.configured = localProviders.length > 0;
        if (localProviders.length === 0) {
            console.log('[TokenLens] 本地监控未启动：没有本地提供商');
            return;
        }
        // 立即扫描一次
        this.scanAll(localProviders);
        // 每 60 秒增量扫描
        this.scanInterval = setInterval(() => {
            this.scanAll(localProviders);
        }, 60000);
        console.log('[TokenLens] 本地监控已启动，扫描间隔: 60 秒');
    }
    /** 停止本地监控 */
    stop() {
        this.running = false;
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
        console.log('[TokenLens] 本地监控已停止');
    }
    /** 扫描所有本地提供商 */
    async scanAll(providers) {
        for (const provider of providers) {
            try {
                const paths = provider.config.localPaths ?? [];
                if (paths.length === 0) {
                    continue;
                }
                // 只扫描有变更的文件
                const changedPaths = paths.filter((p) => this.hasChanged(p));
                if (changedPaths.length === 0) {
                    continue;
                }
                const entries = await provider.parseLocalUsage(changedPaths);
                this.lastScanAt = Date.now();
                this.lastEntryCount = entries.length;
                if (entries.length > 0) {
                    this.tracker.recordUsage(entries);
                }
            }
            catch (e) {
                this.lastError = e instanceof Error ? e.message : String(e);
                console.error(`[TokenLens] ${provider.id} 本地扫描失败:`, e);
            }
        }
    }
    /** 检查文件/目录是否有变更 */
    hasChanged(p) {
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
                    }
                    catch { /* skip */ }
                }
                return changed;
            }
            // 文件：直接比较 mtime
            this.fileMTimes.set(p, current);
            return !prev || current > prev;
        }
        catch {
            return false;
        }
    }
    listFiles(dir) {
        const results = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
                const fp = `${dir}/${e.name}`;
                if (e.isDirectory() && !e.name.startsWith('.')) {
                    results.push(...this.listFiles(fp));
                }
                else if (e.isFile()) {
                    results.push(fp);
                }
            }
        }
        catch { /* skip */ }
        return results;
    }
    /** 手动强制扫描全部 */
    async forceScanAll(providers) {
        this.fileMTimes.clear();
        await this.scanAll(providers);
    }
    get isRunning() {
        return this.running;
    }
    getStatus() {
        return {
            running: this.running,
            configured: this.configured,
            lastScanAt: this.lastScanAt,
            lastError: this.lastError,
            lastEntryCount: this.lastEntryCount,
        };
    }
}
exports.LocalMonitor = LocalMonitor;
//# sourceMappingURL=localMonitor.js.map