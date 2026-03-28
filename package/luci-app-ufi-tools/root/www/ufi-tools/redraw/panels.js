/*
模块职责：
这里只保留短信、蜂窝开关、设备设置和高级功能四条业务链。
插件、旧完整功能列表、网络锁定等已整体移除，避免残留半截入口。
*/

function loadSms() {
	pushLog('INFO', '开始读取短信列表');
	return getSmsInfo(0, 200).then(function(res) {
		state.smsList = Array.isArray(res && res.messages) ? res.messages : [];
		renderSms();
		pushLog('INFO', '短信列表已加载，共 ' + state.smsList.length + ' 条');

		var unread = state.smsList.filter(function(item) {
			return String(item.tag) === '1';
		}).map(function(item) {
			return item.id;
		});

		if (unread.length)
			markSmsRead(unread);
	});
}

function loadDashboard() {
	pushLog('INFO', '开始读取设备状态');
	return Promise.all([
		getUFIData(),
		getCellularMode().catch(function() { return ''; }),
		getSimInfo().catch(function() { return null; })
	]).then(function(results) {
		state.ufiData = results[0];
		state.cellularMode = text(results[1], '');
		state.simInfo = results[2];
		if (state.pendingSimSlot && state.simInfo && text(state.simInfo.slot, '').trim() === text(state.pendingSimSlot, '').trim()) {
			state.pendingSimSlot = '';
			state.simSlotDraft = '';
		}
		return getQciInfo(state.simInfo).catch(function() {
			return null;
		});
	}).then(function(qciInfo) {
		state.qciInfo = qciInfo;
		state.error = '';
		renderSummary();
		renderCellular();
		pushLog('INFO', '设备状态已加载');
	});
}

function loadRealtimeDashboard() {
	return getUFIData().then(function(data) {
		state.ufiData = Object.assign({}, state.ufiData || {}, data || {});
		state.error = '';
		renderRealtimeSummary();
		renderCellular();
	});
}

function loadDashboardSnapshot() {
	return getUFIData().then(function(data) {
		state.ufiData = Object.assign({}, state.ufiData || {}, data || {});
		state.error = '';
		renderSummary();
		renderCellular();
	});
}

function loadCellularPanel() {
	pushLog('INFO', '开始读取蜂窝状态');
	return Promise.all([
		getCellularMode().catch(function() { return ''; }),
		getSimInfo().catch(function() { return null; }),
		getBandLockInfo().catch(function() {
			return {
				lteBands: [],
				nrBands: []
			};
		}),
		getCellLockInfo().catch(function() {
			return {
				neighborCells: [],
				lockedCells: []
			};
		})
	]).then(function(results) {
		state.cellularMode = text(results[0], '');
		state.simInfo = results[1];
		state.bandLockInfo = results[2];
		state.cellLockInfo = results[3];
		if (state.pendingSimSlot && state.simInfo && text(state.simInfo.slot, '').trim() === text(state.pendingSimSlot, '').trim()) {
			state.pendingSimSlot = '';
			state.simSlotDraft = '';
		}
		return getQciInfo(state.simInfo).catch(function() {
			return null;
		});
	}).then(function(qciInfo) {
		state.qciInfo = qciInfo;
		renderCellular();
		pushLog('INFO', '蜂窝状态已加载');
	});
}

function loadSettingsPanel() {
	pushLog('INFO', '开始读取设备设置');
	return getDeviceSettings().then(function(settings) {
		state.deviceSettings = settings;
		renderSettings();
		pushLog('INFO', '设备设置已加载');
	});
}

function startRealtimeRefresh() {
	stopRealtimeRefresh();
	state.fastTimer = window.setInterval(function() {
		if (state.connected) {
			loadRealtimeDashboard().catch(function(err) {
				handleBackgroundDisconnect(err, 'realtime_refresh');
			});
		}
	}, FAST_REFRESH_MS);
}

function startRefresh() {
	stopRefresh();
	state.timer = window.setInterval(function() {
		if (state.connected)
			loadDashboardSnapshot().catch(function(err) {
				handleBackgroundDisconnect(err, 'refresh');
			});
	}, REFRESH_MS);
}

function stopRefresh() {
	if (state.timer) {
		window.clearInterval(state.timer);
		state.timer = null;
	}
}

function stopRealtimeRefresh() {
	if (state.fastTimer) {
		window.clearInterval(state.fastTimer);
		state.fastTimer = null;
	}
}

function startSmsRefresh() {
	stopSmsRefresh();
	state.smsTimer = window.setInterval(function() {
		var panel = rootEl.querySelector('.ufi-panel[data-panel="sms"]');
		if (state.connected && panel && !panel.hidden)
			loadSms().catch(function() {});
	}, 2000);
}

function stopSmsRefresh() {
	if (state.smsTimer) {
		window.clearInterval(state.smsTimer);
		state.smsTimer = null;
	}
}

function handleBackgroundDisconnect(err, source) {
	if (!state.connected && !state.connecting)
		return;

	state.connected = false;
	state.cookie = '';
	state.error = text(err && err.message, '后台连接已断开');
	state.lastDisconnectReason = text(source, 'refresh');
	stopRefresh();
	stopRealtimeRefresh();
	stopSmsRefresh();
	renderAll();
	showToast('后台连接已断开，正在尝试恢复', 'info');
	scheduleReconnect(state.lastDisconnectReason, 1200);
}

function withTimeout(promise, ms, message) {
	return new Promise(function(resolve, reject) {
		var done = false;
		var timer = window.setTimeout(function() {
			if (done)
				return;
			done = true;
			reject(new Error(message || '请求超时'));
		}, ms);

		promise.then(function(result) {
			if (done)
				return;
			done = true;
			window.clearTimeout(timer);
			resolve(result);
		}).catch(function(err) {
			if (done)
				return;
			done = true;
			window.clearTimeout(timer);
			reject(err);
		});
	});
}

function connectBackend() {
	var job;
	var phase = 'init';

	clearReconnectTimer();
	startInteractiveLog('连接后台日志');
	state.connecting = true;
	state.error = '';
	state.autoReconnectPaused = false;
	state.lastDisconnectReason = '';
	pushLog('INFO', '开始连接后台');
	pushLog('INFO', '当前前端版本：' + APP_RELEASE);
	renderSummary();

	state.backendPassword = els.password.value.trim();
	state.loginMethod = els.loginMethod.value;
	state.tokenMode = els.tokenMode.value;
	window.localStorage.setItem(PASSWORD_KEY, state.backendPassword);
	window.localStorage.setItem(LOGIN_METHOD_KEY, state.loginMethod);
	window.localStorage.setItem(TOKEN_MODE_KEY, state.tokenMode);

	if (!state.backendPassword) {
		state.connecting = false;
		state.error = '请输入某兴后台密码';
		pushLog('WARN', state.error);
		renderSummary();
		return Promise.resolve(null);
	}

	if (state.tokenMode === 'no_token') {
		state.tokenHash = '';
		window.localStorage.removeItem(AUTH_TOKEN_KEY);
	}
	else if (state.needToken) {
		var token = els.token.value.trim();
		if (!token && !state.tokenHash) {
			state.connecting = false;
			state.error = '请输入 UFI-TOOLS 口令';
			pushLog('WARN', state.error);
			renderSummary();
			return Promise.resolve(null);
		}
		if (token) {
			state.tokenHash = sha256Hex(token);
			window.localStorage.setItem(AUTH_TOKEN_KEY, state.tokenHash);
		}
	}
	else {
		state.tokenHash = '';
		window.localStorage.removeItem(AUTH_TOKEN_KEY);
	}

	job = withTimeout(Promise.resolve().then(function() {
		phase = 'login';
		pushLog('INFO', '连接阶段：登录');
		return login();
	}).then(function() {
		state.connected = true;
		pushLog('INFO', '连接阶段完成：登录');
		phase = 'dashboard';
		pushLog('INFO', '连接阶段：同步设备数据');
		return Promise.all([
			loadDashboard(),
			loadSms(),
			loadCellularPanel(),
			loadSettingsPanel()
		]);
	}), CONNECT_TIMEOUT, '连接超时').then(function() {
		state.autoReconnectPaused = false;
		state.lastDisconnectReason = '';
		pushLog('INFO', '连接阶段完成：同步设备数据');
		showToast('后台连接成功', 'success');
		startRealtimeRefresh();
		startRefresh();
	}).catch(function(err) {
		state.connected = false;
		state.cookie = '';
		state.error = text(err.message, '后台连接失败');
		state.lastDisconnectReason = phase;
		pushLog('WARN', '后台连接失败，阶段=' + phase + '：' + state.error);
		showToast(state.error, 'error');
		if (!state.autoReconnectPaused)
			scheduleReconnect('connect_failed', 1800);
	}).finally(function() {
		state.connecting = false;
		stopInteractiveLog();
		renderAll();
	});

	return job;
}

function disconnectBackend() {
	clearReconnectTimer();
	state.autoReconnectPaused = true;
	state.lastDisconnectReason = 'manual';
	logout('manual').finally(function() {
		showToast('后台已断开', 'info');
		renderAll();
	});
}

function setAdvancedResult(message, isError) {
	state.advancedError = !!isError;
	if (els.AD_RESULT) {
		els.AD_RESULT.textContent = text(message, '等待执行结果');
		els.AD_RESULT.classList.toggle('is-error', !!isError);
	}
	renderAdvanced();
}

function withSettingsAction(label, action) {
	state.settingsBusy = true;
	renderSettings();

	return Promise.resolve().then(action).catch(function(err) {
		showToast(text(err && err.message, label + '失败'), 'error');
	}).finally(function() {
		state.settingsBusy = false;
		renderSettings();
	});
}

function isWriteSuccess(res) {
	return !!(res && (res.__empty || res.result === 'success'));
}

function syncWifiPasswordVisibility() {
	var authMode = text(els.settingsWifiAuthMode && els.settingsWifiAuthMode.value, 'OPEN').trim();
	var isOpen = authMode === 'OPEN';

	if (els.settingsWifiPasswordField)
		els.settingsWifiPasswordField.style.display = isOpen ? 'none' : '';

	if (els.settingsWifiPassword)
		els.settingsWifiPassword.disabled = !state.connected || !!state.settingsBusy || isOpen;
}

function togglePerformanceMode() {
	var current = !!(state.deviceSettings && state.deviceSettings.performanceMode);

	return withSettingsAction('切换性能模式', function() {
		return setPerformanceMode(!current).then(function(res) {
			if (!isWriteSuccess(res))
				throw new Error(text(res && res.result, '性能模式切换失败'));

			showToast(!current ? '性能模式已开启' : '性能模式已关闭', 'success');
			return loadSettingsPanel();
		});
	});
}

function toggleRoamingSetting() {
	var current = !!(state.deviceSettings && state.deviceSettings.roamingEnabled);

	return withSettingsAction('切换网络漫游', function() {
		return setRoamingSetting(!current).then(function(res) {
			if (!isWriteSuccess(res))
				throw new Error(text(res && res.result, '网络漫游切换失败'));

			showToast(!current ? '网络漫游已开启' : '网络漫游已关闭', 'success');
			return loadSettingsPanel();
		});
	});
}

function toggleIndicatorLight() {
	var current = !!(state.deviceSettings && state.deviceSettings.indicatorLightEnabled);

	return withSettingsAction('切换指示灯', function() {
		return setIndicatorLightSetting(!current).then(function(res) {
			if (!isWriteSuccess(res))
				throw new Error(text(res && res.result, '指示灯切换失败'));

			showToast(!current ? '指示灯已开启' : '指示灯已关闭', 'success');
			return loadSettingsPanel();
		});
	});
}

function applyWifiBandChange() {
	var mode = text(els.settingsWifiBandSelect && els.settingsWifiBandSelect.value, '0').trim();

	return withSettingsAction('切换 WiFi 频段', function() {
		return setWifiBandMode(mode).then(function(res) {
			if (!isWriteSuccess(res))
				throw new Error(text(res && res.result, 'WiFi 频段切换失败'));

			showToast(mode === '0' ? 'WiFi 已关闭' : ('WiFi 已切换到 ' + (mode === 'chip1' ? '2.4G' : '5G')), 'success');
			return loadSettingsPanel();
		});
	});
}

function saveWifiSettingsAction() {
	var authMode = text(els.settingsWifiAuthMode && els.settingsWifiAuthMode.value, 'OPEN').trim();
	var password = text(els.settingsWifiPassword && els.settingsWifiPassword.value, '').trim();
	var ssid = text(els.settingsWifiSSID && els.settingsWifiSSID.value, '').trim();
	var maxClients = Number(text(els.settingsWifiMaxClients && els.settingsWifiMaxClients.value, '8').trim());
	var payload;

	if (!ssid)
		return Promise.reject(new Error('请输入 WiFi 名称'));

	if (!isFinite(maxClients) || maxClients < 1)
		return Promise.reject(new Error('最大连接数必须大于 0'));

	if (authMode !== 'OPEN' && password.length < 8)
		return Promise.reject(new Error('WiFi 密码最短为 8 位'));

	payload = {
		SSID: ssid,
		AuthMode: authMode,
		Password: password,
		ApMaxStationNumber: String(maxClients),
		ApBroadcastDisabled: !!(els.settingsWifiBroadcast && els.settingsWifiBroadcast.checked),
		ChipIndex: text(els.settingsWifiChipIndex && els.settingsWifiChipIndex.value, '0').trim(),
		AccessPointIndex: text(els.settingsWifiAccessPointIndex && els.settingsWifiAccessPointIndex.value, '0').trim()
	};

	return withSettingsAction('保存 WiFi 设置', function() {
		return saveWifiSettings(payload).then(function(res) {
			if (!isWriteSuccess(res))
				throw new Error(text(res && res.result, '保存 WiFi 设置失败'));

			showToast('WiFi 设置已保存，请重新连接 WiFi', 'success');
			return loadSettingsPanel();
		});
	});
}

function applyScheduleRebootSetting() {
	var enabled = !!(els.settingsScheduleEnabled && els.settingsScheduleEnabled.checked);
	var rebootTime = text(els.settingsScheduleTime && els.settingsScheduleTime.value, '').trim();

	if (!/^(0\d|1\d|2[0-3]):[0-5]\d$/.test(rebootTime))
		return Promise.reject(new Error('请输入正确的重启时间'));

	return withSettingsAction('保存定时重启', function() {
		return setScheduleRebootSetting(enabled, rebootTime).then(function(res) {
			if (!isWriteSuccess(res))
				throw new Error(text(res && res.result, '保存定时重启失败'));

			showToast(enabled ? '定时重启已保存' : '定时重启已关闭', 'success');
			return loadSettingsPanel();
		});
	});
}

function rebootDeviceAction() {
	return withSettingsAction('重启设备', function() {
		return rebootDevice().then(function(res) {
			if (!isWriteSuccess(res))
				throw new Error(text(res && res.result, '重启设备失败'));

			state.connected = false;
			state.cookie = '';
			state.error = '设备正在重启，稍后自动恢复连接';
			stopRefresh();
			stopRealtimeRefresh();
			stopSmsRefresh();
			renderAll();
			showToast('重启指令已发送，稍后自动恢复连接', 'success');
			scheduleReconnect('device_reboot', 8000);
		});
	});
}

function applyCellularMode() {
	var value = text(els.cellularModeSelect && els.cellularModeSelect.value, '').trim();

	if (!value) {
		showToast('请选择网络模式', 'error');
		return Promise.resolve();
	}

	startInteractiveLog('蜂窝模式日志');
	state.cellularBusy = true;
	renderCellular();

	return setCellularMode(value).then(function(res) {
		if (res && res.result === 'success') {
			state.cellularMode = value;
			showToast('蜂窝模式已应用', 'success');
			return loadDashboard().then(function() {
				return loadCellularPanel();
			});
		}

		throw new Error(text(res && res.result, '蜂窝模式应用失败'));
	}).catch(function(err) {
		showToast(text(err && err.message, '蜂窝模式应用失败'), 'error');
	}).finally(function() {
		state.cellularBusy = false;
		stopInteractiveLog();
		renderCellular();
	});
}

function applySimSlotChange() {
	var value = text(els.cellularSimSelect && els.cellularSimSelect.value, '').trim();

	if (!value) {
		showToast('请选择 SIM 卡槽', 'error');
		return Promise.resolve();
	}

	startInteractiveLog('SIM 切换日志');
	state.cellularBusy = true;
	renderCellular();

	return setSimSlot(value).then(function(res) {
		if (res && res.result === 'success') {
			state.pendingSimSlot = value;
			state.simSlotDraft = '';
			renderCellular();
			showToast('SIM 卡切换指令已发送', 'success');
			return wait(4500).then(function() {
				return Promise.all([
					loadDashboard(),
					loadCellularPanel()
				]);
			});
		}

		throw new Error(text(res && res.result, 'SIM 卡切换失败'));
	}).catch(function(err) {
		state.pendingSimSlot = '';
		showToast(text(err && err.message, 'SIM 卡切换失败'), 'error');
	}).finally(function() {
		state.cellularBusy = false;
		stopInteractiveLog();
		renderCellular();
	});
}

function collectSelectedBands(type) {
	return Array.prototype.map.call(rootEl.querySelectorAll('#bandLockForm input[type="checkbox"][data-band-type="' + type + '"]:checked'), function(input) {
		return text(input.getAttribute('data-band-value'), '').trim();
	}).filter(Boolean);
}

function syncBandLockDraftFromDom() {
	state.bandLockDraft = {
		lteBands: collectSelectedBands('lte'),
		nrBands: collectSelectedBands('nr')
	};
}

function isBandLockWriteSuccess(res, bands) {
	var expected = Array.isArray(bands) ? bands : [];

	if (!isWriteSuccess(res))
		return false;

	return true;
}

function bounceCellularMode(currentMode) {
	var fallbackMode;
	var availableModes = [
		'WL_AND_5G',
		'LTE_AND_5G',
		'Only_5G',
		'WCDMA_AND_LTE',
		'Only_LTE',
		'Only_WCDMA'
	];

	if (!currentMode)
		return Promise.resolve();

	fallbackMode = availableModes.find(function(mode) {
		return mode !== currentMode;
	});

	if (!fallbackMode)
		return setCellularMode(currentMode).catch(function() {
			return null;
		}).then(function() {
			return wait(1200);
		});

	return setCellularMode(fallbackMode).catch(function() {
		return null;
	}).then(function() {
		return wait(800);
	}).then(function() {
		return setCellularMode(currentMode).catch(function() {
			return null;
		});
	}).then(function() {
		return wait(1200);
	});
}

function applyBandLock() {
	var lteBands = collectSelectedBands('lte');
	var nrBands = collectSelectedBands('nr');
	var currentMode = text(state.cellularMode, '').trim();

	if (!lteBands.length && !nrBands.length)
		return unlockBandLock();

	startInteractiveLog('锁频段日志');
	state.cellularBusy = true;
	renderCellular();

	return Promise.all([
		setLteBandLock(lteBands),
		setNrBandLock(nrBands)
	]).then(function(results) {
		if (!isBandLockWriteSuccess(results[0], lteBands) || !isBandLockWriteSuccess(results[1], nrBands))
			throw new Error('锁频段失败');

		state.bandLockDraft = null;
		return bounceCellularMode(currentMode);
	}).then(function() {
		showToast('锁频段已应用', 'success');
		return loadCellularPanel();
	}).catch(function(err) {
		showToast(text(err && err.message, '锁频段失败'), 'error');
	}).finally(function() {
		state.cellularBusy = false;
		stopInteractiveLog();
		renderCellular();
	});
}

function unlockBandLock() {
	startInteractiveLog('解除锁频段日志');
	state.cellularBusy = true;
	renderCellular();

	return Promise.all([
		setLteBandLock([]),
		setNrBandLock([])
	]).then(function(results) {
		if (!isWriteSuccess(results[0]) || !isWriteSuccess(results[1]))
			throw new Error('解除锁频段失败');

		state.bandLockDraft = null;
		return bounceCellularMode(text(state.cellularMode, '').trim()).then(function() {
			showToast('已解除锁频段', 'success');
			return loadCellularPanel();
		});
	}).catch(function(err) {
		showToast(text(err && err.message, '解除锁频段失败'), 'error');
	}).finally(function() {
		state.cellularBusy = false;
		stopInteractiveLog();
		renderCellular();
	});
}

function applyCellLock() {
	var pci = text(els.cellularLockPci && els.cellularLockPci.value, '').trim();
	var earfcn = text(els.cellularLockEarfcn && els.cellularLockEarfcn.value, '').trim();
	var rat = text(els.cellularLockRat && els.cellularLockRat.value, '').trim();

	if (!pci || !earfcn) {
		showToast('请填写 PCI 和频率', 'error');
		return Promise.resolve();
	}

	startInteractiveLog('锁基站日志');
	state.cellularBusy = true;
	renderCellular();

	return lockCell(pci, earfcn, rat).then(function(res) {
		if (!isWriteSuccess(res))
			throw new Error(text(res && res.result, '锁基站失败'));

		showToast('锁基站已应用', 'success');
		state.selectedCell = null;
		return loadCellularPanel();
	}).catch(function(err) {
		showToast(text(err && err.message, '锁基站失败'), 'error');
	}).finally(function() {
		state.cellularBusy = false;
		stopInteractiveLog();
		renderCellular();
	});
}

function unlockCellLockAction() {
	startInteractiveLog('解除锁基站日志');
	state.cellularBusy = true;
	renderCellular();

	return unlockAllCell().then(function(res) {
		if (!isWriteSuccess(res))
			throw new Error(text(res && res.result, '解除锁定基站失败'));

		state.selectedCell = null;
		showToast('已解除锁定基站', 'success');
		return loadCellularPanel();
	}).catch(function(err) {
		showToast(text(err && err.message, '解除锁定基站失败'), 'error');
	}).finally(function() {
		state.cellularBusy = false;
		stopInteractiveLog();
		renderCellular();
	});
}

function toggleCellular() {
	var enable = String((state.ufiData || {}).ppp_status) === 'ppp_disconnected';

	startInteractiveLog(enable ? '连接蜂窝日志' : '断开蜂窝日志');
	state.cellularBusy = true;
	renderCellular();

	return setCellularConnection(enable).then(function(res) {
		if (res && res.result === 'success') {
			showToast(enable ? '蜂窝网络已连接' : '蜂窝网络已断开', 'success');
			return wait(1800).then(function() {
				return Promise.all([
					loadDashboard(),
					loadCellularPanel()
				]);
			});
		}

		throw new Error(text(res && res.result, '蜂窝切换失败'));
	}).catch(function(err) {
		showToast(text(err && err.message, '蜂窝切换失败'), 'error');
	}).finally(function() {
		state.cellularBusy = false;
		stopInteractiveLog();
		renderCellular();
	});
}

function runAdvancedAction(label, action) {
	startInteractiveLog(label);
	state.advancedBusy = true;
	state.advancedError = false;
	setAdvancedResult(label + '执行中...', false);

	return Promise.resolve().then(action).catch(function(err) {
		setAdvancedResult(text(err && err.message, label + '失败'), true);
		showToast(text(err && err.message, label + '失败'), 'error');
	}).finally(function() {
		state.advancedBusy = false;
		stopInteractiveLog();
		renderAdvanced();
	});
}

function handleSwitchLittleCoreAction(flag) {
	var shell = 'echo ' + (flag ? '1' : '0') + ' > /sys/devices/system/cpu/cpu0/online\n'
		+ 'echo ' + (flag ? '1' : '0') + ' > /sys/devices/system/cpu/cpu1/online\n'
		+ 'echo ' + (flag ? '1' : '0') + ' > /sys/devices/system/cpu/cpu2/online\n'
		+ 'echo ' + (flag ? '1' : '0') + ' > /sys/devices/system/cpu/cpu3/online';

	return runAdvancedAction(flag ? '开启小核' : '关闭小核', function() {
		return runRootShellCommand(shell).then(function(result) {
			if (!result.success)
				throw new Error(text(result.content, '执行失败'));

			setAdvancedResult(text(result.content, flag ? '小核已开启' : '小核已关闭'), false);
			showToast(flag ? '小核已开启' : '小核已关闭', 'success');
		});
	});
}

function bindEvents() {
	els.connectBtn.addEventListener('click', function() {
		if (state.connected)
			disconnectBackend();
		else
			connectBackend();
	});

	els.refreshBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		Promise.all([
			loadDashboard(),
			loadSms(),
			loadCellularPanel(),
			loadSettingsPanel()
		]).then(function() {
			showToast('数据已刷新', 'success');
		}).catch(function(err) {
			showToast(text(err && err.message, '刷新失败'), 'error');
		});
	});

	Array.prototype.forEach.call(rootEl.querySelectorAll('[data-open-panel]'), function(button) {
		button.addEventListener('click', function() {
			if (!state.connected) {
				showToast('请先连接后台', 'error');
				return;
			}

			openPanel(button.dataset.openPanel);
		});
	});

	Array.prototype.forEach.call(rootEl.querySelectorAll('[data-close-panel]'), function(button) {
		button.addEventListener('click', closePanels);
	});

	rootEl.querySelector('.ufi-modal-wrap').addEventListener('click', function(ev) {
		if (ev.target === this)
			closePanels();
	});

	els.smsSendBtn.addEventListener('click', function() {
		startInteractiveLog('短信发送日志');
		var number = els.smsPhone.value.trim();
		var content = els.smsContent.value.trim();

		if (!number || !content) {
			stopInteractiveLog();
			showToast('手机号和短信内容不能为空', 'error');
			return;
		}

		sendSms(number, content).then(function(res) {
			if (res && (res.result === 'success' || res.result === 'pending')) {
				els.smsContent.value = '';
				showToast(res.result === 'success' ? '短信发送成功' : text(res.message, '设备已记录短信'), res.result === 'success' ? 'success' : 'info');
				return loadSms();
			}

			throw new Error(text(res && res.message, '短信发送失败'));
		}).catch(function(err) {
			showToast(text(err && err.message, '短信发送失败'), 'error');
		}).finally(function() {
			stopInteractiveLog();
		});
	});

	els.cellularRefreshBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		Promise.all([
			loadDashboard(),
			loadCellularPanel()
		]).then(function() {
			showToast('蜂窝状态已刷新', 'success');
		}).catch(function(err) {
			showToast(text(err && err.message, '读取蜂窝状态失败'), 'error');
		});
	});

	els.cellularToggleBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		toggleCellular();
	});

	els.cellularModeApplyBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		applyCellularMode();
	});

	els.cellularSimApplyBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		applySimSlotChange();
	});

	els.cellularSimSelect.addEventListener('change', function() {
		state.simSlotDraft = text(els.cellularSimSelect && els.cellularSimSelect.value, '').trim();
	});

	els.cellularBandLockApplyBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}
		applyBandLock();
	});

	els.bandLockForm.addEventListener('change', function(ev) {
		if (ev.target && ev.target.matches('input[type="checkbox"][data-band-type]'))
			syncBandLockDraftFromDom();
	});

	els.cellularBandUnlockBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}
		unlockBandLock();
	});

	els.cellularCellLockBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}
		applyCellLock();
	});

	els.cellularCellUnlockBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}
		unlockCellLockAction();
	});

	els.settingsRefreshBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		loadSettingsPanel().then(function() {
			showToast('设备设置已刷新', 'success');
		}).catch(function(err) {
			showToast(text(err && err.message, '读取设备设置失败'), 'error');
		});
	});

	els.settingsPerformanceBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		togglePerformanceMode();
	});

	els.settingsRoamingBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		toggleRoamingSetting();
	});

	els.settingsIndicatorBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		toggleIndicatorLight();
	});

	els.settingsWifiBandApplyBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		applyWifiBandChange();
	});

	els.settingsWifiSaveBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		saveWifiSettingsAction().catch(function(err) {
			showToast(text(err && err.message, '保存 WiFi 设置失败'), 'error');
		});
	});

	els.settingsScheduleApplyBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		applyScheduleRebootSetting().catch(function(err) {
			showToast(text(err && err.message, '保存定时重启失败'), 'error');
		});
	});

	els.settingsRebootBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}

		rebootDeviceAction();
	});

	els.settingsWifiAuthMode.addEventListener('change', syncWifiPasswordVisibility);

	els.advDisableLittleCoreBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}
		handleSwitchLittleCoreAction(false);
	});

	els.advEnableLittleCoreBtn.addEventListener('click', function() {
		if (!state.connected) {
			showToast('请先连接后台', 'error');
			return;
		}
		handleSwitchLittleCoreAction(true);
	});
}

function collectEls() {
	[
		'tokenField', 'token', 'tokenMode', 'password', 'loginMethod', 'connectBtn', 'refreshBtn', 'toast', 'needTokenTag',
		'sumModel', 'sumNetwork', 'sumProvider', 'sumSpeed', 'sumTemp', 'sumCpu', 'sumMem', 'sumSignal', 'sumWifi', 'sumMonthly',
		'sumUsedFlow', 'sumDaily', 'sumMonthlyUsed', 'sumRealtimeTime', 'sumTotalTime', 'sumStorage', 'cpuFreqSummary', 'cpuFreqList',
		'statusText', 'statusHint',
		'smsThreadList', 'smsPhone', 'smsContent', 'smsSendBtn',
		'cellularStatus', 'cellularNetwork', 'cellularProvider', 'cellularSignal', 'cellularMode', 'cellularSimCurrent', 'cellularQci',
		'cellularPower', 'cellularSinr', 'cellularRsrq', 'cellularBand', 'cellularFrequency', 'cellularPci',
		'cellularModeSelect', 'cellularSimSelect', 'cellularSimHint', 'cellularToggleBtn', 'cellularModeApplyBtn', 'cellularSimApplyBtn', 'cellularRefreshBtn',
		'bandLockForm', 'cellularBandLockApplyBtn', 'cellularBandUnlockBtn', 'cellularLockedCells', 'cellularNeighborCells',
		'cellularLockRat', 'cellularLockPci', 'cellularLockEarfcn', 'cellularCellLockBtn', 'cellularCellUnlockBtn',
		'settingsHint', 'settingsRefreshBtn', 'settingsPerformance', 'settingsPerformanceBtn', 'settingsRoaming', 'settingsRoamingBtn',
		'settingsIndicator', 'settingsIndicatorBtn', 'settingsSchedule', 'settingsRebootBtn', 'settingsWifiBand', 'settingsWifiBandSelect',
		'settingsWifiBandApplyBtn', 'settingsWifiAccessPointIndex', 'settingsWifiChipIndex', 'settingsWifiSSID', 'settingsWifiAuthMode',
		'settingsWifiPasswordField', 'settingsWifiPassword', 'settingsWifiMaxClients', 'settingsWifiBroadcast', 'settingsWifiSaveBtn',
		'settingsScheduleEnabled', 'settingsScheduleTime', 'settingsScheduleApplyBtn',
		'advancedStatus', 'advDisableLittleCoreBtn', 'advEnableLittleCoreBtn', 'AD_RESULT'
	].forEach(function(id) {
		els[id] = rootEl.querySelector('#' + id);
	});
}
