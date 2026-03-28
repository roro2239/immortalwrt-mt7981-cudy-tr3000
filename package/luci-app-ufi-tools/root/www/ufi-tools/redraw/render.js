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

function getCpuFrequencyEntries(data) {
	var info = data && data.cpuFreqInfo;
	var keys;

	if (!info || typeof info !== 'object')
		return [];

	keys = Object.keys(info).filter(function(key) {
		return /^cpu\d+$/.test(key);
	}).sort(function(a, b) {
		return Number(a.slice(3)) - Number(b.slice(3));
	});

	return keys.map(function(key) {
		var item = info[key] || {};

		return {
			name: key.toUpperCase(),
			cur: Number(item.cur) || 0,
			max: Number(item.max) || 0
		};
	});
}

function getPrimaryCpuFrequency(data) {
	var entries = getCpuFrequencyEntries(data);
	var current = 0;

	entries.forEach(function(item) {
		if (item.cur > current)
			current = item.cur;
	});

	return current ? formatFrequencyMHz(current) : '-';
}

function renderCpuFrequencyList(data) {
	var list = els.cpuFreqList;
	var entries = getCpuFrequencyEntries(data);

	if (!list)
		return;

	list.innerHTML = '';

	if (!entries.length) {
		list.appendChild(E('div', { 'class': 'ufi-empty' }, '暂无 CPU 频率数据'));
		return;
	}

	entries.forEach(function(item) {
		list.appendChild(E('div', { 'class': 'ufi-mini-item' }, [
			E('strong', {}, item.name),
			E('span', {}, formatFrequencyMHz(item.cur) + (item.max ? ' / ' + formatFrequencyMHz(item.max) : ''))
		]));
	});
}

function formatStorageUsage(used, total) {
	var usedText = hasText(used) ? formatBytes(used) : '-';
	var totalText = hasText(total) ? formatBytes(total) : '-';

	if (usedText === '-' && totalText === '-')
		return '-';

	return usedText + ' / ' + totalText;
}

function formatSignalMetric(raw, unit) {
	if (!hasText(raw))
		return '-';

	return String(raw) + (unit ? ' ' + unit : '');
}

function formatBand(raw, prefix) {
	if (!hasText(raw))
		return '-';

	return prefix + String(raw);
}

function formatSimSlot(slot) {
	var value = text(slot, '').trim();

	if (value === '0')
		return 'SIM 1';
	if (value === '1')
		return 'SIM 2';
	if (value === '2')
		return 'SIM 3';
	if (value === '11')
		return '外置 SIM';
	if (value === '12')
		return 'SIM 1';
	if (!value)
		return '-';

	return value;
}

function getSimSlotLabel(simInfo, slot) {
	var options = simInfo && Array.isArray(simInfo.options) ? simInfo.options : [];
	var value = text(slot, '').trim();
	var match = options.find(function(option) {
		return text(option && option.value, '').trim() === value;
	});

	if (match && hasText(match.label))
		return match.label;

	return formatSimSlot(value);
}

function getEffectiveSimSlot() {
	var pending = text(state.pendingSimSlot, '').trim();
	var draft = text(state.simSlotDraft, '').trim();
	var current = text(state.simInfo && state.simInfo.slot, '').trim();

	if (pending)
		return pending;
	if (draft)
		return draft;

	return current;
}

function renderSimOptions(simInfo) {
	var select = els.cellularSimSelect;
	var options = simInfo && Array.isArray(simInfo.options) ? simInfo.options : [];
	var selectedValue = text(simInfo && simInfo.slot, '').trim();

	if (!select)
		return;

	select.innerHTML = '';

	if (!options.length)
		options = [{ value: '0', label: 'SIM 1' }, { value: '1', label: 'SIM 2' }];

	options.forEach(function(option) {
		select.appendChild(E('option', {
			value: text(option && option.value, '').trim()
		}, text(option && option.label, text(option && option.value, '-'))));
	});

	if (selectedValue) {
		Array.prototype.some.call(select.options, function(option) {
			if (option.value === selectedValue) {
				select.value = selectedValue;
				return true;
			}
			return false;
		});
	}
}

function getSignalDetails(data) {
	return {
		power: hasText(data.Z5g_rsrp) ? formatSignalMetric(data.Z5g_rsrp, 'dBm') : formatSignalMetric(data.lte_rsrp, 'dBm'),
		sinr: hasText(data.Nr_snr) ? formatSignalMetric(data.Nr_snr, 'dB') : formatSignalMetric(data.Lte_snr, 'dB'),
		rsrq: hasText(data.nr_rsrq) ? formatSignalMetric(data.nr_rsrq, 'dB') : formatSignalMetric(data.lte_rsrq, 'dB'),
		band: hasText(data.Nr_bands) ? formatBand(data.Nr_bands, 'N') : formatBand(data.Lte_bands, 'B'),
		frequency: hasText(data.Nr_fcn) ? text(data.Nr_fcn, '-') : text(data.Lte_fcn, '-'),
		pci: hasText(data.Nr_pci) ? text(data.Nr_pci, '-') : text(data.Lte_pci, '-')
	};
}

function getBandCatalog() {
	return {
		lte: [
			{ band: '1', label: 'B1', operator: '联通/电信' },
			{ band: '3', label: 'B3', operator: '三大运营商' },
			{ band: '5', label: 'B5', operator: '电信' },
			{ band: '8', label: 'B8', operator: '移动' },
			{ band: '34', label: 'B34', operator: '移动' },
			{ band: '38', label: 'B38', operator: '移动' },
			{ band: '39', label: 'B39', operator: '移动' },
			{ band: '40', label: 'B40', operator: '移动' },
			{ band: '41', label: 'B41', operator: '移动' }
		],
		nr: [
			{ band: '1', label: 'N1', operator: '联通/电信' },
			{ band: '5', label: 'N5', operator: '电信' },
			{ band: '8', label: 'N8', operator: '移动' },
			{ band: '28', label: 'N28', operator: '广电/移动' },
			{ band: '41', label: 'N41', operator: '移动' },
			{ band: '78', label: 'N78', operator: '联通/电信' }
		]
	};
}

function getBandDraft() {
	var draft = state.bandLockDraft || {};
	var info = state.bandLockInfo || {};

	return {
		lteBands: Array.isArray(draft.lteBands) ? draft.lteBands.slice() : (Array.isArray(info.lteBands) ? info.lteBands.slice() : []),
		nrBands: Array.isArray(draft.nrBands) ? draft.nrBands.slice() : (Array.isArray(info.nrBands) ? info.nrBands.slice() : [])
	};
}

function getCellSelectionKey(item) {
	return [
		text(item && item.pci, '').trim(),
		text(item && item.earfcn, '').trim(),
		text(item && item.rat, '').trim()
	].join('|');
}

function renderBandLockForm() {
	var form = els.bandLockForm;
	var info = getBandDraft();
	var catalog = getBandCatalog();

	if (!form)
		return;

	form.innerHTML = '';

	['lte', 'nr'].forEach(function(type) {
		catalog[type].forEach(function(item) {
			var checked = (type === 'lte' ? info.lteBands : info.nrBands).indexOf(item.band) >= 0;
			form.appendChild(E('label', { 'class': 'ufi-mini-item' }, [
				E('strong', {}, item.label + ' · ' + (type === 'lte' ? '4G' : '5G')),
				E('span', {}, item.operator),
				E('input', {
					type: 'checkbox',
					checked: checked,
					'data-band-type': type,
					'data-band-value': item.band
				})
			]));
		});
	});
}

function renderCellLockTables() {
	var info = state.cellLockInfo || {};
	var lockedList = els.cellularLockedCells;
	var neighborList = els.cellularNeighborCells;
	var lockedCells = Array.isArray(info.lockedCells) ? info.lockedCells : [];
	var neighborCells = Array.isArray(info.neighborCells) ? info.neighborCells : [];
	var selectedKey = getCellSelectionKey(state.selectedCell);
	var selectedExists = false;

	if (lockedList) {
		lockedList.innerHTML = '';

		if (!lockedCells.length) {
			lockedList.appendChild(E('div', { 'class': 'ufi-empty' }, '暂无已锁基站'));
		}
		else {
			lockedCells.forEach(function(item) {
				lockedList.appendChild(E('div', { 'class': 'ufi-mini-item' }, [
					E('strong', {}, text(item.rat, '') === '12' ? '4G' : '5G'),
					E('span', {}, 'PCI ' + text(item.pci, '-') + ' / 频率 ' + text(item.earfcn, '-'))
				]));
			});
		}
	}

	if (neighborList) {
		neighborList.innerHTML = '';

		if (!neighborCells.length) {
			neighborList.appendChild(E('div', { 'class': 'ufi-empty' }, '暂无可选基站'));
		}
		else {
			neighborCells.forEach(function(item) {
				var isSelected = selectedKey && getCellSelectionKey(item) === selectedKey;

				if (isSelected)
					selectedExists = true;

				neighborList.appendChild(E('button', {
					type: 'button',
					'class': 'ufi-function-btn' + (isSelected ? ' is-selected' : ''),
					click: function() {
						state.selectedCell = {
							pci: text(item.pci, '').trim(),
							earfcn: text(item.earfcn, '').trim(),
							rat: text(item.rat, '').trim()
						};
						renderCellLockTables();
					}
				}, [
					E('span', {}, text(item.band, '-') + ' / PCI ' + text(item.pci, '-') + ' / 频率 ' + text(item.earfcn, '-')),
					E('span', {}, 'RSRP ' + text(item.rsrp, '-') + ' / SINR ' + text(item.sinr, '-'))
				]));
			});
		}
	}

	if (selectedKey && !selectedExists)
		state.selectedCell = null;
}

function formatSwitchText(enabled) {
	return enabled ? '已开启' : '已关闭';
}

function renderSettings() {
	var settings = state.deviceSettings || {};
	var wifi = settings.wifi || {};
	var wifiActive = wifi.active || {};
	var wifiMode = text(wifi.band, text(wifi.moduleSwitch, '0'));
	var isOpen = text(wifiActive.AuthMode, 'OPEN') === 'OPEN';
	var wifiEditable = wifiMode !== '0' && !!wifi.active;

	setSummaryItem('settingsPerformance', formatSwitchText(!!settings.performanceMode));
	setSummaryItem('settingsRoaming', formatSwitchText(!!settings.roamingEnabled));
	setSummaryItem('settingsIndicator', formatSwitchText(!!settings.indicatorLightEnabled));
	setSummaryItem('settingsSchedule', settings.scheduleRebootEnabled ? ('每日 ' + text(settings.scheduleRebootTime, '00:00')) : '已关闭');
	setSummaryItem('settingsWifiBand', wifiMode === 'chip1' ? '2.4G' : (wifiMode === 'chip2' ? '5G' : '已关闭'));

	if (els.settingsWifiBandSelect)
		els.settingsWifiBandSelect.value = wifiMode;

	if (els.settingsWifiSSID)
		els.settingsWifiSSID.value = text(wifiActive.SSID, '');
	if (els.settingsWifiAuthMode)
		els.settingsWifiAuthMode.value = text(wifiActive.AuthMode, 'OPEN');
	if (els.settingsWifiPassword)
		els.settingsWifiPassword.value = text(wifiActive.Password, '');
	if (els.settingsWifiBroadcast)
		els.settingsWifiBroadcast.checked = !!wifiActive.ApBroadcastDisabled;
	if (els.settingsWifiMaxClients)
		els.settingsWifiMaxClients.value = text(wifiActive.ApMaxStationNumber, '8');
	if (els.settingsWifiAccessPointIndex)
		els.settingsWifiAccessPointIndex.value = text(wifiActive.AccessPointIndex, '0');
	if (els.settingsWifiChipIndex)
		els.settingsWifiChipIndex.value = text(wifiActive.ChipIndex, wifiMode === 'chip2' ? '1' : '0');
	if (els.settingsScheduleEnabled)
		els.settingsScheduleEnabled.checked = !!settings.scheduleRebootEnabled;
	if (els.settingsScheduleTime)
		els.settingsScheduleTime.value = text(settings.scheduleRebootTime, '00:00');

	if (els.settingsWifiPasswordField)
		els.settingsWifiPasswordField.style.display = isOpen ? 'none' : '';

	if (els.settingsHint) {
		if (!state.connected)
			els.settingsHint.textContent = '请先连接后台';
		else if (state.settingsBusy)
			els.settingsHint.textContent = '设备设置执行中';
		else
			els.settingsHint.textContent = '已接入 WiFi、性能模式、网络漫游、指示灯、定时重启和设备重启';
	}

	[
		'settingsRefreshBtn', 'settingsPerformanceBtn', 'settingsRoamingBtn', 'settingsIndicatorBtn',
		'settingsWifiBandApplyBtn', 'settingsWifiSaveBtn', 'settingsScheduleApplyBtn', 'settingsRebootBtn'
	].forEach(function(id) {
		if (els[id])
			els[id].disabled = !state.connected || !!state.settingsBusy;
	});

	if (els.settingsWifiBandSelect)
		els.settingsWifiBandSelect.disabled = !state.connected || !!state.settingsBusy;
	if (els.settingsWifiSSID)
		els.settingsWifiSSID.disabled = !state.connected || !!state.settingsBusy || !wifiEditable;
	if (els.settingsWifiAuthMode)
		els.settingsWifiAuthMode.disabled = !state.connected || !!state.settingsBusy || !wifiEditable;
	if (els.settingsWifiPassword)
		els.settingsWifiPassword.disabled = !state.connected || !!state.settingsBusy || !wifiEditable || isOpen;
	if (els.settingsWifiBroadcast)
		els.settingsWifiBroadcast.disabled = !state.connected || !!state.settingsBusy || !wifiEditable;
	if (els.settingsWifiMaxClients)
		els.settingsWifiMaxClients.disabled = !state.connected || !!state.settingsBusy || !wifiEditable;
	if (els.settingsWifiSaveBtn)
		els.settingsWifiSaveBtn.disabled = !state.connected || !!state.settingsBusy || !wifiEditable;
	if (els.settingsScheduleEnabled)
		els.settingsScheduleEnabled.disabled = !state.connected || !!state.settingsBusy;
	if (els.settingsScheduleTime)
		els.settingsScheduleTime.disabled = !state.connected || !!state.settingsBusy;
}

function renderSummary() {
	var data = state.ufiData || {};
	var signal = data.network_signalbar || data.network_rssi || data.rssi || '-';
	var usedFlow = formatBytes((Number(data.monthly_tx_bytes) || 0) + (Number(data.monthly_rx_bytes) || 0));
	var dailyText = hasText(data.daily_data) ? formatBytes(data.daily_data) : '-';
	var monthlyTotal = hasText(data.monthly_data) ? formatBytes(data.monthly_data) : usedFlow;
	var storageText = formatStorageUsage(data.internal_used_storage, data.internal_total_storage);
	var currentFreq = getPrimaryCpuFrequency(data);

	setSummaryItem('sumModel', data.MODEL || data.model || data.hardware_version || (state.versionInfo && state.versionInfo.model));
	setSummaryItem('sumNetwork', data.network_type || data.network_information);
	setSummaryItem('sumProvider', data.network_provider);
	setSummaryItem('sumSpeed', formatBytes(data.realtime_rx_thrpt) + '/s ↓  ' + formatBytes(data.realtime_tx_thrpt) + '/s ↑');
	setSummaryItem('sumSignal', signal);
	setSummaryItem('sumTemp', formatTemp(data.cpu_temp));
	setSummaryItem('sumCpu', formatPercent(data.cpu_usage));
	setSummaryItem('sumMem', formatPercent(data.mem_usage));
	setSummaryItem('sumWifi', data.wifi_access_sta_num);
	setSummaryItem('sumMonthly', monthlyTotal);
	setSummaryItem('sumUsedFlow', usedFlow);
	setSummaryItem('sumDaily', dailyText);
	setSummaryItem('sumMonthlyUsed', monthlyTotal);
	setSummaryItem('sumRealtimeTime', formatDuration(data.realtime_time));
	setSummaryItem('sumTotalTime', formatDuration(data.monthly_time));
	setSummaryItem('sumStorage', storageText);
	setSummaryItem('cpuFreqSummary', currentFreq);
	setSummaryItem('statusText', state.connected ? '已连接' : '未连接');
	setSummaryItem('statusHint', state.error || '');

	renderCpuFrequencyList(data);

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
	var simInfo = state.simInfo || {};
	var signalDetails = getSignalDetails(data);
	var effectiveSlot = getEffectiveSimSlot();
	var simHint = Array.isArray(simInfo.options) && simInfo.options.length ? ('可切换：' + simInfo.options.map(function(item) {
		return text(item && item.label, '');
	}).filter(Boolean).join(' / ')) : '未读取到卡槽信息';

	setSummaryItem('cellularStatus', connected ? '已连接' : '已断开');
	setSummaryItem('cellularNetwork', data.network_type || data.network_information);
	setSummaryItem('cellularProvider', data.network_provider);
	setSummaryItem('cellularSignal', signal);
	setSummaryItem('cellularMode', mode);
	setSummaryItem('cellularSimCurrent', hasText(effectiveSlot) ? getSimSlotLabel(simInfo, effectiveSlot) : '-');
	setSummaryItem('cellularQci', state.qciInfo && state.qciInfo.text ? state.qciInfo.text : '-');
	setSummaryItem('cellularPower', signalDetails.power);
	setSummaryItem('cellularSinr', signalDetails.sinr);
	setSummaryItem('cellularRsrq', signalDetails.rsrq);
	setSummaryItem('cellularBand', signalDetails.band);
	setSummaryItem('cellularFrequency', signalDetails.frequency);
	setSummaryItem('cellularPci', signalDetails.pci);
	setSummaryItem('cellularSimHint', state.pendingSimSlot ? ('切卡进行中，目标：' + getSimSlotLabel(simInfo, state.pendingSimSlot)) : simHint);

	if (els.cellularModeSelect && state.cellularMode)
		els.cellularModeSelect.value = state.cellularMode;

	renderSimOptions({
		slot: effectiveSlot,
		options: simInfo.options
	});
	renderBandLockForm();
	renderCellLockTables();

	if (els.cellularToggleBtn) {
		els.cellularToggleBtn.textContent = connected ? '断开蜂窝' : '连接蜂窝';
		els.cellularToggleBtn.disabled = !state.connected || !!state.cellularBusy;
	}

	if (els.cellularModeApplyBtn)
		els.cellularModeApplyBtn.disabled = !state.connected || !!state.cellularBusy;

	if (els.cellularRefreshBtn)
		els.cellularRefreshBtn.disabled = !state.connected || !!state.cellularBusy;

	if (els.cellularSimSelect)
		els.cellularSimSelect.disabled = !state.connected || !!state.cellularBusy;

	if (els.cellularSimApplyBtn)
		els.cellularSimApplyBtn.disabled = !state.connected || !!state.cellularBusy;
}

function renderAdvanced() {
	if (els.advancedStatus) {
		if (!state.connected)
			els.advancedStatus.textContent = '请先连接后台';
		else if (state.advancedBusy)
			els.advancedStatus.textContent = '高级功能执行中';
		else
			els.advancedStatus.textContent = '仅保留小核切换';
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
		+ '.ufi-summary-item strong{display:block;font-size:12px;color:var(--ufi-muted);margin-bottom:8px;}.ufi-summary-item span{font-size:16px;font-weight:700;line-height:1.4;display:block;}'
		+ '.ufi-function-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}'
		+ '.ufi-function-btn{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--ufi-line);background:#fff;padding:14px 16px;border-radius:18px;font-size:14px;font-weight:700;color:var(--ufi-text);cursor:pointer;min-height:56px;text-align:left;}'
		+ '.ufi-function-btn:hover{border-color:#b6d5d1;background:#f7fffd;}'
		+ '.ufi-function-btn.is-selected{border-color:#0f766e;background:#ecfdf5;box-shadow:inset 0 0 0 1px rgba(15,118,110,.12);}'
		+ '.ufi-modal-wrap{position:fixed;inset:0;background:rgba(15,23,42,.35);display:flex;align-items:flex-end;justify-content:center;padding:24px;z-index:2000;}'
		+ '.ufi-modal-wrap[hidden]{display:none !important;pointer-events:none !important;}'
		+ '.ufi-panel{width:min(980px,100%);max-height:90vh;overflow:auto;background:#f8fbfd;border-radius:28px;padding:18px;box-shadow:0 32px 64px rgba(15,23,42,.25);}'
		+ '.ufi-panel[hidden]{display:none !important;}'
		+ '.ufi-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;}.ufi-panel-head h3{margin:0;font-size:22px;}'
		+ '.ufi-sms-list{display:grid;gap:12px;}.ufi-sms-item{padding:14px 16px;border-radius:18px;background:#fff;border:1px solid var(--ufi-line);}.ufi-sms-item.is-in{border-left:5px solid #0f766e;}.ufi-sms-item.is-out{border-left:5px solid #d97706;}.ufi-sms-head,.ufi-sms-actions{display:flex;justify-content:space-between;align-items:center;gap:8px;}.ufi-sms-body{margin:10px 0 12px;line-height:1.7;white-space:pre-wrap;word-break:break-word;}'
		+ '.ufi-empty{padding:20px 12px;text-align:center;color:var(--ufi-muted);}'
		+ '.ufi-toast-wrap{position:fixed;top:82px;right:18px;display:grid;gap:10px;z-index:3000;}'
		+ '.ufi-toast{min-width:220px;max-width:360px;color:#fff;padding:12px 14px;border-radius:14px;box-shadow:0 16px 30px rgba(15,23,42,.18);transition:all .28s ease;}.ufi-toast.is-leaving{opacity:0;transform:translateY(-8px);}'
		+ '.ufi-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}.ufi-kv div{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);}.ufi-kv span{display:block;font-size:12px;color:var(--ufi-muted);margin-bottom:8px;}.ufi-kv strong{font-size:16px;display:block;line-height:1.5;word-break:break-word;}'
		+ '.ufi-mini-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}'
		+ '.ufi-mini-item{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);}'
		+ '.ufi-mini-item strong{display:block;font-size:12px;color:var(--ufi-muted);margin-bottom:8px;}'
		+ '.ufi-mini-item span{font-size:15px;font-weight:700;display:block;line-height:1.4;}'
		+ '.ufi-note{margin-top:10px;font-size:12px;color:var(--ufi-muted);line-height:1.6;}'
		+ '.ufi-advanced-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}'
		+ '.ufi-result{margin:0;padding:14px 16px;border-radius:16px;background:#fff;border:1px solid var(--ufi-line);white-space:pre-wrap;word-break:break-word;min-height:64px;line-height:1.7;}'
		+ '.ufi-result.is-error{border-color:#ef9a9a;background:#fff7f7;color:#b91c1c;}'
		+ '.ufi-section{display:grid;gap:12px;margin-top:16px;}'
		+ '.ufi-section:first-of-type{margin-top:0;}'
		+ '.ufi-section-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:2px;}'
		+ '.ufi-section-head h4{margin:0;font-size:16px;}'
		+ '.ufi-switch-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}'
		+ '.ufi-switch-card{padding:14px;border-radius:18px;background:#fff;border:1px solid var(--ufi-line);display:grid;gap:10px;}'
		+ '.ufi-switch-card strong{font-size:15px;}'
		+ '.ufi-switch-card span{font-size:12px;color:var(--ufi-muted);}'
		+ '@media (max-width:1080px){.ufi-hero,.ufi-grid{grid-template-columns:1fr;}.ufi-toolbar,.ufi-function-grid,.ufi-summary-list,.ufi-advanced-grid,.ufi-mini-list{grid-template-columns:repeat(2,minmax(0,1fr));}}'
		+ '@media (max-width:640px){.ufi-shell{padding:0 10px;}.ufi-toolbar,.ufi-function-grid,.ufi-summary-list,.ufi-kv,.ufi-login-grid,.ufi-advanced-grid,.ufi-mini-list{grid-template-columns:1fr;}.ufi-modal-wrap{padding:10px;align-items:flex-end;}.ufi-panel{padding:14px;border-radius:22px;}.ufi-hero-title{font-size:24px;}}'
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
		+ '<div class="ufi-stack"><div class="ufi-card"><div class="ufi-panel-head"><h3>核心状态</h3></div><div class="ufi-summary-list"><div class="ufi-summary-item"><strong>运营商</strong><span id="sumProvider">-</span></div><div class="ufi-summary-item"><strong>信号</strong><span id="sumSignal">-</span></div><div class="ufi-summary-item"><strong>CPU 温度</strong><span id="sumTemp">-</span></div><div class="ufi-summary-item"><strong>CPU 占用</strong><span id="sumCpu">-</span></div><div class="ufi-summary-item"><strong>内存占用</strong><span id="sumMem">-</span></div><div class="ufi-summary-item"><strong>WiFi 终端</strong><span id="sumWifi">-</span></div><div class="ufi-summary-item"><strong>本月流量</strong><span id="sumMonthly">-</span></div></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>流量信息</h3></div><div class="ufi-kv"><div><span>已用流量</span><strong id="sumUsedFlow">-</strong></div><div><span>当日流量</span><strong id="sumDaily">-</strong></div><div><span>本月已用</span><strong id="sumMonthlyUsed">-</strong></div><div><span>连接时长</span><strong id="sumRealtimeTime">-</strong></div><div><span>总时长</span><strong id="sumTotalTime">-</strong></div><div><span>内部存储</span><strong id="sumStorage">-</strong></div></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>锁定频段</h3></div><div class="ufi-mini-list" id="bandLockForm"></div><div class="ufi-actions"><button class="cbi-button cbi-button-neutral" id="cellularBandLockApplyBtn">应用锁频段</button><button class="cbi-button cbi-button-neutral" id="cellularBandUnlockBtn">解除锁频段</button></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>锁定基站</h3></div><div class="ufi-note">候选基站仅用于持续高亮参考，PCI 和频率请手动填写</div><div class="ufi-panel-head" style="margin-top:10px;"><h3 style="font-size:16px;">已锁基站</h3></div><div class="ufi-mini-list" id="cellularLockedCells"></div><div class="ufi-panel-head" style="margin-top:10px;"><h3 style="font-size:16px;">候选基站</h3></div><div class="ufi-mini-list" id="cellularNeighborCells"></div><div class="ufi-login-grid"><label class="ufi-field"><span>网络制式</span><select id="cellularLockRat"><option value="16">5G</option><option value="12">4G</option></select></label><label class="ufi-field"><span>PCI</span><input id="cellularLockPci" type="text" placeholder="PCI"></label><label class="ufi-field"><span>频率</span><input id="cellularLockEarfcn" type="text" placeholder="EARFCN"></label></div><div class="ufi-actions"><button class="cbi-button cbi-button-neutral" id="cellularCellLockBtn">锁定基站</button><button class="cbi-button cbi-button-neutral" id="cellularCellUnlockBtn">解除锁定基站</button></div></div></div>'
		+ '<div class="ufi-stack"><div class="ufi-card"><div class="ufi-panel-head"><h3>功能入口</h3></div><div class="ufi-function-grid"><button class="ufi-function-btn" data-open-panel="sms">短信 <span>↗</span></button><button class="ufi-function-btn" data-open-panel="cellular">蜂窝开关 <span>↗</span></button><button class="ufi-function-btn" data-open-panel="settings">设备设置 <span>↗</span></button><button class="ufi-function-btn" data-open-panel="advance">高级功能 <span>↗</span></button></div></div><div class="ufi-card"><div class="ufi-panel-head"><h3>CPU 频率</h3></div><div class="ufi-kv"><div><span>当前主频</span><strong id="cpuFreqSummary">-</strong></div></div><div class="ufi-mini-list" id="cpuFreqList"></div></div></div>'
		+ '</section>'
		+ '</div>'
		+ '<div class="ufi-modal-wrap" hidden>'
		+ '<section class="ufi-panel" data-panel="sms" hidden><div class="ufi-panel-head"><h3>短信</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-field"><span>收件号码</span><input id="smsPhone" type="text" placeholder="手机号"></div><div class="ufi-field"><span>短信内容</span><textarea id="smsContent" rows="4" placeholder="输入短信内容"></textarea></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="smsSendBtn">发送短信</button></div><div class="ufi-sms-list" id="smsThreadList"></div></section>'
		+ '<section class="ufi-panel" data-panel="cellular" hidden><div class="ufi-panel-head"><h3>蜂窝开关</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-kv"><div><span>连接状态</span><strong id="cellularStatus">-</strong></div><div><span>网络类型</span><strong id="cellularNetwork">-</strong></div><div><span>运营商</span><strong id="cellularProvider">-</strong></div><div><span>信号</span><strong id="cellularSignal">-</strong></div><div><span>当前模式</span><strong id="cellularMode">-</strong></div><div><span>当前 SIM</span><strong id="cellularSimCurrent">-</strong></div><div><span>QCI 信息</span><strong id="cellularQci">-</strong></div><div><span>接收功率</span><strong id="cellularPower">-</strong></div><div><span>SINR</span><strong id="cellularSinr">-</strong></div><div><span>RSRQ</span><strong id="cellularRsrq">-</strong></div><div><span>注册频段</span><strong id="cellularBand">-</strong></div><div><span>频率</span><strong id="cellularFrequency">-</strong></div><div><span>PCI</span><strong id="cellularPci">-</strong></div></div><div class="ufi-login-grid"><label class="ufi-field"><span>网络模式</span><select id="cellularModeSelect"><option value="WL_AND_5G">5G 优先</option><option value="LTE_AND_5G">4G/5G 自动</option><option value="Only_5G">仅 5G</option><option value="WCDMA_AND_LTE">3G/4G 自动</option><option value="Only_LTE">仅 4G</option><option value="Only_WCDMA">仅 3G</option></select></label><label class="ufi-field"><span>SIM 卡槽</span><select id="cellularSimSelect"><option value="0">SIM 1</option><option value="1">SIM 2</option></select></label></div><div class="ufi-note" id="cellularSimHint">-</div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="cellularToggleBtn">切换连接</button><button class="cbi-button cbi-button-neutral" id="cellularModeApplyBtn">应用模式</button><button class="cbi-button cbi-button-neutral" id="cellularSimApplyBtn">切换 SIM</button><button class="cbi-button cbi-button-neutral" id="cellularRefreshBtn">刷新状态</button></div></section>'
		+ '<section class="ufi-panel" data-panel="settings" hidden><div class="ufi-panel-head"><h3>设备设置</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-note" id="settingsHint">等待连接后台</div><div class="ufi-actions"><button class="cbi-button cbi-button-neutral" id="settingsRefreshBtn">刷新设置</button></div><div class="ufi-section"><div class="ufi-section-head"><h4>快捷开关</h4></div><div class="ufi-switch-grid"><div class="ufi-switch-card"><strong>性能模式</strong><span id="settingsPerformance">-</span><button class="cbi-button cbi-button-neutral" id="settingsPerformanceBtn">切换性能模式</button></div><div class="ufi-switch-card"><strong>网络漫游</strong><span id="settingsRoaming">-</span><button class="cbi-button cbi-button-neutral" id="settingsRoamingBtn">切换网络漫游</button></div><div class="ufi-switch-card"><strong>指示灯</strong><span id="settingsIndicator">-</span><button class="cbi-button cbi-button-neutral" id="settingsIndicatorBtn">切换指示灯</button></div><div class="ufi-switch-card"><strong>定时重启</strong><span id="settingsSchedule">-</span><button class="cbi-button cbi-button-remove" id="settingsRebootBtn">立即重启设备</button></div></div></div><div class="ufi-section"><div class="ufi-section-head"><h4>WiFi 设置</h4><span id="settingsWifiBand">-</span></div><div class="ufi-login-grid"><label class="ufi-field"><span>WiFi 模式</span><select id="settingsWifiBandSelect"><option value="0">关闭</option><option value="chip1">2.4G</option><option value="chip2">5G</option></select></label><div class="ufi-actions" style="margin-top:24px;"><button class="cbi-button cbi-button-neutral" id="settingsWifiBandApplyBtn">应用频段</button></div><input id="settingsWifiAccessPointIndex" type="hidden"><input id="settingsWifiChipIndex" type="hidden"><label class="ufi-field"><span>WiFi 名称</span><input id="settingsWifiSSID" type="text" placeholder="SSID"></label><label class="ufi-field"><span>安全模式</span><select id="settingsWifiAuthMode"><option value="OPEN">OPEN</option><option value="WPA2PSK">WPA2(AES)-PSK</option><option value="WPA3PSK">WPA3-PSK</option><option value="WPA2PSKWPA3PSK">WPA2-PSK/WPA3-PSK</option></select></label><label class="ufi-field" id="settingsWifiPasswordField"><span>WiFi 密码</span><input id="settingsWifiPassword" type="password" placeholder="密码最短为 8 位"></label><label class="ufi-field"><span>最大连接数</span><input id="settingsWifiMaxClients" type="number" min="1" max="32" placeholder="8"></label><label class="ufi-field"><span>广播 SSID</span><input id="settingsWifiBroadcast" type="checkbox"></label></div><div class="ufi-actions"><button class="cbi-button cbi-button-action" id="settingsWifiSaveBtn">保存 WiFi 设置</button></div></div><div class="ufi-section"><div class="ufi-section-head"><h4>定时重启</h4></div><div class="ufi-login-grid"><label class="ufi-field"><span>启用定时重启</span><input id="settingsScheduleEnabled" type="checkbox"></label><label class="ufi-field"><span>重启时间</span><input id="settingsScheduleTime" type="time"></label></div><div class="ufi-actions"><button class="cbi-button cbi-button-neutral" id="settingsScheduleApplyBtn">保存定时重启</button></div></div></section>'
		+ '<section class="ufi-panel" data-panel="advance" hidden><div class="ufi-panel-head"><h3>高级功能</h3><button class="cbi-button cbi-button-neutral" data-close-panel="1">关闭</button></div><div class="ufi-note" id="advancedStatus">等待连接后台</div><div class="ufi-advanced-grid"><button class="cbi-button cbi-button-neutral" id="advDisableLittleCoreBtn">关闭小核</button><button class="cbi-button cbi-button-neutral" id="advEnableLittleCoreBtn">开启小核</button></div><div class="ufi-panel-head" style="margin-top:16px;"><h3 style="font-size:16px;">执行结果</h3></div><p id="AD_RESULT" class="ufi-result">等待执行结果</p></section>'
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
	renderSettings();
	renderAdvanced();
}
