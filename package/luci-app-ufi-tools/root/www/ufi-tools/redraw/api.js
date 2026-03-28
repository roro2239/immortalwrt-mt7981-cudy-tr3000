/*
???????
?????????????????????????????/APN/ADB/??????????
???????????????????DOM ????????
*/


function buildHeaders(method, signPath, extra) {
	var headers = Object.assign({}, extra || {});
	var timestamp = Date.now();
	var signature;

	try {
		signature = hmacSignature('minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd', 'minikano' + method + signPath + timestamp);
	}
	catch (err) {
		pushLog('WARN', '构造请求头失败：' + method + ' ' + signPath + ' -> ' + text(err && err.message, '未知错误'));
		throw err;
	}

	headers['kano-t'] = String(timestamp);
	headers['kano-sign'] = signature;

	if (state.tokenMode !== 'no_token' && state.tokenHash)
		headers.Authorization = state.tokenHash;

	if (state.cookie)
		headers['kano-cookie'] = state.cookie;

	return headers;
}

function request(path, options) {
	var opts = options || {};
	var method = String(opts.method || 'GET').toUpperCase();
	var headers;
	var controller = new AbortController();
	var requestLabel = method + ' ' + path;
	var timeout = window.setTimeout(function() {
		controller.abort();
	}, Number(opts.timeout || DEFAULT_REQUEST_TIMEOUT));

	pushLog('INFO', '准备请求：' + requestLabel);
	headers = buildHeaders(method, opts.signPath || path, opts.headers);
	pushLog('INFO', '请求开始：' + requestLabel);

	return NATIVE_FETCH(PROXY_BASE + '?ufi_path=' + encodeURIComponent(path), {
		method: method,
		headers: headers,
		body: opts.body,
		cache: 'no-store',
		credentials: 'same-origin',
		signal: controller.signal
	}).then(function(res) {
		pushLog('INFO', '请求完成：' + requestLabel + ' -> HTTP ' + res.status);
		return res;
	}).catch(function(err) {
		if (err && err.name === 'AbortError')
			err = new Error('请求超时');
		pushLog('WARN', '请求失败：' + requestLabel + ' -> ' + text(err && err.message, '未知错误'));
		throw err;
	}).finally(function() {
		window.clearTimeout(timeout);
	});
}

function requestJson(path, options) {
	return request(path, options).then(function(res) {
		if (!res.ok)
			return res.text().then(function(body) {
				pushLog('WARN', '响应异常：' + path + ' -> ' + text(body, '请求失败'));
				throw new Error(text(body, '请求失败'));
			});

		return res.text().then(function(body) {
			if (!body) {
				pushRawLog(path, 'HTTP ' + res.status, '[EMPTY]');
				if (path.indexOf('cmd=LD') >= 0)
					pushLog('WARN', 'LD 响应为空');
				return {};
			}

			try {
				var data = JSON.parse(body);
				pushRawLog(path, 'HTTP ' + res.status, body.slice(0, 320));

				if (path.indexOf('cmd=LD') >= 0) {
					if (data && data.LD)
						pushLog('INFO', 'LD 响应已返回');
					else
						pushLog('WARN', 'LD 响应缺少字段，内容：' + body.slice(0, 240));
				}

				return data;
			}
			catch (err) {
				pushLog('WARN', 'JSON 解析失败：' + path + ' -> ' + body.slice(0, 240));
				throw new Error('响应解析失败：' + body.slice(0, 240));
			}
		});
	});
}

function parseOptionalJsonResponse(res, actionLabel) {
	return res.text().then(function(body) {
		if (actionLabel)
			pushLog('INFO', actionLabel + '：HTTP ' + res.status);

		if (!res.ok) {
			pushRawLog(actionLabel || '写操作', 'HTTP ' + res.status, text(body, '[EMPTY]').slice(0, 320));
			if (actionLabel)
				pushLog('WARN', actionLabel + '：响应异常 -> ' + text(body, 'HTTP ' + res.status));
			throw new Error(text(body, 'HTTP ' + res.status));
		}

		if (!body) {
			pushRawLog(actionLabel || '写操作', 'HTTP ' + res.status, '[EMPTY]');
			if (actionLabel)
				pushLog('INFO', actionLabel + '：响应为空');
			return { __empty: true, __status: res.status, __raw: '' };
		}

		try {
			var data = JSON.parse(body);
			pushRawLog(actionLabel || '写操作', 'HTTP ' + res.status, body.slice(0, 320));

			if (data && typeof data === 'object') {
				data.__status = res.status;
				data.__raw = body;
			}

			if (actionLabel)
				pushLog('INFO', actionLabel + '：响应摘要 -> ' + body.slice(0, 240));

			return data;
		}
		catch (err) {
			if (actionLabel)
				pushLog('WARN', actionLabel + '：响应解析失败 -> ' + body.slice(0, 240));
			throw new Error('响应解析失败：' + body.slice(0, 240));
		}
	});
}

function needToken() {
	return requestJson('/need_token', {
		signPath: '/api/need_token'
	}).then(function(res) {
		state.needToken = !!(res && res.need_token);
		pushLog('INFO', '口令需求：' + (state.needToken ? '需要口令' : '无需口令'));
		return res;
	});
}

function versionInfo() {
	return requestJson('/version_info', {
		signPath: '/api/version_info'
	}).then(function(res) {
		state.versionInfo = res || null;
		pushLog('INFO', '版本信息已加载');
		return res;
	});
}

function getCustomHead() {
	return requestJson('/get_custom_head', {
		signPath: '/api/get_custom_head'
	}).then(function(res) {
		return text(res && res.text, '');
	});
}

function setCustomHead(content) {
	return request('/set_custom_head', {
		method: 'POST',
		signPath: '/api/set_custom_head',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			text: text(content, '')
		})
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '保存插件');
	});
}

function getPluginStore() {
	return requestJson('/plugins_store', {
		signPath: '/api/plugins_store'
	}).then(function(res) {
		return res || {};
	});
}

function proxyText(url) {
	var remote = text(url, '').trim();
	var path = '/proxy/--' + remote;

	return request(path, {
		method: 'GET',
		signPath: '/api/proxy/--' + remote
	}).then(function(res) {
		if (!res.ok)
			return res.text().then(function(body) {
				throw new Error(text(body, '下载插件失败'));
			});

		return res.text();
	});
}

function buildPluginCompatCommonHeaders() {
	return {
		referer: '/api/index.html',
		host: '/api',
		origin: '/api',
		authorization: state.tokenMode !== 'no_token' ? text(state.tokenHash, '') : ''
	};
}

function normalizePluginCompatHeaders(headers) {
	var normalized = {};

	if (!headers)
		return normalized;

	if (typeof Headers !== 'undefined' && headers instanceof Headers) {
		headers.forEach(function(value, key) {
			normalized[key] = value;
		});
		return normalized;
	}

	if (Array.isArray(headers)) {
		headers.forEach(function(entry) {
			if (Array.isArray(entry) && entry.length >= 2)
				normalized[entry[0]] = entry[1];
		});
		return normalized;
	}

	Object.keys(headers).forEach(function(key) {
		normalized[key] = headers[key];
	});

	return normalized;
}

function pluginCompatFetch(input, init) {
	var translated = translatePluginCompatFetchInput(input);
	var opts = Object.assign({}, init || {});
	var method = String(opts.method || 'GET').toUpperCase();
	var headers = normalizePluginCompatHeaders(opts.headers);

	if (translated.remotePath)
		headers = buildHeaders(method, normalizePluginCompatSignPath(translated.remotePath), headers);

	opts.headers = headers;
	return NATIVE_FETCH(translated.input, opts);
}

function pluginCompatFetchWithTimeout(url, options, timeout) {
	var controller = new AbortController();
	var opts = Object.assign({}, options || {});
	var headers = Object.assign({}, buildPluginCompatCommonHeaders(), normalizePluginCompatHeaders(opts.headers));
	var timer = window.setTimeout(function() {
		controller.abort();
	}, Number(timeout) || 10000);

	opts.signal = controller.signal;
	opts.headers = headers;

	return pluginCompatFetch(url, opts).finally(function() {
		window.clearTimeout(timer);
	});
}

function adbKeepAliveForPlugin() {
	return requestJson('/adb_alive', {
		signPath: '/api/adb_alive'
	}).then(function(res) {
		return String(res && res.result) === 'true';
	}).catch(function() {
		return false;
	});
}

function runShellWithRootForPlugin(cmd, timeout) {
	return requestJson('/root_shell', {
		method: 'POST',
		signPath: '/api/root_shell',
		headers: {
			'Content-Type': 'application/json'
		},
		timeout: Number(timeout) || 10000,
		body: JSON.stringify({
			command: text(cmd, '').trim(),
			timeout: Number(timeout) || 10000
		})
	}).then(function(res) {
		var result = res && res.error ? {
			success: false,
			content: text(res.error, '')
		} : {
			success: true,
			content: text(res && res.result, '')
		};
		if (!result.success)
			writePluginCompatResult('AD_RESULT', '执行失败：' + text(result.content, ''), true);
		return result;
	}).catch(function(err) {
		var result = {
			success: false,
			content: text(err && err.message, '请求失败')
		};
		writePluginCompatResult('AD_RESULT', '执行失败：' + text(result.content, ''), true);
		return result;
	});
}

function runShellWithUserForPlugin(cmd, timeout) {
	return requestJson('/user_shell', {
		method: 'POST',
		signPath: '/api/user_shell',
		headers: {
			'Content-Type': 'application/json'
		},
		timeout: Number(timeout) || 10000,
		body: JSON.stringify({
			command: text(cmd, '').trim(),
			timeout: Number(timeout) || 10000
		})
	}).then(function(res) {
		var result = res && res.error ? {
			success: false,
			content: text(res.error, '')
		} : {
			success: true,
			content: text(res && res.result, '')
		};
		if (!result.success)
			writePluginCompatResult('AT_RESULT', '执行失败：' + text(result.content, ''), true);
		return result;
	}).catch(function(err) {
		var result = {
			success: false,
			content: text(err && err.message, '请求失败')
		};
		writePluginCompatResult('AT_RESULT', '执行失败：' + text(result.content, ''), true);
		return result;
	});
}

function checkAdvancedFuncForPlugin() {
	return runShellWithRootForPlugin('whoami').then(function(res) {
		return !!(res && res.content && String(res.content).indexOf('root') >= 0);
	});
}

function requestIntervalForPlugin(callback, interval) {
	var lastTime = 0;
	var rafId = null;

	function loop(timestamp) {
		if (!lastTime)
			lastTime = timestamp;

		if (timestamp - lastTime >= (Number(interval) || 0)) {
			try {
				callback();
			}
			catch (err) {}
			lastTime = timestamp;
		}

		rafId = window.requestAnimationFrame(loop);
	}

	rafId = window.requestAnimationFrame(loop);

	return function() {
		if (rafId)
			window.cancelAnimationFrame(rafId);
	};
}

function getLD() {
	return requestJson('/goform/goform_get_cmd_process?isTest=false&cmd=LD&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process'
	});
}

function getRD(cookie) {
	return requestJson('/goform/goform_get_cmd_process?isTest=false&cmd=RD&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process',
		headers: { 'kano-cookie': cookie }
	});
}

function getUFIInfo() {
	return requestJson('/goform/goform_get_cmd_process?isTest=false&cmd=Language,cr_version,wa_inner_version&multi_data=1&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process'
	});
}

function processAD(cookie) {
	return Promise.all([getUFIInfo(), getRD(cookie)]).then(function(results) {
		var info = results[0] || {};
		var rdData = results[1] || {};

		if (!info.wa_inner_version || !info.cr_version || !rdData.RD)
			throw new Error('无法生成 AD');

		return sha256HexUpper(sha256HexUpper(info.wa_inner_version + info.cr_version) + rdData.RD);
	});
}

function login() {
	pushLog('INFO', '开始登录，当前方式：' + (state.loginMethod === '1' ? '登录方式 2' : '登录方式 1'));
	return getLD().then(function(ldData) {
		if (!ldData || !ldData.LD)
			throw new Error('无法获取 LD');

		var passwordHash = sha256HexUpper(sha256HexUpper(state.backendPassword) + ldData.LD);
		var body = new URLSearchParams({
			goformId: state.loginMethod === '1' ? 'LOGIN_MULTI_USER' : 'LOGIN',
			isTest: 'false',
			password: passwordHash,
			user: 'admin'
		});

		if (state.loginMethod === '1')
			body.append('IP', 'localhost');

		pushLog('INFO', '提交登录请求：goformId=' + body.get('goformId') + (state.loginMethod === '1' ? '，附带 IP=localhost' : ''));

		return request('/goform/goform_set_cmd_process', {
			method: 'POST',
			signPath: '/goform/goform_set_cmd_process',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
			body: body
		}).then(function(res) {
			var cookie = res.headers.get('kano-cookie');

			return res.text().then(function(raw) {
				var data;

				pushLog('INFO', '登录响应摘要：' + text(raw, '').slice(0, 240));
				pushLog('INFO', '登录响应 cookie：' + (cookie ? '已返回' : '未返回'));

				try {
					data = raw ? JSON.parse(raw) : {};
				}
				catch (err) {
					pushLog('WARN', '登录响应解析失败：' + text(err && err.message, '未知错误'));
					throw new Error('登录响应解析失败');
				}

				pushLog('INFO', '登录响应 result=' + text(data && data.result, 'undefined'));

				if (!data || String(data.result) === '3')
					throw new Error('登录失败，请检查后台密码');

				if (!cookie)
					throw new Error('登录成功但未返回会话');

				state.cookie = cookie.split(';')[0];
				pushLog('INFO', '后台登录成功');
				return state.cookie;
			});
		});
	});
}

function logout(source) {
	var reason = text(source, 'unknown');

	if (!state.cookie)
		return Promise.resolve();

	pushLog('INFO', '开始断开后台，来源：' + reason);
	return processAD(state.cookie).then(function(ad) {
		var body = new URLSearchParams({
			goformId: 'LOGOUT',
			isTest: 'false',
			AD: ad
		});

		return request('/goform/goform_set_cmd_process', {
			method: 'POST',
			signPath: '/goform/goform_set_cmd_process',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'kano-cookie': state.cookie },
			body: body
		});
	}).catch(function() {
		return null;
	}).finally(function() {
		state.cookie = '';
		state.connected = false;
		stopRefresh();
		stopRealtimeRefresh();
		stopSmsRefresh();
		stopCellRefresh();
		pushLog('INFO', '后台已断开，来源：' + reason);
	});
}

function logoutWithCookie(cookie) {
	if (!cookie)
		return Promise.resolve();

	return processAD(cookie).then(function(ad) {
		var body = new URLSearchParams({
			goformId: 'LOGOUT',
			isTest: 'false',
			AD: ad
		});

		return request('/goform/goform_set_cmd_process', {
			method: 'POST',
			signPath: '/goform/goform_set_cmd_process',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'kano-cookie': cookie },
			body: body
		});
	}).catch(function() {
		return null;
	});
}

function getData(params) {
	var query = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
	query.append('isTest', 'false');
	query.append('_', Date.now());

	return requestJson('/goform/goform_get_cmd_process?' + query.toString(), {
		signPath: '/goform/goform_get_cmd_process'
	});
}

function postData(data) {
	return processAD(state.cookie).then(function(ad) {
		var body = new URLSearchParams(Object.assign({}, data, {
			isTest: 'false',
			AD: ad
		}));

		if (data && data.goformId === 'SEND_SMS') {
			pushRawLog('发送短信请求', 'FORM', body.toString().slice(0, 400));
			pushLog('INFO', '发送短信：表单已构造');
		}

		return request('/goform/goform_set_cmd_process', {
			method: 'POST',
			signPath: '/goform/goform_set_cmd_process',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'kano-cookie': state.cookie
			},
			body: body
		});
	});
}

function getCellularMode() {
	return getData({
		cmd: 'net_select'
	}).then(function(res) {
		return text(res && res.net_select, '');
	});
}

function setCellularMode(mode) {
	return postData({
		goformId: 'SET_BEARER_PREFERENCE',
		BearerPreference: text(mode, '').trim()
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '设置蜂窝模式');
	});
}

function setCellularConnection(enable) {
	return postData({
		goformId: enable ? 'CONNECT_NETWORK' : 'DISCONNECT_NETWORK'
	}).then(function(res) {
		return parseOptionalJsonResponse(res, enable ? '连接蜂窝网络' : '断开蜂窝网络');
	});
}

function requestDisableFota() {
	return requestJson('/disable_fota', {
		signPath: '/api/disable_fota'
	});
}

function requestOneClickShell() {
	return requestJson('/one_click_shell', {
		signPath: '/api/one_click_shell'
	});
}

function runRootShellCommand(command, timeout) {
	return requestJson('/root_shell', {
		method: 'POST',
		signPath: '/api/root_shell',
		headers: {
			'Content-Type': 'application/json'
		},
		timeout: Number(timeout) || 10000,
		body: JSON.stringify({
			command: text(command, '').trim(),
			timeout: Number(timeout) || 10000
		})
	}).then(function(res) {
		if (res && res.error) {
			return {
				success: false,
				content: text(res.error, '')
			};
		}

		return {
			success: true,
			content: text(res && res.result, '')
		};
	});
}

function checkAdvancedAvailable() {
	return runRootShellCommand('whoami').then(function(res) {
		return !!(res && res.success && String(res.content).indexOf('root') >= 0);
	}).catch(function() {
		return false;
	});
}

function getBaseDeviceInfo() {
	return requestJson('/baseDeviceInfo', {
		signPath: '/api/baseDeviceInfo'
	});
}

function getConnInfo() {
	return requestJson('/connInfo', {
		signPath: '/api/connInfo'
	}).then(function(res) {
		return res && res.result === 'success' ? res.data : null;
	});
}

function getUFIData() {
	var params = new URLSearchParams();
	var cmd = 'usb_port_switch,battery_charging,sms_received_flag,sms_unread_num,sms_sim_unread_num,sim_msisdn,data_volume_limit_switch,battery_value,battery_vol_percent,network_signalbar,network_rssi,cr_version,iccid,imei,imsi,ipv6_wan_ipaddr,lan_ipaddr,mac_address,msisdn,network_information,Lte_ca_status,rssi,Z5g_rsrp,lte_rsrp,wifi_access_sta_num,loginfo,data_volume_alert_percent,data_volume_limit_size,realtime_rx_thrpt,realtime_tx_thrpt,realtime_time,monthly_tx_bytes,monthly_rx_bytes,monthly_time,network_type,network_provider,ppp_status,Nr_bands,Nr_bands_widths,Nr_pci,Nr_cell_id,Nr_fcn,Nr_snr,nr_rsrq,Lte_bands,Lte_bands_widths,Lte_pci,Lte_cell_id,Lte_fcn,Lte_snr,lte_rsrq';
	params.append('multi_data', '1');
	params.append('isTest', 'false');
	params.append('cmd', cmd);
	params.append('_', Date.now());

	return Promise.all([
		requestJson('/goform/goform_get_cmd_process?' + params.toString(), {
			signPath: '/goform/goform_get_cmd_process'
		}),
		getBaseDeviceInfo().catch(function() { return {}; })
	]).then(function(results) {
		var resData = results[0] || {};
		var baseInfo = results[1] || {};

		if (!resData.msisdn && resData.sim_msisdn)
			resData.msisdn = resData.sim_msisdn;

		return Object.assign({}, resData, baseInfo, {
			battery: resData.battery_value || resData.battery_vol_percent || baseInfo.battery
		});
	});
}

function getDataUsage() {
	return getData({
		cmd: 'flux_data_volume_limit_switch,data_volume_limit_switch,data_volume_limit_unit,data_volume_limit_size,data_volume_alert_percent,monthly_tx_bytes,monthly_rx_bytes,monthly_time,wan_auto_clear_flow_data_switch,traffic_clear_date,',
		multi_data: '1'
	}).catch(function() {
		return null;
	});
}

function getBandLockData() {
	return getData({
		cmd: 'lte_band_lock,nr_band_lock'
	});
}

function getCellLockData() {
	return getData({
		cmd: 'neighbor_cell_info,locked_cell_info'
	});
}

function parseBandLock(value) {
	if (!hasText(value))
		return [];

	return String(value).split(',').map(function(item) {
		return String(item || '').trim();
	}).filter(Boolean);
}

function getCurrentCellInfo(data) {
	var source = data || {};

	if (hasText(source.Nr_pci) && hasText(source.Nr_fcn)) {
		return {
			rat: '16',
			ratLabel: '5G',
			band: hasText(source.Nr_bands) ? 'N' + source.Nr_bands : '5G',
			pci: text(source.Nr_pci, ''),
			earfcn: text(source.Nr_fcn, ''),
			rsrp: text(source.Z5g_rsrp, '-'),
			sinr: text(source.Nr_snr, '-'),
			rsrq: text(source.nr_rsrq, '-')
		};
	}

	if (hasText(source.Lte_pci) && hasText(source.Lte_fcn)) {
		return {
			rat: '12',
			ratLabel: '4G',
			band: hasText(source.Lte_bands) ? 'B' + source.Lte_bands : '4G',
			pci: text(source.Lte_pci, ''),
			earfcn: text(source.Lte_fcn, ''),
			rsrp: text(source.lte_rsrp, '-'),
			sinr: text(source.Lte_snr, '-'),
			rsrq: text(source.lte_rsrq, '-')
		};
	}

	return null;
}

function resolveCellRat(item) {
	var rat = text(item && item.rat, '');
	var band = String(text(item && item.band, '')).toUpperCase();

	if (rat === '16')
		return '16';
	if (rat === '12')
		return '12';
	if (band.indexOf('N') === 0)
		return '16';

	return '12';
}

function loadBandLockData() {
	return getBandLockData().then(function(res) {
		state.bandLockData = res || {};
		renderNetworkLock();
		return state.bandLockData;
	});
}

function loadCellLockData() {
	return getCellLockData().then(function(res) {
		state.neighborCells = Array.isArray(res && res.neighbor_cell_info) ? res.neighbor_cell_info : [];
		state.lockedCells = Array.isArray(res && res.locked_cell_info) ? res.locked_cell_info : [];
		renderNetworkLock();
		return res || {};
	});
}

function loadNetworkLock() {
	return Promise.all([
		loadBandLockData(),
		loadCellLockData(),
		loadCurrentCellData()
	]);
}

function loadCurrentCellData() {
	return getUFIData().then(function(res) {
		if (res)
			state.ufiData = res;

		renderSummary();
		renderNetworkLock();
		return state.ufiData;
	});
}

function toggleAllBandBoxes(checked) {
	if (!els.bandLockTable)
		return;

	Array.prototype.forEach.call(els.bandLockTable.querySelectorAll('input[type="checkbox"]'), function(input) {
		input.checked = !!checked;
	});

	updateBandSelectAll();
}

function updateBandSelectAll() {
	if (!els.bandSelectAll || !els.bandLockTable)
		return;

	var boxes = els.bandLockTable.querySelectorAll('input[type="checkbox"]');
	var checkedCount = 0;

	Array.prototype.forEach.call(boxes, function(input) {
		if (input.checked)
			checkedCount++;
	});

	els.bandSelectAll.checked = !!boxes.length && checkedCount === boxes.length;
	els.bandSelectAll.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

function collectSelectedBands() {
	var lteBands = [];
	var nrBands = [];

	if (!els.bandLockTable)
		return { lteBands: lteBands, nrBands: nrBands };

	Array.prototype.forEach.call(els.bandLockTable.querySelectorAll('input[type="checkbox"]:checked'), function(input) {
		var type = input.dataset.type;
		var band = input.dataset.band;

		if (!type || !band)
			return;

		if (type === '4G')
			lteBands.push(band);
		else if (type === '5G')
			nrBands.push(band);
	});

	return {
		lteBands: lteBands,
		nrBands: nrBands
	};
}

function isFormSuccess(res) {
	var result = text(res && res.result, '');

	return result === 'success' || result === '0' || result === '0.0';
}

function isFormAccepted(res) {
	return !!res && (isFormSuccess(res) || !!res.__empty);
}

function normalizeBandList(list) {
	return (Array.isArray(list) ? list : []).map(function(item) {
		return String(item || '').trim();
	}).filter(Boolean).sort(function(a, b) {
		var na = Number(a);
		var nb = Number(b);

		if (isFinite(na) && isFinite(nb) && na !== nb)
			return na - nb;

		return a.localeCompare(b);
	});
}

function sameBandSelection(actual, expected) {
	var left = normalizeBandList(actual);
	var right = normalizeBandList(expected);

	return JSON.stringify(left) === JSON.stringify(right);
}

function verifyBandLocks(lteBands, nrBands) {
	return getBandLockData().then(function(res) {
		var actualLte = parseBandLock(res && res.lte_band_lock);
		var actualNr = parseBandLock(res && res.nr_band_lock);
		var expectedLte = normalizeBandList(lteBands);
		var expectedNr = normalizeBandList(nrBands);

		pushRawLog('锁频段校验', '回读', JSON.stringify({
			lte_expected: expectedLte,
			lte_actual: normalizeBandList(actualLte),
			nr_expected: expectedNr,
			nr_actual: normalizeBandList(actualNr)
		}));

		if (!sameBandSelection(actualLte, expectedLte) || !sameBandSelection(actualNr, expectedNr))
			throw new Error('锁定频段失败：回读结果与目标频段不一致');

		state.bandLockData = res || {};
		renderNetworkLock();
		pushLog('INFO', '锁频段：回读确认成功');
		return state.bandLockData;
	});
}

function sameCellLock(item, rat, pci, earfcn) {
	return text(resolveCellRat(item), '').trim() === text(rat, '').trim()
		&& text(item && item.pci, '').trim() === text(pci, '').trim()
		&& text(item && item.earfcn, '').trim() === text(earfcn, '').trim();
}

function verifyCellLock(rat, pci, earfcn) {
	return getCellLockData().then(function(res) {
		var list = Array.isArray(res && res.locked_cell_info) ? res.locked_cell_info : [];
		var found = list.find(function(item) {
			return sameCellLock(item, rat, pci, earfcn);
		});

		pushRawLog('锁基站校验', found ? '匹配' : '未匹配', JSON.stringify({
			rat: rat,
			pci: pci,
			earfcn: earfcn,
			lockedCount: list.length
		}));

		if (!found)
			throw new Error('锁定基站失败：回读未发现目标基站');

		state.lockedCells = list;
		renderNetworkLock();
		pushLog('INFO', '锁基站：回读确认成功');
		return found;
	});
}

function verifyUnlockAllCells() {
	return getCellLockData().then(function(res) {
		var list = Array.isArray(res && res.locked_cell_info) ? res.locked_cell_info : [];

		pushRawLog('解除基站锁定校验', list.length ? '仍有锁定' : '已清空', JSON.stringify({
			lockedCount: list.length
		}));

		if (list.length)
			throw new Error('解除锁定基站失败：回读仍存在已锁基站');

		state.lockedCells = list;
		renderNetworkLock();
		pushLog('INFO', '解除基站锁定：回读确认成功');
		return null;
	});
}

function bounceBearerPreference() {
	return getData({
		cmd: 'net_select'
	}).then(function(res) {
		var current = text(res && res.net_select, '');
		var temp = NETWORK_TYPE_OPTIONS.find(function(item) {
			return item !== current;
		});

		if (!current || !temp)
			return null;

		pushLog('INFO', '锁频段：开始切网应用配置');
		return postData({
			goformId: 'SET_BEARER_PREFERENCE',
			BearerPreference: temp
		}).then(function(resp) {
			return parseOptionalJsonResponse(resp, '切换网络类型');
		}).then(function() {
			return delay(800);
		}).then(function() {
			return postData({
				goformId: 'SET_BEARER_PREFERENCE',
				BearerPreference: current
			});
		}).then(function(resp) {
			return parseOptionalJsonResponse(resp, '恢复网络类型');
		}).then(function() {
			pushLog('INFO', '锁频段：切网应用完成');
			return null;
		});
	}).catch(function(err) {
		pushLog('WARN', '锁频段：切网应用失败，已跳过。' + text(err && err.message, ''));
		return null;
	});
}

function saveBandLocks(lteBands, nrBands) {
	var targetLte = normalizeBandList(lteBands);
	var targetNr = normalizeBandList(nrBands);

	pushLog('INFO', '锁频段：开始提交 4G 频段');
	return postData({
		goformId: 'LTE_BAND_LOCK',
		lte_band_lock: targetLte.join(',')
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '锁定 4G 频段');
	}).then(function(res) {
		if (!isFormAccepted(res))
			throw new Error('锁定 4G 频段失败');

		pushLog('INFO', '锁频段：开始提交 5G 频段');
		return postData({
			goformId: 'NR_BAND_LOCK',
			nr_band_lock: targetNr.join(',')
		});
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '锁定 5G 频段');
	}).then(function(res) {
		if (!isFormAccepted(res))
			throw new Error('锁定 5G 频段失败');

		return bounceBearerPreference();
	}).then(function() {
		return verifyBandLocks(targetLte, targetNr);
	}).then(function() {
		return loadNetworkLock();
	});
}

function restoreAllBands() {
	var lteBands = BAND_OPTIONS.filter(function(item) {
		return item.type === '4G';
	}).map(function(item) {
		return item.band;
	});
	var nrBands = BAND_OPTIONS.filter(function(item) {
		return item.type === '5G';
	}).map(function(item) {
		return item.band;
	});

	return saveBandLocks(lteBands, nrBands);
}

function fillCellLockForm(cell) {
	if (!cell || !els.cellRatSelect || !els.lockCellPci || !els.lockCellEarfcn)
		return;

	els.cellRatSelect.value = text(cell.rat, '16');
	els.lockCellPci.value = text(cell.pci, '');
	els.lockCellEarfcn.value = text(cell.earfcn, '');
}

function lockSelectedCell() {
	var rat = text(els.cellRatSelect && els.cellRatSelect.value, '').trim();
	var pci = text(els.lockCellPci && els.lockCellPci.value, '').trim();
	var earfcn = text(els.lockCellEarfcn && els.lockCellEarfcn.value, '').trim();

	if (!rat || !pci || !earfcn)
		return Promise.reject(new Error('请完整填写 RAT、PCI 和频率'));

	return postData({
		goformId: 'CELL_LOCK',
		rat: rat,
		pci: pci,
		earfcn: earfcn
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '锁定基站');
	}).then(function(res) {
		if (!isFormAccepted(res))
			throw new Error('锁定基站失败');

		els.lockCellPci.value = '';
		els.lockCellEarfcn.value = '';
		return verifyCellLock(rat, pci, earfcn);
	}).then(function() {
		return loadCellLockData();
	});
}

function unlockAllCells() {
	return postData({
		goformId: 'UNLOCK_ALL_CELL'
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '解除锁定基站');
	}).then(function(res) {
		if (!isFormAccepted(res))
			throw new Error('解除锁定基站失败');

		return verifyUnlockAllCells();
	}).then(function() {
		return loadCellLockData();
	});
}

function startCellRefresh() {
	stopCellRefresh();
	state.cellRefreshPaused = false;
	renderNetworkLock();
	state.cellTimer = window.setInterval(function() {
		var panel = rootEl && rootEl.querySelector('.ufi-panel[data-panel="network"]');

		if (!state.connected || state.cellRefreshPaused || !panel || panel.hidden)
			return;

		Promise.all([
			loadCellLockData(),
			loadCurrentCellData()
		]).catch(function() {});
	}, CELL_REFRESH_MS);
}

function stopCellRefresh() {
	if (state.cellTimer) {
		window.clearInterval(state.cellTimer);
		state.cellTimer = null;
	}
}

function toggleCellRefresh() {
	state.cellRefreshPaused = !state.cellRefreshPaused;
	renderNetworkLock();

	if (!state.cellRefreshPaused) {
		Promise.all([
			loadCellLockData(),
			loadCurrentCellData()
		]).catch(function() {});
	}
}

function getSmsInfo(page, pageSize) {
	var p = page || 0;
	var size = pageSize || 200;

	return requestJson('/goform/goform_get_cmd_process?multi_data=1&isTest=false&cmd=sms_data_total&page=' + p + '&data_per_page=' + size + '&mem_store=1&tags=100&order_by=order by id desc&_=' + Date.now(), {
		signPath: '/goform/goform_get_cmd_process'
	});
}

function delay(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, Number(ms) || 0);
	});
}

function normalizePhoneNumber(number) {
	return text(number, '')
		.replace(/[\s\-()]/g, '')
		.replace(/^\+86/, '')
		.replace(/^86/, '')
		.trim();
}

function getSmsTagMeta(tag) {
	var value = text(tag, '');

	if (value === '3') {
		return {
			direction: 'out',
			status: 'failed',
			label: '发送失败'
		};
	}

	if (value === '2') {
		return {
			direction: 'out',
			status: 'sent',
			label: '已发送'
		};
	}

	if (value === '1') {
		return {
			direction: 'in',
			status: 'received',
			label: '未读'
		};
	}

	return {
		direction: 'in',
		status: 'recorded',
		label: '已记录'
	};
}

function verifySmsSendResult(number, content) {
	var attempts = 5;
	var index = 0;
	var targetNumber = normalizePhoneNumber(number);
	var targetContent = text(content, '').trim();

	function inspectMessages(messages) {
		var list = Array.isArray(messages) ? messages : [];
		var matched = list.find(function(item) {
			var itemNumber = normalizePhoneNumber(item && item.number);
			var itemContent = text(decodeBase64(item && item.content || ''), '').trim();
			return itemNumber === targetNumber && itemContent === targetContent;
		});

		if (!matched)
			return null;

		return {
			id: matched.id,
			tag: text(matched.tag, ''),
			number: text(matched.number, ''),
			content: text(decodeBase64(matched.content || ''), '')
		};
	}

	function run() {
		index += 1;
		pushLog('INFO', '发送短信：响应为空，开始校验结果，第 ' + index + ' 次');
		return getSmsInfo(0, 50).then(function(res) {
			var matched = inspectMessages(res && res.messages);

			if (matched) {
				var meta = getSmsTagMeta(matched.tag);

				pushRawLog('发送短信校验', '匹配短信', JSON.stringify({
					id: matched.id,
					tag: matched.tag,
					status: meta.status,
					number: matched.number,
					content: matched.content
				}));

				if (meta.status === 'failed')
					throw new Error('短信发送失败：设备标记为发送失败');

				if (meta.status === 'sent') {
					pushLog('INFO', '发送短信：已确认成功');
					return {
						result: 'success',
						verified: true,
						tag: matched.tag
					};
				}

				pushLog('WARN', '发送短信：设备已记录短信，但未最终确认');
				return {
					result: 'pending',
					verified: true,
					tag: matched.tag,
					message: '设备已记录短信，但未最终确认'
				};
			}

			pushRawLog('发送短信校验', '未匹配', JSON.stringify({
				attempt: index,
				targetNumber: targetNumber,
				targetContent: targetContent.slice(0, 80),
				messageCount: Array.isArray(res && res.messages) ? res.messages.length : 0
			}));

			if (index >= attempts)
				throw new Error('短信接口返回空响应，且未确认到发送结果');

			return delay(1000).then(run);
		});
	}

	return run();
}

function sendSms(number, content) {
	var originalCookie = state.cookie;
	var tempCookie = '';

	pushLog('INFO', '发送短信：开始建立临时会话');
	return login().then(function(cookie) {
		var previousCookie = originalCookie;
		var body;

		tempCookie = cookie || state.cookie;
		if (!tempCookie)
			throw new Error('短信发送前登录失败');

		pushLog('INFO', '发送短信：临时会话已建立');
		state.cookie = tempCookie;
		body = {
			goformId: 'SEND_SMS',
			Number: number,
			MessageBody: gsmEncode(content)
		};

		return postData(body).then(function(res) {
			return parseOptionalJsonResponse(res, '发送短信');
		}).then(function(result) {
			if (result && result.__empty)
				return verifySmsSendResult(number, content);
			return result;
		}).finally(function() {
			state.cookie = previousCookie;
		});
	}).finally(function() {
		state.cookie = originalCookie;
		return logoutWithCookie(tempCookie).finally(function() {
			state.cookie = originalCookie;
		});
	});
}

function deleteSms(id) {
	return postData({
		goformId: 'DELETE_SMS',
		msg_id: id,
		notCallback: true
	}).then(function(res) {
		return parseOptionalJsonResponse(res, '删除短信');
	});
}

function markSmsRead(ids) {
	var jobs = (ids || []).map(function(id) {
		return postData({
			goformId: 'SET_MSG_READ',
			msg_id: id,
			notCallback: true
		}).then(function(res) {
			return parseOptionalJsonResponse(res, '短信标已读');
		}).catch(function() { return null; });
	});

	return Promise.all(jobs);
}

function adbAlive() {
	return requestJson('/adb_alive', {
		signPath: '/api/adb_alive'
	}).then(function(res) {
		return res && String(res.result) === 'true';
	}).catch(function() {
		return false;
	});
}

function adbWifiSettingGet() {
	return requestJson('/adb_wifi_setting', {
		signPath: '/api/adb_wifi_setting'
	});
}

function adbWifiSettingSet(enabled) {
	return requestJson('/adb_wifi_setting', {
		method: 'POST',
		signPath: '/api/adb_wifi_setting',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			enabled: !!enabled,
			password: state.backendPassword
		})
	});
}

function getAPNData() {
	return getData({
		cmd: 'apn_interface_version,APN_config0,APN_config1,APN_config2,APN_config3,APN_config4,APN_config5,APN_config6,APN_config7,APN_config8,APN_config9,APN_config10,APN_config11,APN_config12,APN_config13,APN_config14,APN_config15,APN_config16,APN_config17,APN_config18,APN_config19,ipv6_APN_config0,ipv6_APN_config1,ipv6_APN_config2,ipv6_APN_config3,ipv6_APN_config4,ipv6_APN_config5,ipv6_APN_config6,ipv6_APN_config7,ipv6_APN_config8,ipv6_APN_config9,ipv6_APN_config10,ipv6_APN_config11,ipv6_APN_config12,ipv6_APN_config13,ipv6_APN_config14,ipv6_APN_config15,ipv6_APN_config16,ipv6_APN_config17,ipv6_APN_config18,ipv6_APN_config19,apn_m_profile_name,profile_name,apn_wan_dial,apn_select,apn_pdp_type,apn_pdp_select,apn_pdp_addr,index,apn_Current_index,apn_auto_config,apn_ipv6_apn_auto_config,apn_mode,apn_wan_apn,apn_ppp_auth_mode,apn_ppp_username,apn_ppp_passwd,dns_mode,prefer_dns_manual,standby_dns_manual,apn_ipv6_wan_apn,apn_ipv6_pdp_type,apn_ipv6_ppp_auth_mode,apn_ipv6_ppp_username,apn_ipv6_ppp_passwd,ipv6_dns_mode,ipv6_prefer_dns_manual,ipv6_standby_dns_manual,apn_num_preset,wan_apn_ui,profile_name_ui,pdp_type_ui,ppp_auth_mode_ui,ppp_username_ui,ppp_passwd_ui,dns_mode_ui,prefer_dns_manual_ui,standby_dns_manual_ui,ipv6_wan_apn_ui,ipv6_ppp_auth_mode_ui,ipv6_ppp_username_ui,ipv6_ppp_passwd_ui,ipv6_dns_mode_ui,ipv6_prefer_dns_manual_ui,ipv6_standby_dns_manual_ui',
		multi_data: '1'
	});
}

function saveAPNProfile(formData) {
	return postData(Object.assign({
		goformId: 'APN_PROC_EX',
		apn_mode: 'manual',
		apn_action: 'save'
	}, formData));
}

function deleteAPNProfile(index) {
	return postData({
		goformId: 'APN_PROC_EX',
		index: index,
		apn_mode: 'manual',
		apn_action: 'delete'
	});
}

function switchAPNMode(isAuto, index) {
	var data = {
		goformId: 'APN_PROC_EX',
		apn_mode: isAuto ? 'auto' : 'manual'
	};

	if (!isAuto) {
		data.apn_action = 'set_default';
		data.set_default_flag = '1';
		data.apn_pdp_type = '';
		data.index = index;
	}

	return postData(data);
}

function makeAPNFormData(index) {
	var profileName = els.apnProfileName.value.trim();
	var apn = els.apnName.value.trim();
	var username = els.apnUsername.value.trim();
	var password = els.apnPassword.value.trim();
	var auth = els.apnAuth.value;
	var pdp = els.apnPdp.value;
	var base = {
		profile_name: profileName,
		wan_dial: '*99#',
		apn_wan_dial: '*99#',
		apn_select: 'manual',
		apn_pdp_type: pdp,
		pdp_type: pdp,
		apn_pdp_select: 'auto',
		apn_pdp_addr: '',
		pdp_select: 'auto',
		pdp_addr: '',
		index: index
	};
	var ipv4 = {
		apn_wan_apn: apn,
		apn_ppp_auth_mode: auth,
		apn_ppp_username: username,
		apn_ppp_passwd: password,
		wan_apn: apn,
		ppp_auth_mode: auth,
		ppp_username: username,
		ppp_passwd: password,
		dns_mode: 'auto',
		prefer_dns_manual: '',
		standby_dns_manual: ''
	};
	var ipv6 = {
		apn_ipv6_wan_apn: apn,
		apn_ipv6_ppp_auth_mode: auth,
		apn_ipv6_ppp_username: username,
		apn_ipv6_ppp_passwd: password,
		ipv6_wan_apn: apn,
		ipv6_ppp_auth_mode: auth,
		ipv6_ppp_username: username,
		ipv6_ppp_passwd: password,
		ipv6_dns_mode: 'auto',
		ipv6_prefer_dns_manual: '',
		ipv6_standby_dns_manual: ''
	};

	if (!profileName || !apn)
		throw new Error('APN 配置名称和 APN 不能为空');

	if (pdp === 'IPv6')
		return Object.assign({}, base, ipv6);

	if (pdp === 'IP')
		return Object.assign({}, base, ipv4);

	return Object.assign({}, base, ipv4, ipv6);
}
