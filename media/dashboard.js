// TokenLens Dashboard

var vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;
var gSnapshot = null;
var gSettings = null;
var gCurrentTab = 'monitor';
var gTrendRange = '24h';
var trendChart = null;
var modelCostChart = null;

function postMsg(type, payload) {
  if (vscode) {
    vscode.postMessage(Object.assign({ type: type }, payload || {}));
  }
}

window.addEventListener('message', function (e) {
  var msg = e.data || {};
  if (msg.type === 'snapshot') {
    gSnapshot = normalizeSnapshot(msg.data);
    renderDashboard();
  } else if (msg.type === 'settings') {
    gSettings = msg.data;
    applySettings(msg.data);
    renderDashboard();
  } else if (msg.type === 'settingSaved') {
    showSaveStatus(msg.key, msg.success);
  }
});

postMsg('ready');

function switchTab(tab) {
  gCurrentTab = tab;
  setClass('tab-monitor', tab === 'monitor' ? 'tab active' : 'tab');
  setClass('tab-settings', tab === 'settings' ? 'tab active' : 'tab');
  setClass('panel-monitor', tab === 'monitor' ? 'shell' : 'hidden');
  setClass('panel-settings', tab === 'settings' ? 'settings-panel' : 'hidden');
  if (tab === 'settings') {
    postMsg('getSettings');
  }
}

function renderDashboard() {
  if (!gSnapshot || gCurrentTab !== 'monitor') return;
  safeRender('header', renderHeader);
  safeRender('kpis', renderKpis);
  safeRender('health', renderHealth);
  safeRender('trend', renderTrend);
  safeRender('heatmap', renderHeatmap);
  safeRender('modelCost', renderModelCost);
  safeRender('providers', renderProviderTable);
  safeRender('models', renderModelTable);
  safeRender('history', renderHistoryTable);
}

function setTrendRange(range) {
  gTrendRange = range || '24h';
  renderTrend(gSnapshot);
}

function renderHeader(snapshot) {
  var status = getOverallStatus(snapshot);
  var pill = document.getElementById('overall-status');
  if (pill) {
    pill.innerHTML = '<span class="dot ' + status.cls + '"></span><span>' + escHtml(status.label) + '</span>';
  }
  setText('last-updated', '最后更新 ' + fmtTime(snapshot.generatedAt));
}

function renderKpis(snapshot) {
  var stats = snapshot.stats || {};
  var balance = snapshot.balanceSummary && snapshot.balanceSummary.primary;
  var cache = snapshot.cacheSummary || {};
  var ctx = stats.lastContextPercent || 0;
  var balanceLines = [];
  if (balance) {
    balanceLines.push(['已用', fmtMoney(balance.totalUsed, balance.currency)]);
    balanceLines.push(['充值', fmtMoney(balance.totalCharged, balance.currency)]);
    if (balance.giftBalance && balance.giftBalance > 0) {
      balanceLines.push(['赠送', fmtMoney(balance.giftBalance, balance.currency)]);
    }
  }

  var kpis = [
    {
      icon: '💳',
      label: '账户余额',
      value: balance ? fmtMoney(balance.balance, balance.currency) : '未查询',
      sub: balance ? '更新时间 ' + fmtTime(balance.fetchedAt) : '配置 API Key 后显示余额',
      lines: balanceLines
    },
    {
      icon: '💰',
      label: '会话费用',
      value: fmtMoney(stats.totalCost || 0),
      sub: '近 24h ' + fmtMoney(snapshot.last24h.cost || 0)
    },
    {
      icon: '🔢',
      label: 'Token 用量',
      value: fmtTokens(stats.totalTokens || 0),
      sub: '近 24h ' + fmtTokens(snapshot.last24h.tokens || 0)
    },
    {
      icon: '📨',
      label: '请求数',
      value: String(stats.totalRequests || 0),
      sub: '近 24h ' + (snapshot.last24h.requests || 0) + ' 次'
    }
  ];

  if (cache.hitRate != null) {
    kpis.push({
      icon: '🎯',
      label: '缓存命中率',
      value: fmtPercent(cache.hitRate),
      sub: cache.totalTokens ? '命中 ' + fmtTokens(cache.hitTokens) + ' / 未命中 ' + fmtTokens(cache.missTokens) : '暂无缓存明细',
      progress: clamp(cache.hitRate, 0, 100),
      tone: cache.hitRate >= 60 ? 'good' : cache.hitRate >= 25 ? 'warn' : 'bad'
    });
  }

  if (cache.estimatedSavings != null && cache.estimatedSavings > 0) {
    kpis.push({
      icon: '💸',
      label: '缓存节省',
      value: fmtMoney(cache.estimatedSavings),
      sub: '按配置定价估算'
    });
  }

  if (ctx > 0) {
    kpis.push({
      icon: '📐',
      label: '上下文占比',
      value: fmtPercent(ctx),
      sub: stats.lastModel ? stats.lastModel : '等待下一次请求',
      progress: clamp(ctx, 0, 100),
      tone: ctx >= 85 ? 'bad' : ctx >= 70 ? 'warn' : 'good'
    });
  }

  var el = document.getElementById('kpi-grid');
  if (!el) return;
  el.innerHTML = kpis.map(function (kpi) {
    return '<article class="card">'
      + '<div class="label"><span class="kpi-icon">' + escHtml(kpi.icon || '') + '</span><span>' + escHtml(kpi.label) + '</span></div>'
      + '<div class="value">' + escHtml(kpi.value) + '</div>'
      + '<div class="sub">' + escHtml(kpi.sub) + '</div>'
      + renderMetricLines(kpi.lines)
      + renderProgress(kpi.progress, kpi.tone)
      + '</article>';
  }).join('');
}

function renderHealth(snapshot) {
  var status = snapshot.monitorStatus || {};
  var http = status.http || {};
  var api = status.api || {};
  var local = status.local || {};
  var rows = [
    {
      name: 'HTTP 请求拦截',
      state: http.running ? '运行中' : '已关闭',
      cls: http.running ? 'good' : 'bad',
      detail: http.seenRequests
        ? '目标请求 ' + http.seenRequests + ' 个，已解析 ' + http.parsedUsages + ' 条'
        : '等待 VS Code 扩展发出 LLM API 请求'
    },
    {
      name: 'API 查询',
      state: api.configured ? (api.lastError ? '异常' : '可用') : '未配置',
      cls: api.configured ? (api.lastError ? 'bad' : 'good') : 'warn',
      detail: api.configured
        ? (formatApiDetail(api) || formatApiOkDetail(api))
        : '配置 API Key 后可查询余额和平台用量'
    }
  ];

  if (local.configured || local.lastError || local.lastEntryCount) {
    rows.push({
      name: '本地扫描',
      state: local.configured ? (local.lastError ? '异常' : '运行中') : '未配置',
      cls: local.configured ? (local.lastError ? 'bad' : 'good') : 'warn',
      detail: local.configured
        ? (local.lastError || ('最近扫描 ' + fmtTime(local.lastScanAt) + '，新增 ' + (local.lastEntryCount || 0) + ' 条'))
        : '可在设置中配置本地日志路径'
    });
  }

  setText('health-meta', (snapshot.recentHistory || []).length ? '最近有请求记录' : '等待请求');
  var el = document.getElementById('health-list');
  if (!el) return;
  el.innerHTML = rows.map(function (row) {
    return '<div class="health-row">'
      + '<span class="dot ' + row.cls + '"></span>'
      + '<div class="health-main">'
      + '<div class="health-name">' + escHtml(row.name) + '</div>'
      + '<div class="health-detail">' + escHtml(row.detail) + '</div>'
      + '</div>'
      + '<div class="health-state">' + escHtml(row.state) + '</div>'
      + '</div>';
  }).join('');
}

function formatApiDetail(api) {
  if (!api || !api.lastError) return '';
  var text = String(api.lastError).replace(/\s+/g, ' ').trim();
  if (text.indexOf('404') >= 0) {
    return '平台用量接口不可用；余额仍可查询，用量依赖请求拦截';
  }
  return text.length > 96 ? text.slice(0, 93) + '...' : text;
}

function formatApiOkDetail(api) {
  if (api.lastEntryCount > 0) {
    return '余额 ' + fmtTime(api.lastBalanceAt) + '，用量新增 ' + api.lastEntryCount + ' 条';
  }
  if (api.lastBalanceAt) {
    return '余额 ' + fmtTime(api.lastBalanceAt) + '，用量等待请求拦截';
  }
  return '等待余额接口返回';
}

function renderTrend(snapshot) {
  var ranges = snapshot.rangeTrends || {};
  var rows = ranges[gTrendRange] || snapshot.trend || [];
  var hasData = rows.some(function (r) { return r.requests > 0 || r.tokens > 0 || r.cost > 0; });
  toggleChart('trend-wrap', 'trend-empty', hasData);
  setClass('range-5h', gTrendRange === '5h' ? 'active' : '');
  setClass('range-24h', gTrendRange === '24h' ? 'active' : '');
  setClass('range-7d', gTrendRange === '7d' ? 'active' : '');
  setText('trend-meta', hasData ? getRangeSummary(rows) : '暂无数据');
  destroyChart('trend');
  if (!hasData || typeof Chart === 'undefined') return;

  var ctx = document.getElementById('trendChart');
  if (!ctx) {
    toggleChart('trend-wrap', 'trend-empty', false);
    return;
  }
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rows.map(function (r) { return gTrendRange === '7d' ? r.label : r.label + ':00'; }),
      datasets: [
        {
          label: '费用',
          data: rows.map(function (r) { return round(r.cost, 6); }),
          borderColor: cssVar('--chart-a'),
          backgroundColor: 'rgba(79, 140, 255, 0.16)',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          yAxisID: 'cost'
        },
        {
          label: 'Tokens',
          data: rows.map(function (r) { return r.tokens; }),
          borderColor: cssVar('--chart-b'),
          backgroundColor: 'rgba(53, 196, 106, 0.12)',
          borderWidth: 2,
          tension: 0.35,
          fill: false,
          yAxisID: 'tokens'
        },
        {
          label: '请求',
          data: rows.map(function (r) { return r.requests; }),
          borderColor: cssVar('--chart-c'),
          backgroundColor: 'rgba(217, 164, 65, 0.12)',
          borderWidth: 2,
          tension: 0.35,
          fill: false,
          yAxisID: 'requests'
        }
      ]
    },
    options: chartOptions({
      cost: { position: 'left', ticks: { callback: function (v) { return fmtMoney(v); } } },
      tokens: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: function (v) { return fmtTokens(v); } } },
      requests: { display: false, beginAtZero: true }
    }, trendTooltipCallbacks(rows))
  });
}

function renderHeatmap(snapshot) {
  var days = snapshot.dailyHeatmap || [];
  var hasData = days.some(function (d) { return d.requests > 0 || d.tokens > 0 || d.cost > 0; });
  setClass('heatmap-section', hasData ? 'panel' : 'hidden');
  setText('heatmap-meta', hasData ? '近 30 天' : '');
  var el = document.getElementById('usage-heatmap');
  if (!el || !hasData) return;
  el.innerHTML = days.map(function (d) {
    var title = d.date + ' · ' + fmtMoney(d.cost) + ' · ' + fmtTokens(d.tokens) + ' tokens · ' + d.requests + ' 次';
    return '<div class="heat-cell l' + clamp(d.level, 0, 4) + '" title="' + escAttr(title) + '" aria-label="' + escAttr(title) + '"></div>';
  }).join('');
}

function renderModelCost(snapshot) {
  var rows = (snapshot.modelRows || []).filter(function (r) { return r.cost > 0 || r.totalTokens > 0; }).slice(0, 8);
  var hasData = rows.length > 0;
  setClass('model-chart-section', hasData ? 'panel' : 'hidden');
  toggleChart('model-chart-wrap', 'model-chart-empty', hasData);
  setText('model-chart-meta', hasData ? rows.length + ' 个模型' : '暂无数据');
  destroyChart('model');
  if (!hasData || typeof Chart === 'undefined') return;

  var ctx = document.getElementById('modelCostChart');
  if (!ctx) {
    toggleChart('model-chart-wrap', 'model-chart-empty', false);
    return;
  }
  modelCostChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map(function (r) { return r.model; }),
      datasets: [
        {
          label: '费用',
          data: rows.map(function (r) { return round(r.cost, 6); }),
          backgroundColor: rows.map(function (_, i) {
            return [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d')][i % 4];
          }),
          borderRadius: 5,
          borderSkipped: false,
          xAxisID: 'cost'
        },
        {
          label: 'Tokens',
          data: rows.map(function (r) { return r.totalTokens || 0; }),
          backgroundColor: 'rgba(53, 196, 106, 0.28)',
          borderRadius: 5,
          borderSkipped: false,
          xAxisID: 'tokens'
        }
      ]
    },
    options: chartOptions({
      cost: { beginAtZero: true, position: 'bottom', ticks: { callback: function (v) { return fmtMoney(v); } } },
      tokens: { beginAtZero: true, position: 'top', grid: { drawOnChartArea: false }, ticks: { callback: function (v) { return fmtTokens(v); } } },
      y: { ticks: { color: cssVar('--muted'), font: { size: 10 } } }
    }, modelTooltipCallbacks(rows), 'y')
  });
}

function renderProviderTable(snapshot) {
  var rows = snapshot.providerRows || [];
  var hasUsage = rows.some(function (r) { return r.requests > 0 || r.totalTokens > 0 || r.cost > 0; });
  setClass('provider-section', rows.length ? 'panel' : 'hidden');
  setText('provider-meta', rows.length ? rows.length + ' 个服务商' : '');
  var el = document.getElementById('provider-table');
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = '';
    return;
  }
  if (rows.length === 1 && !hasUsage) {
    var only = rows[0];
    var onlyBalance = only.balance ? fmtMoney(only.balance.balance, only.balance.currency) : '未查询';
    el.innerHTML = '<div class="compact-row">'
      + '<div class="compact-title">' + escHtml(only.name) + '</div>'
      + '<div class="compact-meta">余额 ' + escHtml(onlyBalance) + '</div>'
      + '<div class="compact-meta">暂无用量</div>'
      + '</div>';
    return;
  }
  el.innerHTML = '<table><thead><tr>'
    + '<th style="width:28%">服务商</th><th>余额</th><th>请求</th><th>Token</th><th>缓存</th>'
    + '</tr></thead><tbody>'
    + rows.map(function (r) {
      var balance = r.balance ? fmtMoney(r.balance.balance, r.balance.currency) : '未查询';
      var cache = (r.cacheHitTokens || r.cacheMissTokens) ? fmtPercent(r.cacheHitRate || 0) : '无明细';
      return '<tr>'
        + '<td title="' + escAttr(r.name) + '">' + escHtml(r.name) + '</td>'
        + '<td>' + escHtml(balance) + '</td>'
        + '<td>' + (r.requests || 0) + '</td>'
        + '<td>' + fmtTokens(r.totalTokens || 0) + '</td>'
        + '<td>' + escHtml(cache) + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

function renderModelTable(snapshot) {
  var rows = snapshot.modelRows || [];
  var hasData = rows.length > 0;
  setClass('model-section', hasData ? 'panel' : 'hidden');
  setText('model-meta', hasData ? rows.length + ' 个模型' : '');
  var el = document.getElementById('model-table');
  if (!el) return;
  if (!hasData) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = '<table><thead><tr>'
    + '<th style="width:30%">模型</th><th>请求</th><th>输入</th><th>输出</th><th>缓存</th><th>费用</th>'
    + '</tr></thead><tbody>'
    + rows.slice(0, 10).map(function (r) {
      var cacheText = (r.cacheHitTokens || r.cacheMissTokens)
        ? fmtTokens(r.cacheHitTokens || 0) + ' / ' + fmtTokens(r.cacheMissTokens || 0)
        : '无明细';
      return '<tr>'
        + '<td title="' + escAttr(r.provider + ' / ' + r.model) + '">' + escHtml(r.model) + '</td>'
        + '<td>' + r.requests + '</td>'
        + '<td>' + fmtTokens(r.promptTokens) + '</td>'
        + '<td>' + fmtTokens(r.completionTokens) + '</td>'
        + '<td title="命中 / 未命中">' + escHtml(cacheText) + '</td>'
        + '<td>' + fmtMoney(r.cost) + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

function renderHistoryTable(snapshot) {
  var rows = snapshot.recentHistory || [];
  var hasData = rows.length > 0;
  setClass('history-section', hasData ? 'panel' : 'hidden');
  setText('history-meta', hasData ? '最近 ' + rows.length + ' 条' : '');
  var el = document.getElementById('history-table');
  if (!el) return;
  if (!hasData) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = '<table><thead><tr>'
    + '<th style="width:22%">时间</th><th style="width:24%">模型</th><th>输入</th><th>输出</th><th>缓存</th><th>费用</th>'
    + '</tr></thead><tbody>'
    + rows.slice(0, 30).map(function (r) {
      var cacheText = ((r.cacheHitTokens || 0) + (r.cacheMissTokens || 0)) > 0
        ? fmtTokens(r.cacheHitTokens || 0) + ' / ' + fmtTokens(r.cacheMissTokens || 0)
        : '无明细';
      return '<tr>'
        + '<td title="' + escAttr(fmtDateTime(r.timestamp)) + '">' + escHtml(fmtShortTime(r.timestamp)) + '</td>'
        + '<td title="' + escAttr(r.provider + ' / ' + r.model + ' / ' + r.source) + '">' + escHtml(r.model || 'unknown') + '</td>'
        + '<td>' + fmtTokens(r.promptTokens || 0) + '</td>'
        + '<td>' + fmtTokens(r.completionTokens || 0) + '</td>'
        + '<td title="命中 / 未命中">' + escHtml(cacheText) + '</td>'
        + '<td>' + fmtMoney(r.cost || 0) + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

function applySettings(settings) {
  if (!settings) return;
  setField('setting-apiKey', settings.apiKey || '');
  setField('setting-apiBase', settings.apiBase || '');
  setField('setting-balanceCheckInterval', settings.balanceCheckInterval);
  setCheckbox('setting-interceptEnabled', settings.interceptEnabled);
  setCheckbox('setting-autoStart', settings.autoStart);
  setCheckbox('setting-showCacheHitRate', settings.showCacheHitRate);
  setCheckbox('setting-showNotificationOnUpdate', settings.showNotificationOnUpdate);
  setField('setting-statusBarDisplay', settings.statusBarDisplay);
  setField('setting-contextWarnThreshold', settings.contextWarnThreshold);
  setField('setting-contextCriticalThreshold', settings.contextCriticalThreshold);
  setField('setting-costAlertThreshold', settings.costAlertThreshold);
  setField('setting-theme', settings.theme);
  setText('api-key-status', settings.apiKeyMasked ? '当前已配置：' + settings.apiKeyMasked : '未配置 API Key');
}

function saveApiKey() {
  var input = document.getElementById('setting-apiKey');
  if (!input) return;
  var val = input.value.trim();
  if (!val) {
    showSaveStatus('apiKey', false);
    return;
  }
  postMsg('saveSetting', { key: 'apiKey', value: val });
}

function saveSetting(key, value) {
  postMsg('saveSetting', { key: key, value: value });
}

function showSaveStatus(key, success) {
  if (key === 'apiKey') {
    setText('api-key-status', success ? '已保存' : '保存失败');
  }
}

function normalizeSnapshot(raw) {
  var snapshot = raw || {};
  snapshot.stats = Object.assign({
    totalCost: 0,
    totalTokens: 0,
    totalRequests: 0,
    globalCacheHitRate: 0,
    sessionDuration: 0,
    lastContextPercent: 0,
    lastModel: ''
  }, snapshot.stats || {});
  snapshot.last24h = Object.assign({
    requests: 0,
    tokens: 0,
    cost: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0
  }, snapshot.last24h || {});
  snapshot.balanceSummary = Object.assign({
    primary: null,
    providers: []
  }, snapshot.balanceSummary || {});
  snapshot.cacheSummary = Object.assign({
    hitTokens: 0,
    missTokens: 0,
    totalTokens: 0,
    hitRate: null,
    estimatedSavings: null
  }, snapshot.cacheSummary || {});
  snapshot.monitorStatus = Object.assign({
    http: {},
    api: {},
    local: {}
  }, snapshot.monitorStatus || {});
  snapshot.monitorStatus.http = Object.assign({
    running: false,
    lastRequestAt: 0,
    lastUsageAt: 0,
    seenRequests: 0,
    parsedUsages: 0,
    missingUsageResponses: 0
  }, snapshot.monitorStatus.http || {});
  snapshot.monitorStatus.api = Object.assign({
    running: false,
    configured: false,
    lastBalanceAt: 0,
    lastUsageAt: 0,
    lastError: '',
    lastEntryCount: 0
  }, snapshot.monitorStatus.api || {});
  snapshot.monitorStatus.local = Object.assign({
    running: false,
    configured: false,
    lastScanAt: 0,
    lastError: '',
    lastEntryCount: 0
  }, snapshot.monitorStatus.local || {});
  snapshot.providerRows = Array.isArray(snapshot.providerRows) ? snapshot.providerRows : [];
  snapshot.modelRows = Array.isArray(snapshot.modelRows) ? snapshot.modelRows : [];
  snapshot.recentHistory = Array.isArray(snapshot.recentHistory) ? snapshot.recentHistory : [];
  snapshot.trend = Array.isArray(snapshot.trend) ? snapshot.trend : [];
  snapshot.rangeTrends = Object.assign({
    '5h': [],
    '24h': snapshot.trend,
    '7d': []
  }, snapshot.rangeTrends || {});
  snapshot.dailyHeatmap = Array.isArray(snapshot.dailyHeatmap) ? snapshot.dailyHeatmap : [];
  snapshot.generatedAt = snapshot.generatedAt || Date.now();
  return snapshot;
}

function safeRender(name, fn) {
  try {
    fn(gSnapshot);
  } catch (err) {
    console.error('[TokenLens] render failed:', name, err);
    renderFallback(name);
  }
}

function renderFallback(name) {
  var map = {
    kpis: 'kpi-grid',
    health: 'health-list',
    providers: 'provider-table',
    models: 'model-table',
    history: 'history-table',
    heatmap: 'usage-heatmap'
  };
  var id = map[name];
  if (!id) return;
  var el = document.getElementById(id);
  if (el) {
    el.innerHTML = '<div class="empty">该模块暂时无法渲染，其他监控数据仍可继续查看。</div>';
  }
}

function renderMetricLines(lines) {
  if (!lines || !lines.length) return '';
  return lines.map(function (line) {
    return '<div class="metric-line"><span>' + escHtml(line[0]) + '</span><span>' + escHtml(line[1]) + '</span></div>';
  }).join('');
}

function renderProgress(value, tone) {
  if (value == null || isNaN(value)) return '';
  var pct = clamp(value, 0, 100);
  return '<div class="meter" aria-hidden="true"><div class="meter-fill ' + escHtml(tone || '') + '" style="width:' + pct.toFixed(1) + '%"></div></div>';
}

function getOverallStatus(snapshot) {
  var http = snapshot.monitorStatus && snapshot.monitorStatus.http;
  var hasUsage = snapshot.stats && snapshot.stats.totalRequests > 0;
  if (hasUsage) return { cls: 'good', label: '已捕获数据' };
  if (http && http.running && http.seenRequests > 0) return { cls: 'warn', label: '请求无用量' };
  if (http && http.running) return { cls: 'good', label: '监听中' };
  return { cls: 'bad', label: '拦截关闭' };
}

function getRangeSummary(rows) {
  var sum = rows.reduce(function (acc, r) {
    acc.cost += r.cost || 0;
    acc.tokens += r.tokens || 0;
    acc.requests += r.requests || 0;
    return acc;
  }, { cost: 0, tokens: 0, requests: 0 });
  return fmtMoney(sum.cost) + ' · ' + fmtTokens(sum.tokens) + ' · ' + sum.requests + ' 次';
}

function trendTooltipCallbacks(rows) {
  return {
    callbacks: {
      afterBody: function (items) {
        var i = items && items.length ? items[0].dataIndex : -1;
        var row = rows[i] || {};
        return [
          '费用 ' + fmtMoney(row.cost || 0),
          'Token ' + fmtTokens(row.tokens || 0),
          '请求 ' + (row.requests || 0) + ' 次'
        ];
      }
    }
  };
}

function modelTooltipCallbacks(rows) {
  return {
    callbacks: {
      afterBody: function (items) {
        var i = items && items.length ? items[0].dataIndex : -1;
        var row = rows[i] || {};
        return [
          '费用 ' + fmtMoney(row.cost || 0),
          'Token ' + fmtTokens(row.totalTokens || 0),
          '请求 ' + (row.requests || 0) + ' 次'
        ];
      }
    }
  };
}

function chartOptions(scales, tooltipOptions, indexAxis) {
  return {
    indexAxis: indexAxis || 'x',
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    plugins: {
      legend: { labels: { color: cssVar('--muted'), boxWidth: 10, font: { size: 10 } } },
      tooltip: Object.assign({
        backgroundColor: cssVar('--panel'),
        titleColor: cssVar('--fg'),
        bodyColor: cssVar('--muted'),
        borderColor: cssVar('--border'),
        borderWidth: 1
      }, tooltipOptions || {})
    },
    scales: Object.assign({
      x: {
        ticks: { color: cssVar('--muted'), font: { size: 10 }, maxRotation: 0, autoSkip: true },
        grid: { color: 'rgba(130, 140, 160, 0.12)' }
      }
    }, scales || {})
  };
}

function destroyChart(name) {
  if (name === 'trend' && trendChart) {
    trendChart.destroy();
    trendChart = null;
  }
  if (name === 'model' && modelCostChart) {
    modelCostChart.destroy();
    modelCostChart = null;
  }
}

function toggleChart(chartId, emptyId, hasData) {
  var chart = document.getElementById(chartId);
  var empty = document.getElementById(emptyId);
  if (chart) chart.classList.toggle('hidden', !hasData);
  if (empty) empty.classList.toggle('hidden', hasData);
}

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setClass(id, cls) {
  var el = document.getElementById(id);
  if (el) el.className = cls;
}

function setField(id, value) {
  var el = document.getElementById(id);
  if (el && value !== undefined && value !== null) {
    el.value = value;
  }
}

function setCheckbox(id, value) {
  var el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function fmtMoney(value, currency) {
  var n = Number(value || 0);
  var symbol = currency === 'USD' ? '$' : '¥';
  if (n === 0) return symbol + '0';
  if (Math.abs(n) < 0.01) return symbol + n.toFixed(4);
  if (Math.abs(n) < 1) return symbol + n.toFixed(3);
  return symbol + n.toFixed(2);
}

function fmtTokens(value) {
  var n = Number(value || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function fmtPercent(value) {
  var n = Number(value || 0);
  return n.toFixed(n >= 10 ? 0 : 1) + '%';
}

function fmtTime(ts) {
  if (!ts) return '从未';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function fmtShortTime(ts) {
  if (!ts) return '-';
  var d = new Date(ts);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN');
}

function round(value, digits) {
  var p = Math.pow(10, digits || 2);
  return Math.round(Number(value || 0) * p) / p;
}

function clamp(value, min, max) {
  var n = Number(value || 0);
  return Math.max(min, Math.min(max, n));
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str).replace(/'/g, '&#39;');
}
