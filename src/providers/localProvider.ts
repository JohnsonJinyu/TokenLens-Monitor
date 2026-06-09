/**
 * 本地解析提供商 —— 通过读取工具本地缓存/日志文件来统计用量。
 * 支持解析以下工具的本地数据：
 *  - Continue.dev  (~/.continue/)
 *  - Cline         (%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev)
 *  - Aider         (~/.aider/)
 *  - 自定义 JSONL/CSV 日志文件
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseProvider, BalanceInfo, UsageEntry, ProviderConfig } from './base';

/** 已知工具的本地数据路径模式 */
const KNOWN_TOOL_PATTERNS = [
  {
    name: 'Continue',
    pattern: '.continue',
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
  {
    name: 'Roo Code',
    pattern: 'roo-code',
    globs: ['**/*.json', '**/*.jsonl'],
  },
  {
    name: 'Cody',
    pattern: 'sourcegraph.cody-ai',
    globs: ['**/*.json', '**/*.jsonl'],
  },
  {
    name: 'Copilot Chat',
    pattern: 'github.copilot-chat',
    globs: ['**/*.json', '**/*.jsonl'],
  },
  {
    name: 'CodeGPT',
    pattern: 'codegpt',
    globs: ['**/*.json', '**/*.jsonl'],
  },
];

interface ContinueSessionLog {
  sessionId?: string;
  messages?: Array<{
    role?: string;
    contents?: Array<{
      model?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        promptCacheHitTokens?: number;
        promptCacheMissTokens?: number;
      };
    }>;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  timestamp?: number;
  model?: string;
}

interface ClineTaskLog {
  taskId?: string;
  apiConversationHistory?: Array<{
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cacheHitTokens?: number;
      cacheMissTokens?: number;
    };
    model?: string;
    timestamp?: number;
  }>;
  apiConversationHistoryFormatted?: Array<{
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
    model?: string;
    ts?: number;
  }>;
  totalCost?: number;
  timestamp?: number;
}

/**
 * 递归搜索匹配 glob pattern 的文件
 * 仅支持 ** 和 * 通配符（简化实现）
 */
function findFiles(dir: string, patterns: string[], maxDepth: number = 5): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  function walk(currentDir: string, depth: number) {
    if (depth > maxDepth) {return;}

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (seen.has(fullPath)) {continue;}
      seen.add(fullPath);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.git') && !entry.name.startsWith('node_modules')) {
          walk(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
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
function extractUsage(obj: any, providerName: string): UsageEntry[] {
  const entries: UsageEntry[] = [];

  if (!obj || typeof obj !== 'object') {return entries;}

  // 标准化 usage 字段
  function tryExtract(item: any, fallbackModel?: string, fallbackTs?: number): UsageEntry | null {
    const usage = item.usage || item.usage_metadata || item.token_usage;
    if (!usage) {return null;}

    const promptTokens = usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0;
    const completionTokens = usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0;
    const cacheHitTokens = usage.promptCacheHitTokens ?? usage.cache_hit_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
    const cacheMissTokens = usage.promptCacheMissTokens ?? usage.cache_miss_tokens ?? usage.prompt_cache_miss_tokens ?? 0;

    if (promptTokens === 0 && completionTokens === 0) {return null;}

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
      if (e) {entries.push(e);}
      // 递归提取嵌套数组
      entries.push(...extractUsage(item, providerName));
    }
    return entries;
  }

  // 对象
  const entry = tryExtract(obj);
  if (entry) {entries.push(entry);}

  // 递归提取嵌套对象
  for (const v of Object.values(obj)) {
    entries.push(...extractUsage(v, providerName));
  }

  return entries;
}

/**
 * 解析 JSONL 文件
 */
function parseJSONL(content: string): any[] {
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

export class LocalProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      type: 'local',
      models: config.models ?? [],
    });
  }

  async fetchBalance(_apiKey: string): Promise<BalanceInfo | null> {
    // 本地模式无法获取余额
    return null;
  }

  async fetchRecentUsage(_apiKey: string, _days?: number): Promise<UsageEntry[]> {
    if (!this.config.localPaths?.length) {
      return [];
    }
    return this.parseLocalUsage(this.config.localPaths);
  }

  async parseLocalUsage(paths: string[]): Promise<UsageEntry[]> {
    const allEntries: UsageEntry[] = [];
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
        } else {
          const entries = await this.parseFile(p);
          allEntries.push(...entries);
        }
      } catch (e) {
        console.error(`[TokenLens] 读取 ${p} 失败:`, e);
      }
    }

    return allEntries;
  }

  /**
   * 展开路径中的环境变量和 ~
   */
  private expandPaths(paths: string[]): string[] {
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

  private async parseFile(filePath: string): Promise<UsageEntry[]> {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }

    const ext = path.extname(filePath).toLowerCase();
    const providerName = this.config.name;

    try {
      if (ext === '.jsonl') {
        const lines = parseJSONL(content);
        let entries: UsageEntry[] = [];
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
    } catch {
      // 解析失败，静默跳过
    }

    return [];
  }

  /**
   * 简易 CSV 解析 —— 兼容常见用量导出格式
   */
  private parseCSV(content: string): UsageEntry[] {
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length < 2) {return [];}

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

    const entries: UsageEntry[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 3) {continue;}
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
  static discoverKnownPaths(): string[] {
    const discovered: string[] = [];
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';

    for (const tool of KNOWN_TOOL_PATTERNS) {
      const candidates = [
        // 标准位置
        path.join(home, tool.pattern),
        path.join(appData, tool.pattern),
        path.join(localAppData, tool.pattern),
        // VSCode globalStorage
        path.join(appData, 'Code', 'User', 'globalStorage', tool.pattern),
        path.join(home, '.vscode', 'globalStorage', tool.pattern),
        path.join(home, '.vscode-server', 'data', 'User', 'globalStorage', tool.pattern),
        // 直接在 home 下
        path.join(home, tool.pattern),
        // 绝对路径兼容
        tool.pattern,
      ];
      for (const c of candidates) {
        try {
          if (fs.existsSync(c)) {
            discovered.push(c);
            console.log(`[TokenLens] 发现 ${tool.name} 数据: ${c}`);
            break;
          }
        } catch {
          // skip
        }
      }
    }

    // 额外：递归搜索 home 下的常见 AI 工具目录（深度限制）
    const extraDirs = ['.continue', '.aider', '.cline'];
    for (const dir of extraDirs) {
      const p = path.join(home, dir);
      try {
        if (fs.existsSync(p) && !discovered.includes(p)) {
          discovered.push(p);
          console.log(`[TokenLens] 发现额外数据: ${p}`);
        }
      } catch { /* skip */ }
    }

    return discovered;
  }
}
