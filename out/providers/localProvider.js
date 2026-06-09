"use strict";
/**
 * 本地解析提供商 —— 通过读取工具本地缓存/日志文件来统计用量。
 * 支持解析以下工具的本地数据：
 *  - Continue.dev  (~/.continue/)
 *  - Cline         (%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev)
 *  - Aider         (~/.aider/)
 *  - 自定义 JSONL/CSV 日志文件
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
exports.LocalProvider = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const base_1 = require("./base");
/** 已知工具的本地数据路径模式 */
const KNOWN_TOOL_PATTERNS = [
    {
        name: 'Continue',
        pattern: '.continue',
        /** Continue 在 ~/.continue/ 下存储 session 日志 */
        globs: ['**/session-*.json', '**/*.jsonl'],
    },
    {
        name: 'Cline',
        pattern: 'saoudrizwan.claude-dev',
        globs: ['**/task-*.json', '**/*.jsonl'],
    },
    {
        name: 'Aider',
        pattern: '.aider',
        globs: ['**/*.json', '**/*.jsonl', '**/history.jsonl'],
    },
];
/**
 * 递归搜索匹配 glob pattern 的文件
 * 仅支持 ** 和 * 通配符（简化实现）
 */
function findFiles(dir, patterns, maxDepth = 5) {
    const results = [];
    const seen = new Set();
    function walk(currentDir, depth) {
        if (depth > maxDepth) {
            return;
        }
        let entries;
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (seen.has(fullPath)) {
                continue;
            }
            seen.add(fullPath);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.git') && !entry.name.startsWith('node_modules')) {
                    walk(fullPath, depth + 1);
                }
            }
            else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (ext === '.json' || ext === '.jsonl' || ext === '.csv' || ext === '.log') {
                    results.push(fullPath);
                }
            }
        }
    }
    walk(dir, 0);
    return results;
}
/**
 * 从 JSON 对象中递归提取 usage 信息
 */
function extractUsage(obj, providerName) {
    const entries = [];
    if (!obj || typeof obj !== 'object') {
        return entries;
    }
    // 标准化 usage 字段
    function tryExtract(item, fallbackModel, fallbackTs) {
        const usage = item.usage || item.usage_metadata || item.token_usage;
        if (!usage) {
            return null;
        }
        const promptTokens = usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0;
        const completionTokens = usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0;
        const cacheHitTokens = usage.promptCacheHitTokens ?? usage.cache_hit_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
        const cacheMissTokens = usage.promptCacheMissTokens ?? usage.cache_miss_tokens ?? usage.prompt_cache_miss_tokens ?? 0;
        if (promptTokens === 0 && completionTokens === 0) {
            return null;
        }
        const model = item.model ?? fallbackModel ?? 'unknown';
        const ts = item.timestamp ?? item.ts ?? item.created_at ?? fallbackTs ?? Date.now();
        return {
            timestamp: typeof ts === 'number' ? ts : new Date(ts).getTime(),
            provider: providerName,
            model: String(model),
            promptTokens,
            completionTokens,
            cacheHitTokens,
            cacheMissTokens,
            cost: 0,
            endpoint: '/v1/chat/completions',
        };
    }
    // 数组
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const e = tryExtract(item);
            if (e) {
                entries.push(e);
            }
            // 递归提取嵌套数组
            entries.push(...extractUsage(item, providerName));
        }
        return entries;
    }
    // 对象
    const entry = tryExtract(obj);
    if (entry) {
        entries.push(entry);
    }
    // 递归提取嵌套对象
    for (const v of Object.values(obj)) {
        entries.push(...extractUsage(v, providerName));
    }
    return entries;
}
/**
 * 解析 JSONL 文件
 */
function parseJSONL(content) {
    return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    })
        .filter(Boolean);
}
class LocalProvider extends base_1.BaseProvider {
    constructor(config) {
        super({
            ...config,
            type: 'local',
            models: config.models ?? [],
        });
    }
    async fetchBalance(_apiKey) {
        // 本地模式无法获取余额
        return null;
    }
    async fetchRecentUsage(_apiKey, _days) {
        if (!this.config.localPaths?.length) {
            return [];
        }
        return this.parseLocalUsage(this.config.localPaths);
    }
    async parseLocalUsage(paths) {
        const allEntries = [];
        const expandedPaths = this.expandPaths(paths);
        for (const p of expandedPaths) {
            try {
                const stat = fs.statSync(p);
                if (stat.isDirectory()) {
                    const files = findFiles(p, ['**/*.json', '**/*.jsonl', '**/*.csv', '**/*.log']);
                    for (const file of files) {
                        const entries = await this.parseFile(file);
                        allEntries.push(...entries);
                    }
                }
                else {
                    const entries = await this.parseFile(p);
                    allEntries.push(...entries);
                }
            }
            catch (e) {
                console.error(`[DeepSeek Monitor] 读取 ${p} 失败:`, e);
            }
        }
        return allEntries;
    }
    /**
     * 展开路径中的环境变量和 ~
     */
    expandPaths(paths) {
        return paths.map((p) => {
            let expanded = p;
            // 展开 ~
            if (expanded.startsWith('~')) {
                const home = process.env.HOME || process.env.USERPROFILE || '';
                expanded = path.join(home, expanded.slice(1));
            }
            // 展开 %VAR% (Windows)
            expanded = expanded.replace(/%(\w+)%/g, (_, name) => process.env[name] || `%${name}%`);
            return expanded;
        });
    }
    async parseFile(filePath) {
        let content;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        }
        catch {
            return [];
        }
        const ext = path.extname(filePath).toLowerCase();
        const providerName = this.config.name;
        try {
            if (ext === '.jsonl') {
                const lines = parseJSONL(content);
                let entries = [];
                for (const obj of lines) {
                    entries.push(...extractUsage(obj, providerName));
                }
                return entries;
            }
            if (ext === '.json') {
                const obj = JSON.parse(content);
                return extractUsage(obj, providerName);
            }
            if (ext === '.csv') {
                return this.parseCSV(content);
            }
        }
        catch {
            // 解析失败，静默跳过
        }
        return [];
    }
    /**
     * 简易 CSV 解析 —— 兼容常见用量导出格式
     */
    parseCSV(content) {
        const lines = content.split('\n').filter((l) => l.trim());
        if (lines.length < 2) {
            return [];
        }
        const header = lines[0].toLowerCase().split(',');
        const idx = {
            model: header.findIndex((h) => h.includes('model')),
            promptTokens: header.findIndex((h) => h.includes('prompt') || h.includes('input')),
            completionTokens: header.findIndex((h) => h.includes('completion') || h.includes('output')),
            cacheHit: header.findIndex((h) => h.includes('cache_hit') || h.includes('cachehit')),
            cacheMiss: header.findIndex((h) => h.includes('cache_miss') || h.includes('cachemiss')),
            timestamp: header.findIndex((h) => h.includes('time') || h.includes('date')),
            cost: header.findIndex((h) => h.includes('cost') || h.includes('price')),
        };
        const entries = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length < 3) {
                continue;
            }
            entries.push({
                timestamp: new Date(cols[idx.timestamp] || Date.now()).getTime(),
                provider: this.config.name,
                model: cols[idx.model] || 'unknown',
                promptTokens: parseInt(cols[idx.promptTokens] || '0', 10) || 0,
                completionTokens: parseInt(cols[idx.completionTokens] || '0', 10) || 0,
                cacheHitTokens: parseInt(cols[idx.cacheHit] || '0', 10) || 0,
                cacheMissTokens: parseInt(cols[idx.cacheMiss] || '0', 10) || 0,
                cost: parseFloat(cols[idx.cost] || '0') || 0,
                endpoint: '/v1/chat/completions',
            });
        }
        return entries;
    }
    /**
     * 自动发现已知工具的本地数据
     */
    static discoverKnownPaths() {
        const discovered = [];
        const home = process.env.HOME || process.env.USERPROFILE || '';
        const appData = process.env.APPDATA || '';
        for (const tool of KNOWN_TOOL_PATTERNS) {
            // 搜索常见位置
            const candidates = [
                path.join(home, tool.pattern),
                path.join(appData, tool.pattern),
                path.join(home, '.vscode', tool.pattern),
            ];
            for (const c of candidates) {
                try {
                    if (fs.existsSync(c)) {
                        discovered.push(c);
                        break;
                    }
                }
                catch {
                    // skip
                }
            }
        }
        return discovered;
    }
}
exports.LocalProvider = LocalProvider;
//# sourceMappingURL=localProvider.js.map