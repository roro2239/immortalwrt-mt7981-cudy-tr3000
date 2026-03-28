/*
模块职责：
这里只负责页面骨架和界面输出，不承载请求、副作用或代理桥接。
业务状态由 state 提供，交互行为由 panels.js 绑定。
*/

function setSummaryItem(id, value) {
	if (els[id])
		els[id].textContent = text(value, '-');
}

function syncExtraSummary() {
	if (els.sumModel2)
		els.sumModel2.textContent = els.sumModel.textContent;
	if (els.sumNetwork2)
		els.sumNetwork2.textContent = els.sumNetwork.textContent;
	if (els.sumProvider2)
		els.sumProvider2.textContent = els.sumProvider.textContent;
	if (els.sumSpeed2)
		els.sumSpeed2.textContent = els.sumSpeed.textContent;
	if (els.sumSignal2)
		els.sumSignal2.textContent = els.sumSignal.textContent;
	if (els.sumSpeed3)
		els.sumSpeed3.textContent = els.sumSpeed.textContent;
}

function renderSummary() {
	var data = state.ufiData || {};
	var signal = data.network_signalbar || data.network_rssi || data.rssi || '-';
	var batteryText = hasText(data.battery_value) ? data.battery_value : (hasText(data.battery_vol_percent) ? data.battery_vol_percent : '');
	var dailyText = hasText(data.daily_data) ? formatBytes(data.daily_data) : '-';
	var monthlyTotal = hasText(data.monthly_data) ? formatBytes(data.monthly_data) : formatBytes((Number(data.monthly_tx_bytes) || 0) + (Number(data.monthly_rx_bytes) || 0));

	setSummaryItem('sumModel', data.MODEL || data.model || data.hardware_version || (state.versionInfo && state.versionInfo.model));
	setSummaryItem('sumNetwork', data.network_type || data.network_information);
	setSummaryItem('sumProvider', data.network_provider);
	setSummaryItem('sumSpeed', formatBytes(data.realtime_rx_thrpt) + '/s ↓  ' + formatBytes(data.realtime_tx_thrpt) + '/s ↑');
	setSummaryItem('sumSignal', signal);
	setSummaryItem('sumTemp', formatTemp(data.cpu_temp));
	setSummaryItem('sumCpu', formatPercent(data.cpu_usage));
	setSummaryItem('sumMem', formatPercent(data.mem_usage));
	setSummaryItem('sumBattery', hasText(batteryText) ? batteryText + '%' : '-');
	setSummaryItem('sumWifi', data.wifi_access_sta_num);
	setSummaryItem('sumDaily', dailyText);
	setSummaryItem('sumMonthly', monthlyTotal);
	setSummaryItem('statusText', state.connected ? '已连接' : '未连接');
	setSummaryItem('statusHint', state.error || '');

	if (els.connectBtn) {
		els.connectBtn.textContent = state.connected ? '断开后台' : (state.connecting ? '连接中...' : '连接后台');
		els.connectBtn.disabled = !!state.connecting;
	}

	if (els.tokenField)
		els.tokenField.style.display = (state.needToken && state.tokenMode !== 'no_token') ? '' : 'none';
	if (els.needTokenTag)
		els.needTokenTag.textContent = state.tokenMode === 'no_token' ? '无口令模式' : (state.needToken ? '需要口令' : '无需口令');

	syncExtraSummary();
}

function renderRealtimeSummary() {
	renderSummary();
}

function renderSms() {
	var list = els.smsThreadList;
	var smsList = state.smsList || [];

	if (!list)
		return;

	list.innerHTML = '';

	if (!smsList.length) {
		list.appendChild(E('div', { 'class': 'ufi-empty' }, '暂无短信'));
		return;
	}

	smsList.slice().sort(function(a, b) {
		return String(b.date || '').localeCompare(String(a.date || ''));
	}).forEach(function(item) {
		var meta = getSmsTagMeta(item.tag);
		var row = E('div', { 'class': 'ufi-sms-item ' + (meta.direction === 'in' ? 'is-in' : 'is-out') }, [
			E('div', { 'class': 'ufi-sms-head' }, [
				E('strong', {}, text(item.number, '-') + (meta.label ? ' · ' + meta.label : '')),
				E('span', {}, parseDateText(item.date))
			]),
			E('div', { 'class': 'ufi-sms-body' }, decodeBase64(item.content || '')),
			E('div', { 'class': 'ufi-sms-actions' }, [
				E('button', {
					'class': 'cbi-button cbi-button-remove',
					'click': function() {
						deleteSms(item.id).then(function(res) {
							if (res && res.result === 'success') {
								showToast('短信已删除', 'success');
								loadSms();
							}
							else {
								showToast('删除短信失败', 'error');
							}
						}).catch(function(err) {
							showToast(text(err.message, '删除短信失败'), 'error');
						});
					}
				}, '删除')
			])
		]);

		list.appendChild(row);
	});
}

function renderCellular() {
	var data = state.ufiData || {};
	var connected = String(data.ppp_status) !== 'ppp_disconnected';
	var signal = data.network_signalbar || data.network_rssi || data.rssi || '-';
	var mode = state.cellularMode || '-';

	setSummaryItem('cellularStatus', connected ? '已连接' : '已断开');
	setSummaryItem('cellularNetwork', data.network_type || data.network_information);
	setSummaryItem('cellularProvider', data.network_provider);
	setSummaryItem('cellularSignal', signal);
	setSummaryItem('cellularMode', mode);

	if (els.cellularModeSelect && state.cellularMode)
		els.cellularModeSelect.value = state.cellularMode;

	if (els.cellularToggleBtn) {
		els.cellularToggleBtn.textContent = connected ? '断开蜂窝' : '连接蜂窝';
		els.cellularToggleBtn.disabled = !state.connected || !!state.cellularBusy;
	}

	if (els.cellularModeApplyBtn)
		els.cellularModeApplyBtn.disabled = !state.connected || !!state.cellularBusy;

	if (els.cellularRefreshBtn)
		els.cellularRefreshBtn.disabled = !state.connected || !!state.cellularBusy;
}

function renderAdvanced() {
	if (els.advancedStatus) {
		if (!state.connected)
			els.advancedStatus.textContent = '请先连接后台';
		else if (state.advancedBusy)
			els.advancedStatus.textContent = '高级功能执行中';
		else
			els.advancedStatus.textContent = '可执行 root shell、禁用更新、小核切换、提取 Boot';
	}

	if (els.AD_RESULT) {
		els.AD_RESULT.classList.toggle('is-error', !!state.advancedError);
		if (!hasText(els.AD_RESULT.textContent))
			els.AD_RESULT.textContent = '等待执行结果';
	}
}

function renderSkeleton() {
	var root = E('div', { 'class': 'ufi-redraw-root' });

	root.innerHTML = ''
		+ '<style>'
		+ '.ufi-redraw-root{--ufi-bg:#f4f7f1;--ufi-panel:#ffffff;--ufi-text:#18212f;--ufi-muted:#617180;--ufi-accent:#0f766e;--ufi-accent-soft:#dff5ef;--ufi-line:#dce4ea;--ufi-danger:#b91c1c;min-height:calc(100vh - 60px);padding:16px 0 28px;background:linear-gradient(180deg,#eef6ec 0%,#f5f7fb 60%,#edf3f8 100%);}'
		+ '.ufi-shell{max-width:1180px;margin:0 auto;padding:0 16px;color:var(--ufi-text);font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}'
		+ '.ufi-hero{display:grid;grid-template-columns:1.2fr .9fr;gap:16px;margin-bottom:16px;}'
		+ '.ufi-card{background:rgba(255,255,255,.92);border:1px solid var(--ufi-line);border-radius:24px;box-shadow:0 18px 50px rgba(23,37,84,.08);padding:18px 20px;backdrop-filter:blur(10px);}'
		+ '.ufi-hero-title{font-size:28px;font-weight:800;letter-spacing:.02em;margin:0 0 8px;}'
		+ '.ufi-badge{display:inline-flex;align-items:center;gap:8px;border-radius:999px;background:var(--ufi-accent-soft);color:var(--ufi-accent);padding:8px 12px;font-size:12px;font-weight:700;}'
		+ '.ufi-login-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}'
		+ '.ufi-field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ufi-muted);}'
		+ '.ufi-field input,.ufi-field select,.ufi-field textarea{width:100%;border:1px solid var(--ufi-line);border-radius:14px;padding:11px 12px;background:#fff;color:var(--ufi-text);font:inherit;box-sizing:border-box;}'
		+ '.ufi-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;}'
		+ '.ufi-toolbar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:16px;}'
		+ '.ufi-stat{min-height:108px;}.ufi-stat-label{font-size:12px;color:var(--ufi-muted);margin-bottom:10px;}.ufi-stat-value{font-size:24px;font-weight:800;line-height:1.2;}'
		+ '.ufi-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;margin-bottom:16px;}.ufi-stack{display:grid;gap:16px;}'
		+ '.ufi-summary-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}'
		+ '.ufi-summary-item{padding:14px;border-radius:18px;background:#f8fbfc;border:1px solid #edf2f5;}'
		+ '.ufi-summary-item strong{display:block;font-size:12px;color:var(--ufi-muted);margin-bottom:8px;}.ufi-summary-item span{font-size:16px;font-weight:700;}'
		+ '.ufi-function-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}'
		+ '.ufi-function-btn{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--ufi-line);background:#fff;padding:14px 16px;border-radius:18px;font-size:14px;font-weight:700;color:var(--ufi-text);cursor:pointer;min-height:56px;text-align:left;}'
		+ '.ufi-function-btn:hover{border-color:#b6d5d1;background:#f7fffd;}'
		+ '.ufi-modal-wrap{position:fixed;inset:0;background:rgba(15,23,42,.35);display:flex;align-items:flex-end;justify-content:center;padding:24px;z-index:2000;}'
		+ '.ufi-modal-wrap[hidden]{display:none !important;pointer-events:none !important;}'
		+ '.ufi-panel{width:min(980px,100%);max-height:90vh;overflow:auto;background:#f8fbfd;border-radius:28px;padding:18px;box-shadow:0 32px 64px rgba(15,23,42,.25);}'
		+ '.ufi-panel[hidden]{display:none !important;}'
		+ '.ufi-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;}.ufi-panel-head h3{margin:0;font-size:22px;}'
		+ '.ufi-sms-list{display:grid;gap:12px;}.ufi-sms-item{padding:14px 16px;border-radius:18px;background:#fff;border:1px solid var(--ufi-line);}.ufi-sms-item.is-in{border-left:5px solid #0f766e;}.ufi-sms-item.is-out{border-left:5px solid #d97706;}.ufi-sms-head,.ufi-sms-actions{display:flex;justify-content:space-between;align-items:center;gap:8px;}.ufi-sms-body{margin:10px 0 12px;line-height:1.7;white-space:pre-wrap;word-break:break-word;}'
		+ '.ufi-empty{padding:32px 12px;text-align:center;color:var(--ufi-muted);}'
		+ '.ufi-toast-wrap{position:fixed;top:82px;right:18px;display:grid;gap:10px;z-index:3000;}'
		+ '.ufi-toast{min-width:220px;max-width:360px;color:#fff;padding:12px 14px;border-radius:14px;box-shadow:0 16px 30px rgba(15,23,42,.18);transition:all .28s ease;}.ufi-toast.is-leaving{opacity:0;transform:translateY(-8px);}'
		+ '.ufi-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}.ufi-kv div{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);}.ufi-kv span{display:block;font-size:12px;color:var(--ufi-muted);margin-bottom:8px;}.ufi-kv strong{font-size:16px;}'
		+ '.ufi-advanced-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}'
		+ '.ufi-result{margin:0;padding:14px 16px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);white-space:pre-wrap;word-break:break-word;min-height:64px;line-height:1.7;}'
		+ '.ufi-result.is-error{border-color:#ef9a9a;background:#fff7f7;color:#b91c1c;}'
		+ '@media (max-width:1080px){.ufi-hero,.ufi-grid{grid-template-columns:1fr;}.ufi-toolbar,.ufi-function-grid,.ufi-summary-list,.ufi-advanced-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}'
		+ '@media (max-width:640px){.ufi-shell{padding:0 10px;}.ufi-toolbar,.ufi-function-grid,.ufi-summary-list,.ufi-kv,.ufi-login-grid,.ufi-advanced-grid{grid-template-columns:1fr;}.ufi-modal-wrap{padding:10px;align-items:flex-end;}.ufi-panel{padding:14px;border-radius:22px;}.ufi-hero-title{font-size:24px;}}'
		+ '</style>'
		+ '<div class="ufi-shell">'
		+ '<section class="ufi-hero">'
		+ '<div class="ufi-card"><h1 class="ufi-hero-title">UFI-TOOLS</h1></div>'
		+ '<div class="ufi-card"><div class="ufi-login-grid"><label class="ufi-field" id="tokenField"><span>UFI-TOOLS 口令</span><input id="token" type="password" autocomplete="current-password" placeholder=""></label><label class="ufi-field"><span>口令模式</span><select id="tokenMode"><option value="auto">自动判断</option><option value="no_token">无 UFI-TOOLS 口令</option></select></label><label class="ufi-field"><span>某兴后台密码</span><input id="password" type="password" autocomplete="current-password" placeholder=""></label><label class="ufi-field"><span>登录方式</span><select id="loginMethod"><option value="0">登录方式 1</option><option value="1">登录方式 2</option></select></label><div class="ufi-field"><span>口令模式</span><div class="ufi-badge" id="needTokenTag">检测中</div></div></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="connectBtn">连接后台</button><button class="cbi-button cbi-button-neutral" id="refreshBtn">刷新数据</button></div></div>'
		+ '</section>'
		+ '<section class="ufi-toolbar">'
		+ '<div class="ufi-card ufi-stat"><div class="ufi-stat-label">设备型号</div><div class="ufi-stat-value" id="sumModel">-</div></div>'
		+ '<div class="ufi-card ufi-stat"><div class="ufi-stat-label">网络类型</div><div class="ufi-stat-value" id="sumNetwork">-</div></div>'
		+ '<div class="ufi-card ufi-stat"><div class="ufi-stat-label">实时速率</div><div class="ufi-stat-value" id="sumSpeed">-</div></div>'
		+ '<div class="ufi-card ufi-stat"><div class="ufi-stat-label">连接状态</div><div class="ufi-stat-value" id="statusText">未连接</div><div class="ufi-note" id="statusHint"></div></div>'
		+ '</section>'
		+ '<section class="ufi-grid">'
		+ '<div class="ufi-stack"><div class="ufi-card"><div class="ufi-panel-head"><h3>核心状态</h3></div><div class="ufi-summary-list"><div class="ufi-summary-item"><strong>运营商</strong><span id="sumProvider">-</span></div><div class="ufi-summary-item"><strong>信号</strong><span id="sumSignal">-</span></div><div class="ufi-summary-item"><strong>CPU 温度</strong><span id="sumTemp">-</span></div><div class="ufi-summary-item"><strong>电量</strong><span id="sumBattery">-</span></div><div class="ufi-summary-item"><strong>CPU 占用</strong><span id="sumCpu">-</span></div><div class="ufi-summary-item"><strong>内存占用</strong><span id="sumMem">-</span></div><div class="ufi-summary-item"><strong>WiFi 终端</strong><span id="sumWifi">-</span></div><div class="ufi-summary-item"><strong>本月流量</strong><span id="sumMonthly">-</span></div></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>流量摘要</h3></div><div class="ufi-kv"><div><span>今日流量</span><strong id="sumDaily">-</strong></div><div><span>设备型号</span><strong id="sumModel2">-</strong></div><div><span>网络类型</span><strong id="sumNetwork2">-</strong></div><div><span>连接速率</span><strong id="sumSpeed2">-</strong></div></div></div></div>'
		+ '<div class="ufi-stack"><div class="ufi-card"><div class="ufi-panel-head"><h3>功能入口</h3></div><div class="ufi-function-grid"><button class="ufi-function-btn" data-open-panel="sms">短信 <span>↗</span></button><button class="ufi-function-btn" data-open-panel="cellular">蜂窝开关 <span>↗</span></button><button class="ufi-function-btn" data-open-panel="advance">高级功能 <span>↗</span></button></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>设备摘要</h3></div><div class="ufi-kv"><div><span>运营商</span><strong id="sumProvider2">-</strong></div><div><span>实时信号</span><strong id="sumSignal2">-</strong></div><div><span>实时速率</span><strong id="sumSpeed3">-</strong></div><div><span>构建版本</span><strong>r78</strong></div></div></div></div>'
		+ '</section>'
		+ '</div>'
		+ '<div class="ufi-modal-wrap" hidden>'
		+ '<section class="ufi-panel" data-panel="sms" hidden><div class="ufi-panel-head"><h3>短信</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-field"><span>收件号码</span><input id="smsPhone" type="text" placeholder="手机号"></div><div class="ufi-field"><span>短信内容</span><textarea id="smsContent" rows="4" placeholder="输入短信内容"></textarea></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="smsSendBtn">发送短信</button></div><div class="ufi-sms-list" id="smsThreadList"></div></section>'
		+ '<section class="ufi-panel" data-panel="cellular" hidden><div class="ufi-panel-head"><h3>蜂窝开关</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-kv"><div><span>连接状态</span><strong id="cellularStatus">-</strong></div><div><span>网络类型</span><strong id="cellularNetwork">-</strong></div><div><span>运营商</span><strong id="cellularProvider">-</strong></div><div><span>信号</span><strong id="cellularSignal">-</strong></div><div><span>当前模式</span><strong id="cellularMode">-</strong></div></div><div class="ufi-login-grid"><label class="ufi-field"><span>网络模式</span><select id="cellularModeSelect"><option value="WL_AND_5G">5G 优先</option><option value="LTE_AND_5G">4G/5G 自动</option><option value="Only_5G">仅 5G</option><option value="WCDMA_AND_LTE">3G/4G 自动</option><option value="Only_LTE">仅 4G</option><option value="Only_WCDMA">仅 3G</option></select></label></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="cellularToggleBtn">切换连接</button><button class="cbi-button cbi-button-neutral" id="cellularModeApplyBtn">应用模式</button><button class="cbi-button cbi-button-neutral" id="cellularRefreshBtn">刷新状态</button></div></section>'
		+ '<section class="ufi-panel" data-panel="advance" hidden><div class="ufi-panel-head"><h3>高级功能</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-note" id="advancedStatus">等待连接后台</div><div class="ufi-advanced-grid"><button class="cbi-button cbi-button-neutral" id="advDisableFotaBtn">禁用更新</button><button class="cbi-button cbi-button-neutral" id="advShellBtn">一键执行 shell</button><button class="cbi-button cbi-button-neutral" id="advDisableLittleCoreBtn">关闭小核</button><button class="cbi-button cbi-button-neutral" id="advEnableLittleCoreBtn">开启小核</button><button class="cbi-button cbi-button-neutral" id="advDumpBootBtn">提取 Boot</button></div><div class="ufi-panel-head" style="margin-top:16px;"><h3 style="font-size:16px;">执行结果</h3></div><p id="AD_RESULT" class="ufi-result">等待执行结果</p></section>'
		+ '</div>'
		+ '<div class="ufi-toast-wrap" id="toast"></div>';

	rootEl = root;
	collectEls();
	bindEvents();
	return root;
}

function renderAll() {
	renderSummary();
	renderSms();
	renderCellular();
	renderAdvanced();
}
