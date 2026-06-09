/**
 * DeepSeek Monitor Dashboard — 侧栏仪表板前端
 * 功能：
 *  - 📊 监控面板: 概览卡片 / 图表 / 详细记录 / 空状态引导
 *  - ⚙️ 设置面板: 直接在面板中修改所有配置，无需打开配置文件
 */

// ---- VSCode Webview API ----
var vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;

function postMsg(type, payload) {
  if (vscode) {
    vscode.postMessage(Object.assign({ type: type }, payload || {}));
  }
}

// ---- 全局状态 ----
var gData = null;
var gChart = null;
var gHasData = false;
var gCurrentTab = 'monitor';

// ---- 监听主进程消息 ----
window.addEventListener('message', function (e) {
  var msg = e.data;
  switch (msg.type) {
    case 'update':
      gData = msg.data;
      var hasData = gData && (gData.totalRequests > 0 || hasBalanceData(gData));
      if (hasData !== gHasData) {
        gHasData = hasData;
        toggleView(hasData);
      }
      if (hasData) { renderAll(gData); }
      break;
    case 'settings':
      applySettings(msg.data);
      break;
    case 'settingSaved':
      showSaveStatus(msg.key, msg.success);
      break;
  }
});

/** 检查是否有余额数据 */
function hasBalanceData(data) {
  if (data && data.byProvider) {
    for (var i = 0; i < data.byProvider.length; i++) {
      var p = data.byProvider[i];
      if (p.balance && p.balance.balance > 0) { return true; }
    }
  }
  return false;
}

// 通知主进程 webview 已就绪
postMsg('ready');

// ============================================================
// 标签切换
// ============================================================
function switchTab(tab) {
  gCurrentTab = tab;
  document.getElementById('tab-monitor').className = tab === 'monitor' ? 'nav-tab active' : 'nav-tab';
  document.getElementById('tab-settings').className = tab === 'settings' ? 'nav-tab active' : 'nav-tab';
  document.getElementById('panel-monitor').className = tab === 'monitor' ? '' : 'hidden';
  document.getElementById('panel-settings').className = tab === 'settings' ? 'settings-panel' : 'hidden';
  if (tab === 'settings') {
    postMsg('getSettings');
  }
}

// ============================================================
// 视图切换
// ============================================================
function toggleView(hasData) {
  var onboarding = document.getElementById('onboarding');
  var panel = document.getElementById('data-panel');
  if (hasData) {
    if (onboarding) onboarding.classList.add('hidden');
    if (panel) panel.classList.remove('hidden');
  } else {
    if (onboarding) onboarding.classList.remove('hidden');
    if (panel) panel.classList.add('hidden');
  }
}

// ============================================================
// 监控面板渲染
// ============================================================
function renderAll(data) {
  renderCards(data);
  renderChart(data);
  renderTable(data);
}

function renderCards(data) {
  var container = document.getElementById('cards');
  if (!container) return;
  var hitRate = data.globalCacheHitRate != null ? data.globalCacheHitRate.toFixed(1) : '0.0';
  var ctxPct = data.lastContextPercent || 0;
  var hasUsage = (data.totalRequests || 0) > 0;

  var cards = [];

  // 如果有余额，优先显示余额卡片
  if (data.byProvider) {
    for (var i = 0; i < data.byProvider.length; i++) {
      var p = data.byProvider[i];
      if (p.balance && p.balance.balance > 0) {
        cards.push({
          cls: 'card-cost', icon: '💳', label: p.name + ' 余额',
          value: fmtCost(p.balance.balance),
          sub: (p.balance.giftBalance ? '含赠送 ' + fmtCost(p.balance.giftBalance) : '') + ' · ' + (p.balance.currency || 'CNY')
        });
      }
    }
  }

  if (hasUsage) {
    cards.push({ cls: 'card-cost',  icon: '💰', label: '会话费用',   value: fmtCost(data.totalCost || 0), sub: '' });
    cards.push({ cls: 'card-token', icon: '📝', label: '总 Tokens',   value: fmtTokens(data.totalTokens || 0), sub: (data.totalRequests || 0) + ' 次请求' });
    cards.push({ cls: 'card-cache', icon: '🎯', label: '缓存命中率',  value: hitRate + '%', sub: getCacheSub(data) });

    if (ctxPct > 0) {
      var ctxColor = ctxPct > 85 ? 'var(--red)' : ctxPct > 70 ? 'var(--yellow)' : 'var(--green)';
      cards.push({
        cls: 'card-time', icon: '📐', label: '上下文窗口 (' + (data.lastModel || '') + ')',
        value: '<span style="color:' + ctxColor + '">' + ctxPct + '%</span>',
        sub: ctxPct > 85 ? '⚠️ 建议开启新会话' : ctxPct > 70 ? '⚡ 考虑压缩对话' : '✅ 窗口健康'
      });
    } else {
      cards.push({
        cls: 'card-time', icon: '⏱', label: '会话时长',
        value: fmtDuration(data.sessionDuration || 0), sub: '自动监控中'
      });
    }
  } else {
    // 无用量数据但有余额时，显示状态卡片
    cards.push({
      cls: 'card-token', icon: '📝', label: '用量状态',
      value: '等待请求',
      sub: '使用 AI 工具后自动出现'
    });
    cards.push({
      cls: 'card-cache', icon: '🔍', label: 'HTTP 拦截',
      value: '运行中',
      sub: '自动捕获 LLM API 调用'
    });
  }

  container.innerHTML = cards.map(function (c) {
    return '<div class="card ' + c.cls + '">'
      + '<div class="card-icon">' + c.icon + '</div>'
      + '<div class="card-label">' + c.label + '</div>'
      + '<div class="card-value">' + c.value + '</div>'
      + (c.sub ? '<div class="card-sub">' + c.sub + '</div>' : '')
      + '</div>';
  }).join('');
}

function getCacheSub(data) {
  var total = 0, hit = 0;
  if (data.byProvider) {
    for (var i = 0; i < data.byProvider.length; i++) {
      var p = data.byProvider[i];
      if (p.byModel) {
        for (var j = 0; j < p.byModel.length; j++) {
          var m = p.byModel[j];
          hit += (m.cacheHitTokens || 0);
          total += (m.cacheHitTokens || 0) + (m.cacheMissTokens || 0);
        }
      }
    }
  }
  return total > 0 ? '命中 ' + fmtTokens(hit) + ' / ' + fmtTokens(total) : '暂无缓存数据';
}

function renderChart(data) {
  var ctx = document.getElementById('costChart');
  if (!ctx) return;
  var labels = [], values = [], colors = [];
  var palette = ['#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7', '#94e2d5', '#fab387', '#89dceb'];
  var idx = 0;
  if (data.byProvider) {
    for (var i = 0; i < data.byProvider.length; i++) {
      var provider = data.byProvider[i];
      if (provider.byModel) {
        for (var j = 0; j < provider.byModel.length; j++) {
          var m = provider.byModel[j];
          labels.push(m.model);
          values.push(m.cost || 0);
          colors.push(palette[idx % palette.length]);
          idx++;
        }
      }
    }
  }
  if (gChart) { gChart.destroy(); gChart = null; }
  if (labels.length === 0) return;

  gChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '费用 (¥)',
        data: values,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e2e', titleColor: '#cdd6f4', bodyColor: '#a6adc8',
          borderColor: '#45475a', borderWidth: 1, cornerRadius: 6,
          callbacks: { label: function (c) { return ' ¥' + c.raw.toFixed(4); } },
        },
      },
      scales: {
        x: { ticks: { color: '#a6adc8', font: { size: 10 } }, grid: { color: 'rgba(69,71,90,0.3)' } },
        y: {
          beginAtZero: true,
          ticks: { color: '#a6adc8', font: { size: 10 }, callback: function (v) { return '¥' + v.toFixed(2); } },
          grid: { color: 'rgba(69,71,90,0.2)' },
        },
      },
    },
  });
}

function renderTable(data) {
  var container = document.getElementById('model-table');
  if (!container) return;
  var rows = '';
  if (data.byProvider) {
    for (var i = 0; i < data.byProvider.length; i++) {
      var provider = data.byProvider[i];
      if (provider.balance && provider.balance.balance > 0) {
        rows += '<tr><td colspan="6" style="background:var(--card); padding:9px 8px; font-weight:600;">'
          + '🔌 ' + escHtml(provider.name)
          + '  <span style="font-weight:400;color:var(--muted);">| 余额: '
          + fmtCost(provider.balance.balance) + ' ' + (provider.balance.currency || '')
          + (provider.balance.giftBalance ? ' (赠送 ' + fmtCost(provider.balance.giftBalance) + ')' : '')
          + '</span></td></tr>';
      }
      if (provider.byModel) {
        for (var j = 0; j < provider.byModel.length; j++) {
          var m = provider.byModel[j];
          var hitRate = '-', badgeCls = '', rate = 0;
          var total = (m.cacheHitTokens || 0) + (m.cacheMissTokens || 0);
          if (total > 0) {
            rate = ((m.cacheHitTokens || 0) / total) * 100;
            hitRate = rate.toFixed(0) + '%';
            badgeCls = rate >= 70 ? 'badge-good' : rate >= 40 ? 'badge-warn' : 'badge-poor';
          }
          rows += '<tr>'
            + '<td>' + escHtml(m.model) + '</td>'
            + '<td>' + (m.requests || 0) + '</td>'
            + '<td>' + fmtTokens(m.promptTokens || 0) + '</td>'
            + '<td>' + fmtTokens(m.completionTokens || 0) + '</td>'
            + '<td style="font-weight:600;">' + fmtCost(m.cost || 0) + '</td>'
            + '<td><span class="badge ' + badgeCls + '">' + hitRate + '</span></td>'
            + '</tr>';
        }
      }
    }
  }
  container.innerHTML = '<table>'
    + '<thead><tr><th>模型</th><th>请求</th><th>输入</th><th>输出</th><th>费用</th><th>缓存命中</th></tr></thead>'
    + '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:16px;">暂无记录</td></tr>') + '</tbody>'
    + '</table>';
}

// ============================================================
// 设置面板
// ============================================================
function applySettings(settings) {
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

  // 显示 API Key 状态
  var statusEl = document.getElementById('api-key-status');
  if (statusEl) {
    statusEl.textContent = settings.apiKeyMasked
      ? '当前: ' + settings.apiKeyMasked
      : '未设置 API Key（仍可追踪用量，但无法查余额）';
  }
}

function setField(id, value) {
  var el = document.getElementById(id);
  if (el && value !== undefined && value !== null) {
    el.value = value;
  }
}

function setCheckbox(id, value) {
  var el = document.getElementById(id);
  if (el) { el.checked = !!value; }
}

/** 保存 API Key（特殊处理，需要隐藏值） */
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

/** 保存单个设置 */
function saveSetting(key, value) {
  postMsg('saveSetting', { key: key, value: value });
}

function showSaveStatus(key, success) {
  var el = document.getElementById('api-key-status');
  if (key === 'apiKey' && el) {
    el.textContent = success ? '✅ 已保存' : '❌ 保存失败';
    if (success) {
      setTimeout(function () { el.textContent = ''; }, 2000);
    }
  }
}

// ============================================================
// 工具函数
// ============================================================
function fmtCost(cost) {
  if (cost == null) return '¥0';
  if (cost < 0.01) return '¥' + cost.toFixed(4);
  if (cost < 1) return '¥' + cost.toFixed(3);
  return '¥' + cost.toFixed(2);
}
function fmtTokens(n) {
  if (n == null) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function fmtDuration(ms) {
  if (!ms) return '0m';
  var mins = Math.floor(ms / 60000);
  var hrs = Math.floor(mins / 60);
  if (hrs > 0) return hrs + 'h ' + (mins % 60) + 'm';
  return mins + 'm';
}
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
