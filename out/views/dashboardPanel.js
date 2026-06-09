"use strict";
/**
 * 仪表板 Webview Provider —— 侧栏可视化面板。
 * 展示图表、用量历史、余额、缓存命中率等详细信息。
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
exports.DashboardPanel = void 0;
const vscode = __importStar(require("vscode"));
class DashboardPanel {
    constructor(tracker, extensionUri) {
        this.tracker = tracker;
        this._extensionUri = extensionUri;
        // 数据更新时推送到 webview
        this.tracker.onUpdate((stats) => this.postUpdate(stats));
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'node_modules'),
            ],
        };
        webviewView.webview.html = this.getHtml();
        // 接收 webview 消息
        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg.type) {
                case 'ready':
                    // Webview 就绪，发送当前数据
                    this.postUpdate(this.tracker.getStats());
                    break;
                case 'refresh':
                    vscode.commands.executeCommand('deepseekMonitor.refreshBalance');
                    break;
                case 'reset':
                    vscode.commands.executeCommand('deepseekMonitor.resetSession');
                    break;
                case 'export':
                    vscode.commands.executeCommand('deepseekMonitor.exportReport');
                    break;
            }
        });
    }
    /** 推送更新到 webview */
    postUpdate(stats) {
        if (!this._view) {
            return;
        }
        // 序列化 ProviderStats（Map → Object）
        const serializable = {
            totalCost: stats.totalCost,
            totalTokens: stats.totalTokens,
            totalRequests: stats.totalRequests,
            globalCacheHitRate: stats.globalCacheHitRate,
            sessionDuration: stats.sessionDuration,
            lastContextPercent: stats.lastContextPercent || 0,
            lastModel: stats.lastModel || '',
            byProvider: Array.from(stats.byProvider.entries()).map(([name, ps]) => ({
                name,
                totalPromptTokens: ps.totalPromptTokens,
                totalCompletionTokens: ps.totalCompletionTokens,
                totalCost: ps.totalCost,
                totalRequests: ps.totalRequests,
                cacheHitRate: ps.cacheHitRate,
                balance: ps.balance,
                byModel: Array.from(ps.byModel.entries()).map(([model, m]) => ({
                    model,
                    promptTokens: m.promptTokens,
                    completionTokens: m.completionTokens,
                    cost: m.cost,
                    requests: m.requests,
                    cacheHitTokens: m.cacheHitTokens,
                    cacheMissTokens: m.cacheMissTokens,
                })),
            })),
        };
        this._view.webview.postMessage({ type: 'update', data: serializable });
    }
    /** 生成 HTML */
    getHtml() {
        const mediaUri = vscode.Uri.joinPath(this._extensionUri, 'media');
        const dashboardJsUri = this._view.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'dashboard.js'));
        const chartJsUri = this._view.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'chart.min.js'));
        const csp = this._view.webview.cspSource;
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src 'unsafe-inline' ${csp};
                 script-src 'unsafe-inline' ${csp};
                 font-src ${csp};
                 img-src ${csp} data:;">
  <title>DeepSeek Monitor</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e2e);
      --fg: var(--vscode-editor-foreground, #cdd6f4);
      --accent: var(--vscode-activityBar-activeBorder, #89b4fa);
      --card: var(--vscode-editorWidget-background, #313244);
      --border: var(--vscode-panel-border, #45475a);
      --muted: var(--vscode-descriptionForeground, #a6adc8);
      --green: #a6e3a1;
      --yellow: #f9e2af;
      --red: #f38ba8;
      --purple: #cba6f7;
      --blue: #89dceb;
      --radius: 10px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: 13px;
      padding: 12px;
      line-height: 1.5;
    }

    /* ---- 空状态引导页 ---- */
    .onboarding {
      text-align: center;
      padding: 32px 16px;
    }
    .onboarding-icon { font-size: 48px; margin-bottom: 16px; }
    .onboarding h2 { font-size: 18px; margin-bottom: 8px; }
    .onboarding p { color: var(--muted); font-size: 13px; line-height: 1.8; margin-bottom: 20px; }
    .onboarding .steps { text-align: left; display: inline-block; }
    .onboarding .steps li { margin-bottom: 8px; color: var(--muted); }
    .onboarding .steps li span { color: var(--fg); font-weight: 600; }

    /* ---- 操作栏 ---- */
    .actions { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
    .btn {
      background: var(--card); border: 1px solid var(--border); border-radius: 6px;
      color: var(--fg); padding: 6px 14px; font-size: 12px; cursor: pointer;
      display: flex; align-items: center; gap: 5px; transition: all 0.15s;
    }
    .btn:hover { background: var(--border); }
    .btn-primary { background: var(--accent); color: #1e1e2e; border-color: var(--accent); font-weight: 600; }
    .btn-primary:hover { opacity: 0.85; }
    .btn-sm { padding: 4px 10px; font-size: 11px; }

    /* ---- 概览卡片 ---- */
    .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 3px;
    }
    .card.card-cost::before  { background: linear-gradient(90deg, #89b4fa, #cba6f7); }
    .card.card-token::before { background: linear-gradient(90deg, #a6e3a1, #94e2d5); }
    .card.card-cache::before { background: linear-gradient(90deg, #f9e2af, #fab387); }
    .card.card-time::before { background: linear-gradient(90deg, #f38ba8, #cba6f7); }
    .card-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
    .card-value { font-size: 22px; font-weight: 700; }
    .card-sub { font-size: 11px; color: var(--muted); margin-top: 3px; }
    .card-icon { position: absolute; top: 12px; right: 12px; font-size: 20px; opacity: 0.3; }

    /* ---- 图表 ---- */
    .chart-section { margin-bottom: 14px; }
    .chart-container {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
    }
    .chart-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: var(--muted); }
    canvas { width: 100% !important; max-height: 220px; }

    /* ---- 模型明细 ---- */
    .table-section { margin-bottom: 14px; }
    .section-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 7px 8px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .badge {
      display: inline-block; padding: 2px 7px; border-radius: 10px;
      font-size: 10px; font-weight: 600;
    }
    .badge-good  { background: rgba(166,227,161,0.15); color: var(--green); }
    .badge-warn  { background: rgba(249,226,175,0.15); color: var(--yellow); }
    .badge-poor  { background: rgba(243,139,168,0.15); color: var(--red); }

    /* ---- 隐藏状态 ---- */
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <!-- 空状态：引导页 -->
  <div id="onboarding" class="onboarding">
    <div class="onboarding-icon">🛰️</div>
    <h2>DeepSeek Monitor 已就绪</h2>
    <p>正在自动监控所有 VSCode 插件发往 LLM API 的请求。<br>无需额外配置，开始使用 AI 编程工具即可看到数据。</p>
    <ul class="steps">
      <li>✅ <span>自动拦截</span> — 无需 API Key，所有 HTTPS 请求自动捕获</li>
      <li>🔑 <span>可选配置</span> — 设置 API Key 即可查看余额</li>
      <li>📊 <span>实时显示</span> — 状态栏 + 面板同步更新</li>
    </ul>
  </div>

  <!-- 数据面板（有数据时显示） -->
  <div id="data-panel" class="hidden">
    <div class="actions">
      <button class="btn btn-primary" onclick="postMsg('refresh')">🔄 刷新余额</button>
      <button class="btn" onclick="postMsg('reset')">🗑 重置会话</button>
      <button class="btn" onclick="postMsg('export')">📥 导出报告</button>
    </div>
    <div id="cards" class="cards"></div>
    <div id="charts" class="chart-section">
      <div class="chart-container">
        <div class="chart-title">📈 各模型费用分布</div>
        <canvas id="costChart"></canvas>
      </div>
    </div>
    <div id="table-section" class="table-section">
      <div class="section-title">📋 详细记录</div>
      <div id="model-table"></div>
    </div>
  </div>

  <script src="${chartJsUri}"></script>
  <script src="${dashboardJsUri}"></script>
</body>
</html>`;
    }
}
exports.DashboardPanel = DashboardPanel;
//# sourceMappingURL=dashboardPanel.js.map