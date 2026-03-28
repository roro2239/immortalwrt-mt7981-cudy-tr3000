/*
模块职责：
这里只保留短信、蜂窝开关和高级功能三条业务链。
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

function loadCellularPanel() {
	pushLog('INFO', '开始读取蜂窝状态');
	return Promise.all([
		getCellularMode().catch(function() { return ''; }),
		getSimInfo().catch(function() { return null; })
	]).then(function(results) {
		state.cellularMode = text(results[0], '');
		state.simInfo = results[1];
		return getQciInfo(state.simInfo).catch(function() {
			return null;
		});
	}).then(function(qciInfo) {
		state.qciInfo = qciInfo;
		renderCellular();
		pushLog('INFO', '蜂窝状态已加载');
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
			Promise.all([
				loadDashboard(),
				loadCellularPanel()
			]).catch(function(err) {
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
			loadCellularPanel()
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
			showToast('SIM 卡切换指令已发送', 'success');
			return wait(2500).then(function() {
				return Promise.all([
					loadDashboard(),
					loadCellularPanel()
				]);
			});
		}

		throw new Error(text(res && res.result, 'SIM 卡切换失败'));
	}).catch(function(err) {
		showToast(text(err && err.message, 'SIM 卡切换失败'), 'error');
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
			loadCellularPanel()
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
		'sumModel', 'sumNetwork', 'sumProvider', 'sumSpeed', 'sumTemp', 'sumCpu', 'sumMem', 'sumBattery', 'sumSignal', 'sumWifi', 'sumMonthly',
		'sumUsedFlow', 'sumDaily', 'sumMonthlyUsed', 'sumRealtimeTime', 'sumTotalTime', 'sumStorage', 'cpuFreqSummary', 'cpuFreqList',
		'statusText', 'statusHint',
		'smsThreadList', 'smsPhone', 'smsContent', 'smsSendBtn',
		'cellularStatus', 'cellularNetwork', 'cellularProvider', 'cellularSignal', 'cellularMode', 'cellularSimCurrent', 'cellularQci',
		'cellularPower', 'cellularSinr', 'cellularRsrq', 'cellularBand', 'cellularFrequency', 'cellularPci',
		'cellularModeSelect', 'cellularSimSelect', 'cellularSimHint', 'cellularToggleBtn', 'cellularModeApplyBtn', 'cellularSimApplyBtn', 'cellularRefreshBtn',
		'advancedStatus', 'advDisableLittleCoreBtn', 'advEnableLittleCoreBtn', 'AD_RESULT'
	].forEach(function(id) {
		els[id] = rootEl.querySelector('#' + id);
	});
}
