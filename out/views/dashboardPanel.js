"use strict";
/**
 * 仪表板 Webview Provider —— 侧栏可视化面板。
 * 展示图表、用量历史、余额、缓存命中率等详细信息。
 * 内嵌设置页面，无需打开配置文件即可修改所有选项。
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
const SECTION = 'deepseekMonitor';
class DashboardPanel {
    constructor(tracker, extensionUri) {
        this.tracker = tracker;
        this._extensionUri = extensionUri;
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
        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg.type) {
                case 'ready':
                    this.postUpdate(this.tracker.getStats());
                    // 发送当前设置到 webview
                    this.postSettings();
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
                // ---- 设置相关消息 ----
                case 'saveSetting':
                    this.saveSetting(msg.key, msg.value);
                    break;
                case 'getSettings':
                    this.postSettings();
                    break;
            }
        });
    }
    /** 保存单个设置项 */
    saveSetting(key, value) {
        const config = vscode.workspace.getConfiguration(SECTION);
        config.update(key, value, vscode.ConfigurationTarget.Global).then(() => {
            this._view?.webview.postMessage({ type: 'settingSaved', key, success: true });
            vscode.window.showInformationMessage(`✅ 设置已保存: ${key}`);
        }, (err) => {
            this._view?.webview.postMessage({ type: 'settingSaved', key, success: false, error: String(err) });
            vscode.window.showErrorMessage(`❌ 保存失败: ${err}`);
        });
    }
    /** 推送当前设置到 webview */
    postSettings() {
        if (!this._view) {
            return;
        }
        const config = vscode.workspace.getConfiguration(SECTION);
        const settings = {};
        // 读取所有相关设置
        const keys = [
            'apiKey', 'apiBase', 'balanceCheckInterval', 'interceptEnabled',
            'autoStart', 'showCacheHitRate', 'statusBarDisplay',
            'contextWarnThreshold', 'contextCriticalThreshold',
            'costAlertThreshold', 'showNotificationOnUpdate', 'theme',
        ];
        for (const k of keys) {
            settings[k] = config.get(k);
        }
        // apiKey 脱敏显示
        if (settings.apiKey && typeof settings.apiKey === 'string' && settings.apiKey.length > 8) {
            settings.apiKeyMasked = settings.apiKey.slice(0, 4) + '****' + settings.apiKey.slice(-4);
        }
        else if (settings.apiKey) {
            settings.apiKeyMasked = '****';
        }
        else {
            settings.apiKeyMasked = '';
        }
        this._view.webview.postMessage({ type: 'settings', data: settings });
    }
    /** 推送更新到 webview */
    postUpdate(stats) {
        if (!this._view) {
            return;
        }
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
    .hidden { display: none !important; }

    /* ---- 顶部导航 ---- */
    .nav-bar { display: flex; gap: 8px; margin-bottom: 14px; align-items: center; }
    .nav-tab {
      padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px;
      border: 1px solid var(--border); background: var(--card); color: var(--fg);
      transition: all 0.15s;
    }
    .nav-tab:hover { background: var(--border); }
    .nav-tab.active { background: var(--accent); color: #1e1e2e; border-color: var(--accent); font-weight: 600; }

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
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 14px; position: relative; overflow: hidden;
    }
    .card::before {
      content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 3px;
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
    .chart-container { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
    .chart-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: var(--muted); }
    canvas { width: 100% !important; max-height: 220px; }

    /* ---- 表格 ---- */
    .table-section { margin-bottom: 14px; }
    .section-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 7px 8px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: 600; }
    .badge-good  { background: rgba(166,227,161,0.15); color: var(--green); }
    .badge-warn  { background: rgba(249,226,175,0.15); color: var(--yellow); }
    .badge-poor  { background: rgba(243,139,168,0.15); color: var(--red); }

    /* ---- 空状态 ---- */
    .onboarding { text-align: center; padding: 32px 16px; }
    .onboarding-icon { font-size: 48px; margin-bottom: 16px; }
    .onboarding h2 { font-size: 18px; margin-bottom: 8px; }
    .onboarding p { color: var(--muted); font-size: 13px; line-height: 1.8; margin-bottom: 20px; }
    .onboarding .steps { text-align: left; display: inline-block; }
    .onboarding .steps li { margin-bottom: 8px; color: var(--muted); }
    .onboarding .steps li span { color: var(--fg); font-weight: 600; }

    /* ---- 设置面板 ---- */
    .settings-panel { margin-bottom: 14px; }
    .settings-group {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 14px; margin-bottom: 10px;
    }
    .settings-group h4 {
      font-size: 13px; font-weight: 600; margin-bottom: 10px;
      display: flex; align-items: center; gap: 6px;
    }
    .form-row { margin-bottom: 10px; }
    .form-label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 4px; font-weight: 500; }
    .form-input, .form-select {
      width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg); color: var(--fg); font-size: 12px;
      font-family: var(--vscode-font-family, monospace);
    }
    .form-input:focus, .form-select:focus { border-color: var(--accent); outline: none; }
    .form-input[type="password"] { -webkit-text-security: disc; }
    .form-row-inline { display: flex; gap: 8px; align-items: end; }
    .form-row-inline .form-row { flex: 1; margin-bottom: 0; }
    .form-hint { font-size: 10px; color: var(--muted); margin-top: 3px; }
    .form-toggle {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
    }
    .form-toggle-label { font-size: 12px; }
    .toggle-switch {
      position: relative; width: 36px; height: 20px; cursor: pointer;
    }
    .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .toggle-slider {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: var(--border); border-radius: 20px; transition: 0.2s;
    }
    .toggle-slider::before {
      content: ''; position: absolute; height: 14px; width: 14px;
      left: 3px; bottom: 3px; background: var(--fg);
      border-radius: 50%; transition: 0.2s;
    }
    input:checked + .toggle-slider { background: var(--accent); }
    input:checked + .toggle-slider::before { transform: translateX(16px); }
    .save-indicator { font-size: 11px; color: var(--green); margin-left: 8px; opacity: 0; transition: opacity 0.3s; }
    .save-indicator.show { opacity: 1; }
  </style>
</head>
<body>
  <!-- 顶部标签切换 -->
  <div class="nav-bar">
    <span class="nav-tab active" id="tab-monitor" onclick="switchTab('monitor')">📊 监控</span>
    <span class="nav-tab" id="tab-settings" onclick="switchTab('settings')">⚙️ 设置</span>
  </div>

  <!-- ========== 监控面板 ========== -->
  <div id="panel-monitor">
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
  </div>

  <!-- ========== 设置面板 ========== -->
  <div id="panel-settings" class="hidden settings-panel">
    <!-- API 设置 -->
    <div class="settings-group">
      <h4>🔑 API 配置</h4>
      <div class="form-row">
        <label class="form-label">DeepSeek API Key</label>
        <div class="form-row-inline">
          <div class="form-row" style="flex:1">
            <input class="form-input" type="password" id="setting-apiKey" placeholder="sk-...">
          </div>
          <button class="btn btn-sm" onclick="saveApiKey()">💾 保存</button>
        </div>
        <div class="form-hint" id="api-key-status"></div>
      </div>
      <div class="form-row">
        <label class="form-label">API Base URL</label>
        <input class="form-input" id="setting-apiBase" placeholder="https://api.deepseek.com" onchange="saveSetting('apiBase', this.value)">
      </div>
      <div class="form-row">
        <label class="form-label">余额查询间隔（分钟）</label>
        <input class="form-input" type="number" id="setting-balanceCheckInterval" min="1" max="60" onchange="saveSetting('balanceCheckInterval', parseInt(this.value))">
      </div>
    </div>

    <!-- 监控设置 -->
    <div class="settings-group">
      <h4>📡 监控设置</h4>
      <div class="form-toggle">
        <span class="form-toggle-label">HTTP 请求拦截</span>
        <label class="toggle-switch">
          <input type="checkbox" id="setting-interceptEnabled" onchange="saveSetting('interceptEnabled', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="form-toggle">
        <span class="form-toggle-label">VSCode 启动时自动监控</span>
        <label class="toggle-switch">
          <input type="checkbox" id="setting-autoStart" onchange="saveSetting('autoStart', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="form-toggle">
        <span class="form-toggle-label">显示缓存命中率</span>
        <label class="toggle-switch">
          <input type="checkbox" id="setting-showCacheHitRate" onchange="saveSetting('showCacheHitRate', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="form-toggle">
        <span class="form-toggle-label">用量更新通知</span>
        <label class="toggle-switch">
          <input type="checkbox" id="setting-showNotificationOnUpdate" onchange="saveSetting('showNotificationOnUpdate', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="form-row">
        <label class="form-label">状态栏显示内容</label>
        <select class="form-select" id="setting-statusBarDisplay" onchange="saveSetting('statusBarDisplay', this.value)">
          <option value="cost-only">仅费用</option>
          <option value="cost-tokens">费用 + Token</option>
          <option value="cost-tokens-cache">费用 + Token + 缓存命中</option>
          <option value="cost-tokens-cache-context">全部（含上下文占比）</option>
        </select>
      </div>
    </div>

    <!-- 告警设置 -->
    <div class="settings-group">
      <h4>⚠️ 告警阈值</h4>
      <div class="form-row">
        <label class="form-label">上下文窗口告警阈值（%）</label>
        <input class="form-input" type="number" id="setting-contextWarnThreshold" min="0" max="100" onchange="saveSetting('contextWarnThreshold', parseInt(this.value))">
        <div class="form-hint">超过此值状态栏变黄</div>
      </div>
      <div class="form-row">
        <label class="form-label">上下文窗口严重告警（%）</label>
        <input class="form-input" type="number" id="setting-contextCriticalThreshold" min="0" max="100" onchange="saveSetting('contextCriticalThreshold', parseInt(this.value))">
        <div class="form-hint">超过此值状态栏变红</div>
      </div>
      <div class="form-row">
        <label class="form-label">费用告警阈值（元）</label>
        <input class="form-input" type="number" id="setting-costAlertThreshold" min="0" step="1" onchange="saveSetting('costAlertThreshold', parseFloat(this.value))">
        <div class="form-hint">超过此值弹出通知提醒。0 = 关闭告警</div>
      </div>
    </div>

    <!-- 外观设置 -->
    <div class="settings-group">
      <h4>🎨 外观</h4>
      <div class="form-row">
        <label class="form-label">面板主题</label>
        <select class="form-select" id="setting-theme" onchange="saveSetting('theme', this.value)">
          <option value="auto">跟随 VSCode</option>
          <option value="dark">深色</option>
          <option value="light">浅色</option>
        </select>
      </div>
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